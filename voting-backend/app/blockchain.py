import json
import os
from web3 import Web3

RPC_URL = os.environ.get("CHAIN_RPC_URL", "http://127.0.0.1:8545")
ABI_DIR = os.path.join(os.path.dirname(__file__), "..", "contracts_abi")
DEPLOYED_FILE = os.path.join(os.path.dirname(__file__), "..", "deployed.json")


def get_web3() -> Web3:
    w3 = Web3(Web3.HTTPProvider(RPC_URL))
    if not w3.is_connected():
        raise RuntimeError(
            f"Cannot reach chain at {RPC_URL}. "
            "Start a local chain first (see README: 'npx ganache')."
        )
    return w3


def load_artifact(name: str) -> dict:
    with open(os.path.join(ABI_DIR, f"{name}.json")) as f:
        return json.load(f)


def load_deployed() -> dict:
    if not os.path.exists(DEPLOYED_FILE):
        raise RuntimeError(
            "deployed.json not found. Run `python deploy.py` first to deploy the contracts."
        )
    with open(DEPLOYED_FILE) as f:
        return json.load(f)


def ensure_chain_sync(w3: Web3 = None) -> dict:
    """
    Validates that the contracts recorded in deployed.json actually exist on the
    currently running blockchain node, and that the owner account is recognized.
    If Ganache was restarted (wiping in-memory state and randomizing accounts),
    this automatically runs deploy() to restore contracts and re-sync accounts.
    """
    if w3 is None:
        w3 = get_web3()

    needs_deploy = False
    deployed = None

    if not os.path.exists(DEPLOYED_FILE):
        needs_deploy = True
    else:
        try:
            with open(DEPLOYED_FILE) as f:
                deployed = json.load(f)

            owner = deployed.get("owner_account")
            factory_addr = deployed.get("factory_address")
            accounts = [a.lower() for a in w3.eth.accounts]

            # 1. Check if owner account exists in current Ganache accounts
            if not owner or owner.lower() not in accounts:
                print(f"[SecVote Sync] Stale owner account detected ({owner}). Ganache was likely restarted.")
                needs_deploy = True
            # 2. Check if ElectionFactory contract has bytecode on the current chain
            elif not factory_addr:
                needs_deploy = True
            else:
                code = w3.eth.get_code(Web3.to_checksum_address(factory_addr))
                if code in (b"", b"\x00", b"0x", ""):
                    print(f"[SecVote Sync] ElectionFactory bytecode missing at {factory_addr}. Chain was likely reset.")
                    needs_deploy = True
        except Exception as e:
            print(f"[SecVote Sync] Verification check failed ({e}). Flagging for redeploy.")
            needs_deploy = True

    if needs_deploy:
        try:
            import deploy as deploy_module
            print("[SecVote Sync] Running automatic contract deployment & address sync...")
            deploy_module.deploy()
            with open(DEPLOYED_FILE) as f:
                deployed = json.load(f)
            print(f"[SecVote Sync] Successfully re-deployed contracts: Factory at {deployed.get('factory_address')}")
        except Exception as err:
            print(f"[SecVote Sync] Automatic deployment attempt failed: {err}")
            if not deployed:
                raise RuntimeError(
                    f"Contracts not deployed and auto-deploy failed ({err}). Run `python deploy.py` manually."
                )

    return deployed


def get_factory_contract(w3: Web3):
    deployed = load_deployed()
    artifact = load_artifact("ElectionFactory")
    return w3.eth.contract(address=deployed["factory_address"], abi=artifact["abi"])


def get_election_contract(w3: Web3, election_address: str):
    artifact = load_artifact("Election")
    return w3.eth.contract(address=Web3.to_checksum_address(election_address), abi=artifact["abi"])
