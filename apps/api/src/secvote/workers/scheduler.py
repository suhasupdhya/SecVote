"""Periodic jobs: chain clock, member batching, auto-freeze, ID-proof purge."""

from __future__ import annotations

import logging

from beanie.operators import In

from secvote.chain import Chain
from secvote.core.config import Settings
from secvote.db.models import Election, Registration, StoredDocument
from secvote.domain.enums import ElectionStatus, Phase, RegistrationStatus, TxKind
from secvote.domain.phases import now_utc
from secvote.services import clock, elections, txs

log = logging.getLogger("secvote.scheduler")


async def detect_orphans(chain: Chain) -> None:
    """A published election whose contract has no code means the chain it lived on is gone
    (e.g. a fresh local Anvil). Say so clearly instead of failing silently; admins can republish."""
    for e in await Election.find(Election.status == ElectionStatus.PUBLISHED).to_list():
        if (
            e.chain_address
            and len(await chain.w3.eth.get_code(chain.w3.to_checksum_address(e.chain_address))) == 0
        ):
            e.status = ElectionStatus.FAILED
            e.chain_error = "This election's contract no longer exists (the chain was reset). Publish it again to continue."
            await e.save()
            log.warning("election %s orphaned: no contract code at %s", e.slug, e.chain_address)


async def tally_sealed(chain: Chain) -> None:
    """After the key is revealed on chain: decrypt every indexed ballot and store the canonical result."""
    from secvote.db.models import Ballot
    from secvote.domain import tally
    from secvote.domain.enums import BallotMode
    from secvote.domain.sealed import open_ballot, public_key_of

    for e in await Election.find(
        Election.status == ElectionStatus.PUBLISHED, Election.mode == BallotMode.SEALED
    ).to_list():
        if not e.revealed_key or e.result is not None:
            continue
        if await elections.phase_of(e) != Phase.CLOSED:
            continue
        if public_key_of(int(e.revealed_key, 16)) != e.public_key:
            log.error("revealed key for %s does not match its public key", e.slug)
            continue
        ballots = await Ballot.find(Ballot.election_id == e.id).sort("+index").to_list()
        if len(ballots) < e.ballot_count:
            continue  # indexer still catching up
        plaintexts = [
            open_ballot(e.revealed_key, bytes.fromhex(b.ballot.removeprefix("0x"))) for b in ballots
        ]
        e.result = tally.tally_sealed(plaintexts, elections.race_specs(e), e.allow_nota)
        await e.save()
        log.info("sealed tally done for %s (%d ballots)", e.slug, len(ballots))


async def update_clock(chain: Chain) -> None:
    blk = await chain.w3.eth.get_block("latest")
    offset = max(0, int(blk["timestamp"]) - int(now_utc().timestamp()))
    await clock.set_offset(offset)


async def batch_members(settings: Settings) -> None:
    """Queue approved commitments into addMembers transactions (50-100 per tx)."""
    for e in await Election.find(
        Election.status == ElectionStatus.PUBLISHED, Election.frozen == False
    ).to_list():
        if await elections.phase_of(e) != Phase.REGISTRATION:
            continue
        assert e.id is not None
        if await txs.open_tx(TxKind.ADD_MEMBERS, e.id):
            continue  # one batch in flight per election keeps batches large
        if await txs.open_tx(TxKind.END_REGISTRATION, e.id) or await txs.open_tx(TxKind.START_VOTING, e.id):
            continue  # the officer is closing registration early
        regs = (
            await Registration.find(
                Registration.election_id == e.id,
                Registration.status == RegistrationStatus.COMMITMENT_SUBMITTED,
                Registration.added_tx_id == None,
            )
            .sort("+updated_at")
            .limit(settings.member_batch_size)
            .to_list()
        )
        if not regs:
            continue
        tx = await txs.enqueue(
            TxKind.ADD_MEMBERS,
            e.id,
            {"address": e.chain_address, "commitments": [r.commitment for r in regs]},
        )
        await Registration.find(In(Registration.id, [r.id for r in regs])).update(
            {"$set": {"added_tx_id": tx.id}}
        )
        log.info("queued %d commitments for %s", len(regs), e.slug)


async def auto_freeze() -> None:
    for e in await Election.find(
        Election.status == ElectionStatus.PUBLISHED, Election.frozen == False
    ).to_list():
        if await elections.phase_of(e) in (Phase.AWAITING_VOTE, Phase.VOTING, Phase.CLOSED):
            assert e.id is not None
            if not await txs.open_tx(TxKind.FREEZE, e.id) and not await txs.open_tx(TxKind.ADD_MEMBERS, e.id):
                await elections.request_freeze(None, str(e.id))
                log.info("auto-freeze queued for %s", e.slug)


async def purge_documents(settings: Settings) -> None:
    """DPDP: delete ID-proof files after their retention date."""
    expired = StoredDocument.find({"delete_after": {"$lt": now_utc()}})
    for doc in await expired.to_list():
        path = settings.upload_dir / doc.path
        path.unlink(missing_ok=True)
        await doc.delete()
        await Registration.find(Registration.document_id == doc.id).update({"$set": {"document_id": None}})
