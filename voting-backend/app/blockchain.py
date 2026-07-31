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


def get_factory_contract(w3: Web3):
    deployed = load_deployed()
    artifact = load_artifact("ElectionFactory")
    return w3.eth.contract(address=deployed["factory_address"], abi=artifact["abi"])


def get_election_contract(w3: Web3, election_address: str):
    artifact = load_artifact("Election")
    return w3.eth.contract(address=Web3.to_checksum_address(election_address), abi=artifact["abi"])
