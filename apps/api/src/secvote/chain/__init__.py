"""The only package that talks to web3. ABIs and addresses come from packages/shared (generated)."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from eth_account import Account
from eth_account.signers.local import LocalAccount
from eth_utils import keccak, to_checksum_address
from web3 import AsyncHTTPProvider, AsyncWeb3
from web3.contract import AsyncContract
from web3.exceptions import ContractCustomError, ContractLogicError

from secvote.core.config import Settings
from secvote.core.errors import Unavailable


@lru_cache
def load_abi(shared_dir: Path, name: str) -> list[dict[str, Any]]:
    path = shared_dir / "abi" / f"{name}.json"
    if not path.exists():
        raise Unavailable(f"ABI {name} missing; run `pnpm --filter @secvote/contracts gen-abis`")
    data: list[dict[str, Any]] = json.loads(path.read_text())
    return data


def load_deployment(settings: Settings) -> dict[str, Any]:
    path = settings.shared_dir / "deployments.json"
    deployments = json.loads(path.read_text()) if path.exists() else {}
    dep: dict[str, Any] | None = deployments.get(str(settings.chain_id))
    if not dep:
        raise Unavailable(
            f"No deployment for chain {settings.chain_id} in {path}. Deploy the contracts first."
        )
    return dep


@lru_cache
def _error_selectors(shared_dir: Path) -> dict[str, str]:
    out: dict[str, str] = {
        "0xd93c0665": "EnforcedPause",
        "0xe2517d3f": "AccessControlUnauthorizedAccount",
    }
    for name in ("Election", "ElectionFactory"):
        for item in load_abi(shared_dir, name):
            if item.get("type") == "error":
                sig = f"{item['name']}({','.join(i['type'] for i in item['inputs'])})"
                out["0x" + keccak(text=sig)[:4].hex()] = item["name"]
    for sig in (
        "Semaphore__MerkleTreeDepthIsNotSupported()",
        "Semaphore__MerkleTreeRootIsNotPartOfTheGroup()",
        "Semaphore__MerkleTreeRootIsExpired()",
        "Semaphore__GroupHasNoMembers()",
        "LeafAlreadyExists()",
        "LeafCannotBeZero()",
        "LeafGreaterThanSnarkScalarField()",
    ):
        out["0x" + keccak(text=sig)[:4].hex()] = sig.split("(")[0]
    return out


def revert_reason(settings: Settings, exc: Exception) -> str:
    data = getattr(exc, "data", None)
    if isinstance(data, str) and data.startswith("0x") and len(data) >= 10:
        return _error_selectors(settings.shared_dir).get(data[:10], data[:10])
    if isinstance(exc, ContractLogicError | ContractCustomError):
        return str(exc.message or exc)
    return str(exc)


def proof_tuple(p: dict[str, Any]) -> tuple[int, int, int, int, int, list[int]]:
    points = [int(x) for x in p["points"]]
    if len(points) != 8:
        raise ValueError("proof.points must have 8 elements")
    return (
        int(p["merkleTreeDepth"]),
        int(p["merkleTreeRoot"]),
        int(p["nullifier"]),
        int(p["message"]),
        int(p["scope"]),
        points,
    )


class Chain:
    def __init__(self, settings: Settings) -> None:
        self.s = settings
        self.w3 = AsyncWeb3(AsyncHTTPProvider(settings.rpc_url, request_kwargs={"timeout": 20}))
        self.dep = load_deployment(settings)
        self.factory: AsyncContract = self.w3.eth.contract(
            address=to_checksum_address(self.dep["electionFactory"]),
            abi=load_abi(settings.shared_dir, "ElectionFactory"),
        )
        self._election_abi = load_abi(settings.shared_dir, "Election")

    def election(self, address: str) -> AsyncContract:
        return self.w3.eth.contract(address=to_checksum_address(address), abi=self._election_abi)

    @property
    def relayer(self) -> LocalAccount:
        key = self.s.relayer_private_key.get_secret_value()
        if not key:
            raise Unavailable("SECVOTE_RELAYER_PRIVATE_KEY is not set")
        acct: LocalAccount = Account.from_key(key)
        return acct

    async def check(self) -> None:
        """Fail loudly if the chain is gone. Never redeploy automatically."""
        try:
            chain_id = await self.w3.eth.chain_id
            code = await self.w3.eth.get_code(self.factory.address)
        except Exception as exc:
            raise Unavailable(f"Chain RPC {self.s.rpc_url} unreachable: {exc}") from exc
        if chain_id != self.s.chain_id:
            raise Unavailable(f"RPC chain id {chain_id} != configured {self.s.chain_id}")
        if len(code) == 0:
            raise Unavailable(
                f"No ElectionFactory code at {self.factory.address}. The chain was reset or the deployment "
                "is stale. Redeploy deliberately; SecVote will not redeploy on its own."
            )

    async def simulate_officer_call(self, address: str, fn_name: str) -> str | None:
        """eth_call an officer function from the relayer. None if it would succeed, else the reason.
        "unsupported" means the contract predates this function."""
        try:
            await getattr(self.election(address).functions, fn_name)().call({"from": self.relayer.address})
        except (ContractLogicError, ContractCustomError, ValueError) as exc:
            reason = revert_reason(self.s, exc)
            data = getattr(exc, "data", None)
            if not data or data in ("0x", "execution reverted") or reason in ("execution reverted", ""):
                return "unsupported"
            return reason
        return None

    async def relayer_balance(self) -> int:
        """Wei left on the relayer, which pays the fee for every ballot and admin action."""
        return int(await self.w3.eth.get_balance(self.relayer.address))

    async def roll_size(self, address: str) -> int:
        return int(await self.election(address).functions.currentSize().call())

    async def simulate_replace(self, address: str, old: int, new: int, siblings: list[int]) -> str | None:
        """eth_call replaceMember as the registrar. None if it would succeed; "unsupported" if the contract
        predates identity resets; otherwise the revert reason (e.g. a stale Merkle proof)."""
        try:
            await (
                self.election(address)
                .functions.replaceMember(old, new, siblings)
                .call({"from": self.relayer.address})
            )
        except (ContractLogicError, ContractCustomError, ValueError) as exc:
            data = getattr(exc, "data", None)
            if not data or data in ("0x", "execution reverted"):
                return "unsupported"
            return revert_reason(self.s, exc)
        return None

    async def simulate_cast(self, address: str, proof: dict[str, Any], ballot: bytes) -> str | None:
        """eth_call castBallot. Returns None if it would succeed, else the revert reason."""
        try:
            await (
                self.election(address)
                .functions.castBallot(proof_tuple(proof), ballot)
                .call({"from": self.relayer.address})
            )
        except (ContractLogicError, ContractCustomError, ValueError) as exc:
            return revert_reason(self.s, exc)
        return None


_chain: Chain | None = None


def get_chain(settings: Settings) -> Chain:
    global _chain
    if _chain is None:
        _chain = Chain(settings)
    return _chain


def reset_chain() -> None:
    global _chain
    _chain = None
