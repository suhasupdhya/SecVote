"""Transaction outbox worker. The only holder of the relayer key and the nonce.

Lifecycle: pending -> sent -> confirmed | failed.
* A tx is signed and **persisted (raw bytes + nonce) before broadcast**, so a crash between the two
  is recovered by rebroadcasting the identical raw tx (same hash; idempotent).
* Calls that would revert are caught at gas estimation and marked failed without using a nonce.
"""

from __future__ import annotations

import logging
from typing import Any

from beanie.operators import In
from eth_utils import to_bytes
from web3.contract.async_contract import AsyncContractFunction
from web3.exceptions import TransactionNotFound
from web3.logs import DISCARD
from web3.types import TxReceipt

from secvote.chain import Chain, proof_tuple, revert_reason
from secvote.db.models import ChainCursor, ChainTx, Election, Registration
from secvote.domain.enums import ElectionStatus, TxKind, TxStatus
from secvote.domain.phases import now_utc

log = logging.getLogger("secvote.outbox")

MAX_IN_FLIGHT = 16
REBROADCAST_AFTER_SECONDS = 30


class Outbox:
    def __init__(self, chain: Chain) -> None:
        self.chain = chain
        self.w3 = chain.w3
        self.acct = chain.relayer
        self.next_nonce: int | None = None

    async def sync_nonce(self) -> None:
        on_chain = await self.w3.eth.get_transaction_count(self.acct.address, "pending")
        last = await ChainTx.find(ChainTx.status == TxStatus.SENT).sort("-nonce").limit(1).first_or_none()
        local = (last.nonce + 1) if last and last.nonce is not None else 0
        self.next_nonce = max(on_chain, local)

    # ------------------------------------------------------------ building calls
    async def _call(self, tx: ChainTx) -> AsyncContractFunction:
        p = tx.payload
        if tx.kind == TxKind.CREATE_ELECTION:
            config = (
                p["reg_start"],
                p["reg_end"],
                p["vote_start"],
                p["vote_end"],
                p["mode"],
                p["allow_nota"],
                p["candidate_counts"],
                p.get("race_methods", [0] * len(p["candidate_counts"])),
                to_bytes(hexstr=p.get("public_key") or "0x"),
            )
            fn: AsyncContractFunction = self.chain.factory.functions.createElection(
                to_bytes(hexstr=p["ref"]), config, self.acct.address, self.acct.address
            )
            return fn
        e = await Election.get(tx.election_id) if tx.election_id else None
        address = p.get("address") or (e.chain_address if e else None)
        if not address:
            raise RuntimeError("election has no chain address")
        c = self.chain.election(address).functions
        match tx.kind:
            case TxKind.ADD_MEMBERS:
                return c.addMembers([int(x) for x in p["commitments"]])
            case TxKind.REPLACE_MEMBER:
                return c.replaceMember(int(p["old"]), int(p["new"]), [int(x) for x in p["siblings"]])
            case TxKind.FREEZE:
                return c.freeze()
            case TxKind.CAST_BALLOT:
                return c.castBallot(proof_tuple(p["proof"]), to_bytes(hexstr=p["ballot"]))
            case TxKind.PAUSE:
                return c.pause()
            case TxKind.UNPAUSE:
                return c.unpause()
            case TxKind.DECLARE_RESULT:
                return c.declareResult(to_bytes(hexstr=p["result_hash"]))
            case TxKind.END_REGISTRATION:
                return c.endRegistrationNow()
            case TxKind.START_VOTING:
                return c.startVotingNow()
            case TxKind.END_VOTING:
                return c.endVotingNow()
            case TxKind.REVEAL_KEY:
                return c.revealKey(to_bytes(hexstr=p["key"]))
        raise RuntimeError(f"unknown tx kind {tx.kind}")

    # ------------------------------------------------------------ main loop
    async def tick(self) -> None:
        if self.next_nonce is None:
            await self.sync_nonce()
        await self._check_sent()
        await self._send_pending()

    async def _check_sent(self) -> None:
        latest = await self.w3.eth.block_number
        for tx in await ChainTx.find(ChainTx.status == TxStatus.SENT).sort("+nonce").to_list():
            try:
                receipt = await self.w3.eth.get_transaction_receipt(tx.tx_hash)  # type: ignore[arg-type]
            except TransactionNotFound:
                age = (now_utc() - tx.updated_at.replace(tzinfo=now_utc().tzinfo)).total_seconds()
                if age > REBROADCAST_AFTER_SECONDS and tx.raw_tx:
                    try:
                        await self.w3.eth.send_raw_transaction(to_bytes(hexstr=tx.raw_tx))
                        log.info("rebroadcast %s nonce=%s", tx.kind, tx.nonce)
                    except Exception as exc:  # already known / nonce too low (mined) etc.
                        log.debug("rebroadcast: %s", exc)
                    tx.updated_at = now_utc()
                    await tx.save()
                continue
            if latest - receipt["blockNumber"] + 1 < self.chain.s.confirmations:
                continue
            tx.block_number = receipt["blockNumber"]
            tx.updated_at = now_utc()
            if receipt["status"] == 1:
                tx.status = TxStatus.CONFIRMED
                await tx.save()
                await self._on_confirmed(tx, receipt)
            else:
                tx.status = TxStatus.FAILED
                tx.error = "reverted on chain"
                await tx.save()
                await self._on_failed(tx)
            log.info("%s %s nonce=%s block=%s", tx.kind, tx.status, tx.nonce, tx.block_number)

    async def _send_pending(self) -> None:
        in_flight = await ChainTx.find(ChainTx.status == TxStatus.SENT).count()
        budget = MAX_IN_FLIGHT - in_flight
        if budget <= 0:
            return
        pending = (
            await ChainTx.find(ChainTx.status == TxStatus.PENDING).sort("+created_at").limit(budget).to_list()
        )
        for tx in pending:
            try:
                fn = await self._call(tx)
                gas = await fn.estimate_gas({"from": self.acct.address})
            except Exception as exc:
                tx.status = TxStatus.FAILED
                tx.error = revert_reason(self.chain.s, exc)
                tx.attempts += 1
                tx.updated_at = now_utc()
                await tx.save()
                log.warning("%s rejected before send: %s", tx.kind, tx.error)
                await self._on_failed(tx)
                continue

            assert self.next_nonce is not None
            built = await fn.build_transaction(
                {  # type: ignore[arg-type]
                    "from": self.acct.address,
                    "nonce": self.next_nonce,
                    "gas": int(gas * 1.25) + 20_000,
                    "chainId": self.chain.s.chain_id,
                }
            )
            signed = self.acct.sign_transaction(built)  # type: ignore[arg-type]
            tx.nonce = self.next_nonce
            tx.tx_hash = "0x" + signed.hash.hex().removeprefix("0x")
            tx.raw_tx = "0x" + signed.raw_transaction.hex().removeprefix("0x")
            tx.status = TxStatus.SENT
            tx.attempts += 1
            tx.updated_at = now_utc()
            await tx.save()  # persisted BEFORE broadcast
            self.next_nonce += 1
            try:
                await self.w3.eth.send_raw_transaction(signed.raw_transaction)
            except Exception as exc:
                msg = str(exc).lower()
                if "already known" in msg:
                    continue
                # Not accepted: return to pending and resync the nonce from chain.
                log.warning("send failed for %s: %s", tx.kind, exc)
                tx.status = TxStatus.PENDING
                tx.nonce = tx.tx_hash = tx.raw_tx = None
                tx.error = str(exc)[:500]
                await tx.save()
                await self.sync_nonce()
                return

    # ------------------------------------------------------------ hooks
    async def _on_confirmed(self, tx: ChainTx, receipt: TxReceipt) -> None:
        if tx.kind != TxKind.CREATE_ELECTION:
            return  # everything else is reflected by the indexer from events
        e = await Election.get(tx.election_id)
        if e is None:
            return
        events = self.chain.factory.events.ElectionCreated().process_receipt(receipt, errors=DISCARD)
        if not events:
            return
        address = events[0]["args"]["election"]
        e.chain_address = address
        e.deploy_block = receipt["blockNumber"]
        e.scope = str(await self.chain.election(address).functions.scope().call())
        e.status = ElectionStatus.PUBLISHED
        await e.save()
        if not await ChainCursor.find_one(ChainCursor.key == address.lower()):
            await ChainCursor(key=address.lower(), block=receipt["blockNumber"]).insert()

    async def _on_failed(self, tx: ChainTx) -> None:
        if tx.kind == TxKind.CREATE_ELECTION and tx.election_id:
            e = await Election.get(tx.election_id)
            if e:
                e.status = ElectionStatus.FAILED
                e.chain_error = f"Deployment failed: {tx.error}. Check the schedule and publish again."
                await e.save()
        elif tx.kind == TxKind.ADD_MEMBERS:
            # Release the batch; the scheduler retries while registration is still open.
            await Registration.find(Registration.added_tx_id == tx.id).update({"$set": {"added_tx_id": None}})
        elif tx.kind == TxKind.REPLACE_MEMBER:
            # Usually the roll changed in between: the voter's page offers to try again (the reset stays approved).
            await Registration.find(Registration.replace_tx_id == tx.id).update(
                {"$set": {"replace_tx_id": None, "pending_commitment": None}}
            )


async def outbox_counts() -> dict[str, Any]:
    return {
        s.value: await ChainTx.find(ChainTx.status == s).count()
        for s in (TxStatus.PENDING, TxStatus.SENT, TxStatus.FAILED)
    }


__all__ = ["In", "Outbox", "outbox_counts"]
