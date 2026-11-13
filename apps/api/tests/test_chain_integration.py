"""Real chain integration: Anvil + forge deploy + outbox + indexer + real Semaphore proofs.

Run with:  uv run pytest -m chain
Needs `anvil`, `forge` (Foundry) and `node` on PATH (or in ~/.foundry/bin).
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import socket
import subprocess
from collections.abc import AsyncIterator, Iterator
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest

from secvote.chain import get_chain, reset_chain
from secvote.core.config import REPO_ROOT, Settings, get_settings
from secvote.db.models import ChainTx, Election, Registration
from secvote.domain import ballot as fmt
from secvote.domain.enums import RegistrationStatus, TxKind, TxStatus
from secvote.domain.phases import now_utc
from secvote.main import create_app
from secvote.services import clock
from secvote.workers import scheduler
from secvote.workers.indexer import Indexer
from secvote.workers.outbox import Outbox

from .conftest import PDF, csrf, enrol_code, make_admin, signup_voter

pytestmark = pytest.mark.chain

CONTRACTS = REPO_ROOT / "packages" / "contracts"
FOUNDRY_BIN = Path.home() / ".foundry" / "bin"


def _tool(name: str) -> str | None:
    return shutil.which(name) or shutil.which(name, path=str(FOUNDRY_BIN))


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


@pytest.fixture(scope="session")
def anvil(tmp_root: Path) -> Iterator[dict[str, Any]]:
    anvil_bin, forge_bin = _tool("anvil"), _tool("forge")
    if not anvil_bin or not forge_bin or not shutil.which("node"):
        pytest.skip("anvil/forge/node not available")
    port = _free_port()
    cfg = tmp_root / "anvil.json"
    proc = subprocess.Popen(  # noqa: S603
        [anvil_bin, "--port", str(port), "--chain-id", "31339", "--silent", "--config-out", str(cfg)]
    )
    rpc = f"http://127.0.0.1:{port}"
    for _ in range(100):
        if cfg.exists() and cfg.stat().st_size > 0:
            break
        import time

        time.sleep(0.1)
    keys = json.loads(cfg.read_text())["private_keys"]
    deployer, relayer_key = keys[0], keys[1]
    from eth_account import Account

    relayer = Account.from_key(relayer_key).address
    env = {**os.environ, "RELAYER_ADDRESS": relayer}
    subprocess.run(  # noqa: S603
        [
            forge_bin,
            "script",
            "script/Deploy.s.sol",
            "--rpc-url",
            rpc,
            "--broadcast",
            "--private-key",
            deployer,
        ],
        cwd=CONTRACTS,
        env=env,
        check=True,
        capture_output=True,
    )
    dep_file = CONTRACTS / "deployments" / "31339.json"
    shared = tmp_root / "shared"
    (shared / "abi").mkdir(parents=True, exist_ok=True)
    for name in ("Election", "ElectionFactory"):
        abi = json.loads((CONTRACTS / "out" / f"{name}.sol" / f"{name}.json").read_text())["abi"]
        (shared / "abi" / f"{name}.json").write_text(json.dumps(abi))
    (shared / "deployments.json").write_text(json.dumps({"31339": json.loads(dep_file.read_text())}))
    dep_file.unlink()
    shutil.rmtree(CONTRACTS / "broadcast" / "Deploy.s.sol" / "31339", ignore_errors=True)
    yield {"rpc": rpc, "relayer_key": relayer_key, "shared": shared}
    proc.terminate()


@pytest.fixture(scope="session")
def settings(tmp_root: Path, anvil: dict[str, Any]) -> Settings:  # overrides conftest.settings
    import uuid

    return Settings(
        _env_file=None,  # never read the developer's apps/api/.env
        env="test",
        email_backend="console",
        mongodb_uri=os.environ.get("SECVOTE_TEST_MONGODB_URI", "mongodb://127.0.0.1:27017"),
        mongodb_db=f"secvote_chain_{uuid.uuid4().hex[:8]}",
        redis_url="",
        chain_required=True,
        rpc_url=anvil["rpc"],
        chain_id=31339,
        relayer_private_key=anvil["relayer_key"],
        shared_dir=anvil["shared"],
        allowed_email_domains=["example.edu.in"],
        upload_dir=tmp_root / "uploads",
        mailbox_file=tmp_root / "mailbox.jsonl",
        otp_resend_cooldown_seconds=0,
    )


@pytest.fixture(scope="session")
def app(settings: Settings) -> Any:
    reset_chain()
    application = create_app(settings)
    application.dependency_overrides[get_settings] = lambda: settings
    return application


@pytest.fixture
async def worker(settings: Settings) -> AsyncIterator[Any]:
    chain = get_chain(settings)
    await chain.check()
    outbox, indexer = Outbox(chain), Indexer(chain)

    async def tick(n: int = 2) -> None:
        for _ in range(n):
            await scheduler.update_clock(chain)
            clock.reset_cache()
            await scheduler.batch_members(settings)
            await scheduler.auto_freeze()
            await outbox.tick()
            await indexer.tick()
            await scheduler.tally_sealed(chain)

    tick.chain = chain  # type: ignore[attr-defined]
    tick.outbox = outbox  # type: ignore[attr-defined]
    yield tick


async def _warp_to(chain: Any, when: Any) -> None:
    latest = await chain.w3.eth.get_block("latest")
    delta = int(when.timestamp()) - int(latest["timestamp"]) + 2
    if delta > 0:
        await chain.w3.provider.make_request("evm_increaseTime", [delta])
    await chain.w3.provider.make_request("evm_mine", [])


def _node(*args: str) -> str:
    out = subprocess.run(  # noqa: S603
        ["node", "scripts/proof.mjs", *args],  # noqa: S607
        cwd=CONTRACTS,
        check=True,
        capture_output=True,
        text=True,
    )
    return out.stdout.strip()


def _commitment(seed: str) -> str:
    return str(int(_node("commitment", seed), 16))


def _prove(seed: str, scope: str, ballot: bytes, members: list[str]) -> dict[str, Any]:
    words = _node("prove", seed, scope, str(fmt.message_for(ballot)), ",".join(members))[2:]
    vals = [str(int(words[i : i + 64], 16)) for i in range(0, len(words), 64)]
    return {
        "merkleTreeDepth": int(vals[0]),
        "merkleTreeRoot": vals[1],
        "nullifier": vals[2],
        "message": vals[3],
        "scope": vals[4],
        "points": vals[5:13],
    }


async def test_full_open_election_on_chain(new_client, settings: Settings, worker) -> None:  # type: ignore[no-untyped-def]
    seeds = ["chain-voter-1", "chain-voter-2"]
    t = now_utc()
    async with new_client() as admin:
        await make_admin(admin)
        body = {
            "title": "Chain Council",
            "org": "Example College",
            "races": [
                {"title": "President", "candidates": [{"name": "A"}, {"name": "B"}, {"name": "C"}]},
                {"title": "Secretary", "candidates": [{"name": "D"}, {"name": "E"}]},
            ],
            "reg_start": (t - timedelta(minutes=1)).isoformat(),
            "reg_end": (t + timedelta(minutes=10)).isoformat(),
            "vote_start": (t + timedelta(minutes=20)).isoformat(),
            "vote_end": (t + timedelta(minutes=30)).isoformat(),
        }
        eid = (await admin.post("/api/v1/admin/elections", json=body, headers=csrf(admin))).json()["id"]
        r = await admin.post(f"/api/v1/admin/elections/{eid}/publish", headers=csrf(admin))
        assert r.status_code == 200, r.text
        await worker()
        e = await Election.get(eid)
        assert e is not None and e.status == "published" and e.chain_address and e.scope

        # --- registration: two voters, real Semaphore commitments
        for seed in seeds:
            async with new_client() as voter:
                email = await signup_voter(voter, settings)
                r = await voter.post(
                    f"/api/v1/elections/{eid}/registrations",
                    data={"reg_no": seed.upper(), "department": "CSE", "year": "2", "consent": "true"},
                    files={"id_document": ("id.pdf", PDF, "application/pdf")},
                    headers=csrf(voter),
                )
                rid = r.json()["id"]
                await admin.post(f"/api/v1/admin/registrations/{rid}/approve", headers=csrf(admin))
                r = await voter.post(
                    f"/api/v1/registrations/{rid}/commitment",
                    json={"commitment": _commitment(seed), "enrol_code": enrol_code(settings, email)},
                    headers=csrf(voter),
                )
                assert r.status_code == 200, r.text
        await worker(3)
        enrolled = await Registration.find(
            Registration.election_id == e.id, Registration.status == RegistrationStatus.ENROLLED
        ).count()
        assert enrolled == 2

        # --- freeze: warp past reg_end, the scheduler queues freeze on its own
        await _warp_to(worker.chain, e.reg_end)
        await worker(3)
        e = await Election.get(eid)
        assert e is not None and e.frozen and e.member_count == 2
        members = (await admin.get(f"/api/v1/elections/{eid}/members")).json()
        assert members["frozen_root"] == e.frozen_root and len(members["commitments"]) == 2
        roll = await admin.get(
            f"/api/v1/elections/{eid}/roll-check", params={"commitment": _commitment(seeds[0])}
        )
        assert roll.json()["in_roll"] is True

        # --- voting: anonymous relay with a real proof
        await _warp_to(worker.chain, e.vote_start)
        await worker(1)
        ballot = fmt.encode_open([1, fmt.NOTA])
        proof = _prove(seeds[0], e.scope, ballot, members["commitments"])
        async with new_client() as anon:
            payload = {"election_id": eid, "proof": proof, "ballot": "0x" + ballot.hex()}
            r = await anon.post("/api/v1/ballots", json=payload)
            assert r.status_code == 202, r.text
            ballot_id = r.json()["ballot_id"]
            await worker(3)
            st = (await anon.get(f"/api/v1/ballots/{ballot_id}")).json()
            assert st["status"] == "confirmed" and st["on_bulletin"] and st["index"] == 0

            # same voter again -> rejected before it ever reaches the chain
            again = _prove(seeds[0], e.scope, fmt.encode_open([0, 0]), members["commitments"])
            r = await anon.post(
                "/api/v1/ballots",
                json={"election_id": eid, "proof": again, "ballot": "0x" + fmt.encode_open([0, 0]).hex()},
            )
            assert r.status_code == 409

            # relayer cannot swap the ballot: proof is bound to the original bytes
            p2 = _prove(seeds[1], e.scope, ballot, members["commitments"])
            r = await anon.post(
                "/api/v1/ballots",
                json={"election_id": eid, "proof": p2, "ballot": "0x" + fmt.encode_open([2, 0]).hex()},
            )
            assert r.status_code == 400 and r.json()["error"]["code"] == "message_mismatch"

        bulletin = (await admin.get(f"/api/v1/elections/{eid}/ballots")).json()
        assert bulletin["total"] == 1 and bulletin["items"][0]["nullifier"] == proof["nullifier"]
        assert bulletin["items"][0]["ballot"] is None  # ballot contents hidden until results are published
        public = (await admin.get(f"/api/v1/elections/{eid}/results")).json()
        assert public["published"] is False and public["races"] is None and public["computed_hash"] is None
        results = (await admin.get(f"/api/v1/admin/elections/{eid}/results")).json()  # official preview
        assert results["preview"] is True
        assert results["races"][0]["candidates"][1]["votes"] == 1 and results["races"][1]["nota"] == 1

        # --- crash recovery: tx signed + persisted, process dies before broadcast
        outbox: Outbox = worker.outbox
        r = await admin.post(f"/api/v1/admin/elections/{eid}/pause", headers=csrf(admin))
        assert r.status_code == 200
        real_send = outbox.w3.eth.send_raw_transaction

        async def crash(*_: Any, **__: Any) -> Any:
            raise asyncio.CancelledError  # BaseException: simulates the process dying mid-send

        outbox.w3.eth.send_raw_transaction = crash  # type: ignore[method-assign]
        with pytest.raises(asyncio.CancelledError):
            await outbox.tick()
        outbox.w3.eth.send_raw_transaction = real_send  # type: ignore[method-assign]
        stuck = await ChainTx.find_one(ChainTx.kind == TxKind.PAUSE)
        assert stuck is not None and stuck.status == TxStatus.SENT and stuck.raw_tx
        stuck.updated_at = now_utc() - timedelta(minutes=5)
        await stuck.save()
        restarted = Outbox(worker.chain)  # new process
        await restarted.tick()  # rebroadcasts the identical raw tx
        await restarted.tick()
        await worker(1)
        stuck = await ChainTx.get(stuck.id)
        assert stuck is not None and stuck.status == TxStatus.CONFIRMED
        e = await Election.get(eid)
        assert e is not None and e.paused
        await admin.post(f"/api/v1/admin/elections/{eid}/unpause", headers=csrf(admin))
        await worker(2)

        # --- close and declare
        await _warp_to(worker.chain, e.vote_end)
        await worker(1)
        r = await admin.post(f"/api/v1/admin/elections/{eid}/declare", headers=csrf(admin))
        assert r.status_code == 200, r.text
        declared = r.json()["result_hash"]
        await worker(2)
        final = (await admin.get(f"/api/v1/elections/{eid}/results")).json()
        assert final["final"] and final["declared_hash"] == declared == final["computed_hash"]
        on_chain = await worker.chain.election(e.chain_address).functions.resultHash().call()
        assert "0x" + on_chain.hex() == declared


async def test_officer_starts_voting_early_on_chain(new_client, settings: Settings, worker) -> None:  # type: ignore[no-untyped-def]
    """Registration is cut short by the officer; voting opens immediately and a real ballot lands."""
    seed = "early-voter-1"
    t = now_utc()
    async with new_client() as admin:
        await make_admin(admin)
        body = {
            "title": "Early Close Club Vote",
            "org": "Example College",
            "races": [{"title": "Captain", "candidates": [{"name": "X"}, {"name": "Y"}]}],
            "reg_start": (t - timedelta(minutes=1)).isoformat(),
            "reg_end": (t + timedelta(days=3)).isoformat(),
            "vote_start": (t + timedelta(days=4)).isoformat(),
            "vote_end": (t + timedelta(days=5)).isoformat(),
        }
        eid = (await admin.post("/api/v1/admin/elections", json=body, headers=csrf(admin))).json()["id"]
        await admin.post(f"/api/v1/admin/elections/{eid}/publish", headers=csrf(admin))
        await worker()
        async with new_client() as voter:
            email = await signup_voter(voter, settings)
            rid = (
                await voter.post(
                    f"/api/v1/elections/{eid}/registrations",
                    data={"reg_no": "EARLY1", "department": "CSE", "year": "1", "consent": "true"},
                    files={"id_document": ("id.pdf", PDF, "application/pdf")},
                    headers=csrf(voter),
                )
            ).json()["id"]
            await admin.post(f"/api/v1/admin/registrations/{rid}/approve", headers=csrf(admin))
            await voter.post(
                f"/api/v1/registrations/{rid}/commitment",
                json={"commitment": _commitment(seed), "enrol_code": enrol_code(settings, email)},
                headers=csrf(voter),
            )
        await worker(3)

        # Officer: "Start voting now" in the middle of a 3-day registration window
        r = await admin.post(f"/api/v1/admin/elections/{eid}/start-voting", headers=csrf(admin))
        assert r.status_code == 200, r.text
        await worker(3)
        e = await Election.get(eid)
        assert e is not None and e.frozen and e.member_count == 1
        info = (await admin.get(f"/api/v1/elections/{eid}")).json()
        assert info["phase"] == "voting", info["phase"]

        ballot = fmt.encode_open([1])
        members = (await admin.get(f"/api/v1/elections/{eid}/members")).json()["commitments"]
        proof = _prove(seed, e.scope or "", ballot, members)
        async with new_client() as anon:
            r = await anon.post(
                "/api/v1/ballots", json={"election_id": eid, "proof": proof, "ballot": "0x" + ballot.hex()}
            )
            assert r.status_code == 202, r.text
            await worker(3)
            assert (await anon.get(f"/api/v1/ballots/{r.json()['ballot_id']}")).json()["on_bulletin"]

        # Officer ends voting early, then declares: results are final and verifiable
        r = await admin.post(f"/api/v1/admin/elections/{eid}/end-voting", headers=csrf(admin))
        assert r.status_code == 200, r.text
        await worker(3)
        assert (await admin.get(f"/api/v1/elections/{eid}")).json()["phase"] == "closed"
        r = await admin.post(f"/api/v1/admin/elections/{eid}/declare", headers=csrf(admin))
        assert r.status_code == 200, r.text
        await worker(2)
        res = (await admin.get(f"/api/v1/elections/{eid}/results")).json()
        assert res["final"] and res["declared_hash"] == res["computed_hash"]
        assert res["races"][0]["candidates"][1]["votes"] == 1


async def test_orphaned_election_is_flagged_and_republishable(new_client, settings: Settings, worker) -> None:  # type: ignore[no-untyped-def]
    """Simulates a chain reset: the election's contract address has no code."""
    from secvote.db.models import Member

    t = now_utc()
    async with new_client() as admin:
        await make_admin(admin)
        body = {
            "title": "Orphan Test",
            "org": "Example College",
            "races": [{"title": "Rep", "candidates": [{"name": "P"}, {"name": "Q"}]}],
            "reg_start": (t - timedelta(minutes=1)).isoformat(),
            "reg_end": (t + timedelta(days=30)).isoformat(),
            "vote_start": (t + timedelta(days=31)).isoformat(),
            "vote_end": (t + timedelta(days=32)).isoformat(),
        }
        eid = (await admin.post("/api/v1/admin/elections", json=body, headers=csrf(admin))).json()["id"]
        await admin.post(f"/api/v1/admin/elections/{eid}/publish", headers=csrf(admin))
        await worker()
        async with new_client() as voter:
            email = await signup_voter(voter, settings)
            rid = (
                await voter.post(
                    f"/api/v1/elections/{eid}/registrations",
                    data={"reg_no": "ORPH1", "department": "CSE", "year": "1", "consent": "true"},
                    files={"id_document": ("id.pdf", PDF, "application/pdf")},
                    headers=csrf(voter),
                )
            ).json()["id"]
            await admin.post(f"/api/v1/admin/registrations/{rid}/approve", headers=csrf(admin))
            await voter.post(
                f"/api/v1/registrations/{rid}/commitment",
                json={"commitment": _commitment("orphan-1"), "enrol_code": enrol_code(settings, email)},
                headers=csrf(voter),
            )
        await worker(3)
        e = await Election.get(eid)
        assert e is not None and e.member_count == 1

        # the chain "forgets" the contract
        e.chain_address = "0x" + "de" * 20
        await e.save()
        await scheduler.detect_orphans(worker.chain)
        info = (await admin.get(f"/api/v1/admin/elections/{eid}")).json()
        assert info["status"] == "failed" and "chain was reset" in info["chain"]["error"]

        # republish: fresh contract, approved voter re-added automatically
        r = await admin.post(f"/api/v1/admin/elections/{eid}/publish", headers=csrf(admin))
        assert r.status_code == 200, r.text
        await worker(4)
        e = await Election.get(eid)
        assert e is not None and e.status == "published" and e.chain_address != "0x" + "de" * 20
        assert e.member_count == 1 and await Member.find(Member.election_id == e.id).count() == 1


async def test_sealed_election_with_trustees_on_chain(new_client, settings: Settings, worker) -> None:  # type: ignore[no-untyped-def]
    """Phase 4 gate (API side): ciphertext on chain, nothing countable until 2 of 3 trustees release."""
    from secvote.domain import tally

    from .sealed_helpers import keypair, open_share, seal_ballot, seal_share, split

    t = now_utc()
    async with new_client() as admin, new_client() as c1, new_client() as c2, new_client() as c3:
        await make_admin(admin)
        body = {
            "title": "Sealed Council",
            "org": "Example College",
            "mode": "sealed",
            "races": [
                {"title": "President", "candidates": [{"name": "A"}, {"name": "B"}]},
                {
                    "title": "Secretary",
                    "method": "irv",
                    "candidates": [{"name": "C"}, {"name": "D"}, {"name": "E"}],
                },
            ],
            "reg_start": (t - timedelta(minutes=1)).isoformat(),
            "reg_end": (t + timedelta(days=3)).isoformat(),
            "vote_start": (t + timedelta(days=4)).isoformat(),
            "vote_end": (t + timedelta(days=5)).isoformat(),
        }
        eid = (await admin.post("/api/v1/admin/elections", json=body, headers=csrf(admin))).json()["id"]

        # three trustees, each with a browser-held key
        trustee_clients = [c1, c2, c3]
        trustee_keys: list[str] = []
        for c in trustee_clients:
            email = await signup_voter(c, settings)
            await admin.post(
                f"/api/v1/admin/elections/{eid}/trustees", json={"email": email}, headers=csrf(admin)
            )
            sk, pk = keypair()
            trustee_keys.append(sk)
            r = await c.post(f"/api/v1/trustee/elections/{eid}/key", json={"public_key": pk}, headers=csrf(c))
            assert r.status_code == 200, r.text

        # key ceremony (normally the officer's browser): only the public key + encrypted shares leave it
        election_sk, election_pk = keypair()
        trustees = (await admin.get(f"/api/v1/admin/elections/{eid}")).json()["trustees"]
        parts = split(election_sk)
        shares_payload = [
            {"trustee_id": x["id"], "encrypted_share": seal_share(x["public_key"], *parts[x["slot"] - 1])}
            for x in trustees
        ]
        r = await admin.post(
            f"/api/v1/admin/elections/{eid}/ceremony",
            json={"public_key": election_pk, "shares": shares_payload},
            headers=csrf(admin),
        )
        assert r.status_code == 200, r.text
        del election_sk  # the dealer forgets the key

        r = await admin.post(f"/api/v1/admin/elections/{eid}/publish", headers=csrf(admin))
        assert r.status_code == 200, r.text
        await worker()
        e = await Election.get(eid)
        assert e is not None and e.status == "published" and e.chain_address
        on_chain_pk = await worker.chain.election(e.chain_address).functions.publicKey().call()
        assert "0x" + on_chain_pk.hex() == election_pk

        # two voters
        seeds = ["sealed-v1", "sealed-v2"]
        for seed in seeds:
            async with new_client() as voter:
                email = await signup_voter(voter, settings)
                rid = (
                    await voter.post(
                        f"/api/v1/elections/{eid}/registrations",
                        data={"reg_no": seed.upper(), "department": "CSE", "year": "2", "consent": "true"},
                        files={"id_document": ("id.pdf", PDF, "application/pdf")},
                        headers=csrf(voter),
                    )
                ).json()["id"]
                await admin.post(f"/api/v1/admin/registrations/{rid}/approve", headers=csrf(admin))
                await voter.post(
                    f"/api/v1/registrations/{rid}/commitment",
                    json={"commitment": _commitment(seed), "enrol_code": enrol_code(settings, email)},
                    headers=csrf(voter),
                )
        await worker(3)
        r = await admin.post(f"/api/v1/admin/elections/{eid}/start-voting", headers=csrf(admin))
        assert r.status_code == 200, r.text
        await worker(3)
        e = await Election.get(eid)
        assert e is not None and e.frozen

        races = [(2, "plurality"), (3, "irv")]
        choices = [[[1], [2, 0]], [[0], [0, 2, 1]]]
        members = (await admin.get(f"/api/v1/elections/{eid}/members")).json()["commitments"]
        async with new_client() as anon:
            for seed, choice in zip(seeds, choices, strict=True):
                ct = seal_ballot(election_pk, tally.encode_sealed(choice, races, True))
                assert len(ct) == fmt.SEALED_BALLOT_SIZE
                proof = _prove(seed, e.scope or "", ct, members)
                payload = {"election_id": eid, "proof": proof, "ballot": "0x" + ct.hex()}
                r = await anon.post("/api/v1/ballots", json=payload)
                assert r.status_code == 202, r.text
            await worker(3)
        bulletin = (await admin.get(f"/api/v1/elections/{eid}/ballots")).json()
        assert (
            bulletin["total"] == 2 and len(bulletin["items"][0]["ballot"]) == 2 + 2 * 353
        )  # ciphertext is public

        # even officials can't count yet, and trustees can't release while voting is open
        preview = (await admin.get(f"/api/v1/admin/elections/{eid}/results")).json()
        assert preview["races"] is None and preview["awaiting_key"] is True
        enc = (await c1.get(f"/api/v1/trustee/elections/{eid}/share")).json()["encrypted_share"]
        r = await c1.post(
            f"/api/v1/trustee/elections/{eid}/share", json=open_share(trustee_keys[0], enc), headers=csrf(c1)
        )
        assert r.status_code == 409

        r = await admin.post(f"/api/v1/admin/elections/{eid}/end-voting", headers=csrf(admin))
        assert r.status_code == 200, r.text
        await worker(3)
        r = await admin.post(f"/api/v1/admin/elections/{eid}/declare", headers=csrf(admin))
        assert r.status_code == 409  # nothing to declare before the key is revealed

        # trustees 1 and 3 release their shares (any 2 of 3)
        for i in (0, 2):
            c = trustee_clients[i]
            enc = (await c.get(f"/api/v1/trustee/elections/{eid}/share")).json()["encrypted_share"]
            r = await c.post(
                f"/api/v1/trustee/elections/{eid}/share",
                json=open_share(trustee_keys[i], enc),
                headers=csrf(c),
            )
            assert r.status_code == 200, r.text
        assert r.json()["reconstructed"] is True
        await worker(4)
        e = await Election.get(eid)
        assert e is not None and e.revealed_key and e.result is not None

        preview = (await admin.get(f"/api/v1/admin/elections/{eid}/results")).json()
        pres, sec = preview["races"]
        assert [c["votes"] for c in pres["candidates"]] == [1, 1] and pres["winner"] == -1  # 1-1 tie
        assert sec["method"] == "irv" and sec["first"] == [1, 0, 1]
        assert sec["rounds"][-1]["counts"] == [2, 0, 0] and sec["winner"] == 0  # E eliminated, C wins

        r = await admin.post(f"/api/v1/admin/elections/{eid}/declare", headers=csrf(admin))
        assert r.status_code == 200, r.text
        declared = r.json()["result_hash"]
        await worker(2)
        public = (await admin.get(f"/api/v1/elections/{eid}/results")).json()
        assert public["published"] and public["declared_hash"] == declared == public["computed_hash"]
        on_chain = await worker.chain.election(e.chain_address).functions.resultHash().call()
        assert "0x" + on_chain.hex() == declared

        # Phase 4 gate: an outsider with only an RPC URL + contract address gets the same answer.
        cli = [
            "node",
            "--import",
            "tsx",
            "src/cli.ts",
            "--rpc",
            settings.rpc_url,
            "--election",
            e.chain_address,
        ]
        out = await asyncio.to_thread(
            subprocess.run,
            cli,
            cwd=REPO_ROOT / "packages" / "verifier",
            capture_output=True,
            text=True,
            timeout=120,
        )
        assert out.returncode == 0, out.stdout + out.stderr
        assert "MATCH" in out.stdout and declared in out.stdout
