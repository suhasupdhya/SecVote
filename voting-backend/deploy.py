"""
Run this ONCE against a running local chain to deploy ElectionFactory
and create a demo election. Saves the deployed addresses to deployed.json
so the FastAPI app can find them on startup.

Usage:
    1. In a separate terminal, start a local chain:
         cd ../voting-contracts && npx ganache
    2. python deploy.py
"""
import json
import time
from app.blockchain import get_web3, load_artifact

DEPLOYED_FILE = "deployed.json"


def deploy():
    w3 = get_web3()
    owner = w3.eth.accounts[0]
    election_admin = w3.eth.accounts[1]

    print(f"Connected. Owner account: {owner}")

    # --- Deploy ElectionFactory ---
    factory_artifact = load_artifact("ElectionFactory")
    Factory = w3.eth.contract(abi=factory_artifact["abi"], bytecode=factory_artifact["bytecode"])
    tx_hash = Factory.constructor().transact({"from": owner})
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    factory_address = receipt.contractAddress
    print(f"ElectionFactory deployed at: {factory_address}")

    factory = w3.eth.contract(address=factory_address, abi=factory_artifact["abi"])

    # --- Create a demo COLLEGE election ---
    # Use the CHAIN's own clock (not Python's wall clock) as the basis —
    # on a local test chain that's had its time fast-forwarded during testing,
    # the two can drift apart.
    chain_now = w3.eth.get_block("latest")["timestamp"]
    start_time = chain_now + 3600          # opens in 1 hour — time to register voters & generate secrets first
    end_time = start_time + 60 * 60 * 24  # open for 24 hours after that

    # Placeholder root — real one gets set once voters are registered
    # (see /admin/generate-secrets in the API). Zero root = no one can vote yet.
    placeholder_root = b"\x00" * 32

    tx_hash = factory.functions.createElection(
        election_admin,
        "SRM Student Council Election 2026",
        "COLLEGE",
        ["Priya Sharma", "Rahul Verma", "Ananya Iyer"],
        start_time,
        end_time,
        placeholder_root,
    ).transact({"from": owner})
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)

    logs = factory.events.ElectionCreated().process_receipt(receipt)
    election_address = logs[0]["args"]["electionAddress"]
    election_id = logs[0]["args"]["electionId"]
    print(f"Demo election (id={election_id}) deployed at: {election_address}")

    with open(DEPLOYED_FILE, "w") as f:
        json.dump(
            {
                "factory_address": factory_address,
                "owner_account": owner,
                "election_admin_account": election_admin,
                "demo_election_id": election_id,
                "demo_election_address": election_address,
            },
            f,
            indent=2,
        )
    print(f"\nSaved deployment info to {DEPLOYED_FILE}")


if __name__ == "__main__":
    deploy()
