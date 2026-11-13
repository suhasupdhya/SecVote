"""Event indexer: follows Election contract logs from a block cursor into Mongo.

Public pages read from here. We only index blocks with `confirmations` on top, and every write is
idempotent (unique indexes), so replaying a range after a crash or a shallow reorg is safe.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from eth_utils import event_abi_to_log_topic
from pymongo.errors import DuplicateKeyError
from web3.contract import AsyncContract

from secvote.chain import Chain
from secvote.db.models import Ballot, ChainCursor, ChainTx, Election, Member, Registration
from secvote.domain.enums import ElectionStatus, RegistrationStatus, TxKind

log = logging.getLogger("secvote.indexer")

MAX_RANGE = 2_000
EVENTS = (
    "MembersAdded",
    "Frozen",
    "BallotCast",
    "Paused",
    "Unpaused",
    "ResultDeclared",
    "KeyRevealed",
    "ScheduleShortened",
    "VotingEndedEarly",
)


class Indexer:
    def __init__(self, chain: Chain) -> None:
        self.chain = chain
        self.w3 = chain.w3
        self._block_time: dict[int, datetime] = {}
        template = chain.election(chain.factory.address)  # address irrelevant; used for ABI decoding
        self._topics: dict[bytes, str] = {}
        for raw_item in template.abi:
            item: dict[str, Any] = dict(raw_item)
            if item.get("type") == "event" and item["name"] in EVENTS:
                self._topics[event_abi_to_log_topic(item)] = item["name"]  # type: ignore[arg-type]

    async def tick(self) -> None:
        head = await self.w3.eth.block_number
        safe = head - (self.chain.s.confirmations - 1)
        for e in await Election.find(Election.status == ElectionStatus.PUBLISHED).to_list():
            if e.chain_address:
                await self._index(e, safe)

    async def _index(self, e: Election, safe: int) -> None:
        assert e.chain_address is not None
        key = e.chain_address.lower()
        cursor = await ChainCursor.find_one(ChainCursor.key == key)
        if cursor is None:
            cursor = ChainCursor(key=key, block=e.deploy_block or 0)
            await cursor.insert()
        contract = self.chain.election(e.chain_address)
        start = cursor.block
        while start <= safe:
            end = min(safe, start + MAX_RANGE - 1)
            logs = await self.w3.eth.get_logs(
                {"address": contract.address, "fromBlock": start, "toBlock": end}
            )
            for raw in logs:
                name = self._topics.get(bytes(raw["topics"][0]))
                if name:
                    ev = getattr(contract.events, name)().process_log(raw)
                    await self._apply(e, contract, name, ev)
            cursor.block = end + 1
            await cursor.save()
            start = end + 1
        await e.save()

    async def _time(self, block_number: int) -> datetime:
        if block_number not in self._block_time:
            blk = await self.w3.eth.get_block(block_number)
            self._block_time[block_number] = datetime.fromtimestamp(blk["timestamp"], tz=UTC)
        return self._block_time[block_number]

    async def _apply(self, e: Election, contract: AsyncContract, name: str, ev: Any) -> None:
        a = ev["args"]
        if name == "MembersAdded":
            start = int(a["startIndex"])
            commitments = [str(c) for c in a["commitments"]]
            for i, c in enumerate(commitments):
                try:
                    await Member(election_id=e.id, index=start + i, commitment=c).insert()
                except DuplicateKeyError:
                    pass
                await Registration.find(
                    Registration.election_id == e.id, Registration.commitment == c
                ).update({"$set": {"status": RegistrationStatus.ENROLLED.value, "member_index": start + i}})
            e.member_count = max(e.member_count, start + len(commitments))
        elif name == "Frozen":
            e.frozen = True
            e.frozen_root = str(a["merkleRoot"])
            e.member_count = int(a["memberCount"])
        elif name == "BallotCast":
            nullifier = str(a["nullifier"])
            relay = await ChainTx.find_one({"kind": TxKind.CAST_BALLOT.value, "payload.nullifier": nullifier})
            try:
                await Ballot(
                    election_id=e.id,
                    nullifier=nullifier,
                    index=int(a["index"]),
                    ballot="0x" + bytes(a["ballot"]).hex(),
                    tx_hash="0x" + ev["transactionHash"].hex().removeprefix("0x"),
                    block_number=ev["blockNumber"],
                    block_time=await self._time(ev["blockNumber"]),
                    ballot_id=relay.ballot_id if relay else None,
                ).insert()
            except DuplicateKeyError:
                pass
            e.ballot_count = max(e.ballot_count, int(a["index"]) + 1)
        elif name == "Paused":
            e.paused = True
        elif name == "Unpaused":
            e.paused = False
        elif name == "ScheduleShortened":
            # The officer brought the timeline forward on chain; mirror it so the API's phases follow.
            e.reg_end = datetime.fromtimestamp(int(a["regEnd"]), tz=UTC)
            e.vote_start = datetime.fromtimestamp(int(a["voteStart"]), tz=UTC)
        elif name == "VotingEndedEarly":
            e.vote_end = datetime.fromtimestamp(int(a["voteEnd"]), tz=UTC)
        elif name == "KeyRevealed":
            e.revealed_key = "0x" + bytes(a["key"]).hex()
        elif name == "ResultDeclared":
            e.result_hash = "0x" + bytes(a["resultHash"]).hex()
        log.info("indexed %s for %s", name, e.slug)
