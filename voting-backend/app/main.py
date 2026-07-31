from __future__ import annotations

import secrets as pysecrets
from typing import List, Dict, Optional

from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel
from web3 import Web3

from app.blockchain import get_web3, get_election_contract, load_deployed, load_artifact
from app.identity import verify_identity
from app.merkle import MerkleTree
from app.store import store

from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Blockchain E-Voting Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DEMO_MODE = True  # Flag to include OTP hint in API response for easy presentation testing


@app.on_event("startup")
def startup():
    try:
        deployed = load_deployed()
        store.add_election(
            election_id=deployed["demo_election_id"],
            address=deployed["demo_election_address"],
            domain="COLLEGE",
            title="SRM Student Council Election 2026"
        )
    except Exception as e:
        print(f"Startup warning: could not load initial deployed.json: {e}")


@app.get("/")
def root():
    return {
        "status": "online",
        "service": "SecVote Blockchain E-Voting API",
        "documentation": "http://127.0.0.1:8000/docs",
        "active_elections": "http://127.0.0.1:8000/elections"
    }


@app.get("/elections")
def list_elections():
    """Returns a list of all registered elections currently active in the store."""
    return [
        {
            "election_id": rec.election_id,
            "address": rec.address,
            "domain": rec.domain,
            "title": rec.title,
            "eligible_count": len(rec.eligible_voters),
            "secrets_generated": bool(rec.secrets)
        }
        for rec in store.elections.values()
    ]


# ---------- Schemas ----------

class CreateElectionIn(BaseModel):
    name: str
    domain: str  # "GOVT" or "COLLEGE"
    candidate_names: List[str]
    start_time: Optional[int] = None
    end_time: Optional[int] = None


class EligibleVotersIn(BaseModel):
    election_id: int
    voter_ids: List[str]


class RequestOtpIn(BaseModel):
    election_id: int
    voter_id: str


class VerifyOtpIn(BaseModel):
    election_id: int
    voter_id: str
    otp: str


class CastVoteIn(BaseModel):
    election_id: int
    voter_id: str
    candidate_id: int


# ---------- Admin endpoints ----------

@app.post("/admin/create-election")
def create_election(payload: CreateElectionIn):
    """
    Deploys a new isolated Election smart contract instance on-chain via ElectionFactory.
    """
    w3 = get_web3()
    deployed = load_deployed()

    factory_artifact = load_artifact("ElectionFactory")
    factory = w3.eth.contract(address=deployed["factory_address"], abi=factory_artifact["abi"])

    chain_now = w3.eth.get_block("latest")["timestamp"]
    start_time = payload.start_time or (chain_now + 300)  # 5-minute setup window for admin to push Merkle root
    end_time = payload.end_time or (start_time + 60 * 60 * 24 * 30)

    placeholder_root = b"\x00" * 32

    try:
        tx_hash = factory.functions.createElection(
            deployed["election_admin_account"],
            payload.name,
            payload.domain.upper(),
            payload.candidate_names,
            start_time,
            end_time,
            placeholder_root
        ).transact({"from": deployed["owner_account"]})

        receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
        logs = factory.events.ElectionCreated().process_receipt(receipt)
        
        new_election_id = logs[0]["args"]["electionId"]
        new_election_address = logs[0]["args"]["electionAddress"]

        store.add_election(
            election_id=new_election_id,
            address=new_election_address,
            domain=payload.domain.upper(),
            title=payload.name
        )

        return {
            "election_id": new_election_id,
            "election_address": new_election_address,
            "title": payload.name,
            "domain": payload.domain.upper(),
            "candidates": payload.candidate_names,
            "message": f"Successfully created new election '{payload.name}' on-chain!"
        }
    except Exception as e:
        raise HTTPException(400, f"Failed to create election on-chain: {e}")


@app.post("/admin/eligible-voters")
def set_eligible_voters(payload: EligibleVotersIn):
    """Admin uploads the list of who is allowed to vote in this election."""
    record = store.get(payload.election_id)
    record.eligible_voters.update(payload.voter_ids)
    return {"election_id": payload.election_id, "eligible_count": len(record.eligible_voters)}


@app.post("/admin/generate-secrets")
def generate_secrets(election_id: int):
    """
    For every eligible voter, generate a one-time secret, build the Merkle
    tree of their hashes, and push the new root on-chain. Must be called
    BEFORE the voting window opens (the contract enforces this).
    """
    record = store.get(election_id)
    if not record.eligible_voters:
        raise HTTPException(400, "No eligible voters registered yet")

    record.secrets = {vid: pysecrets.token_hex(16) for vid in record.eligible_voters}
    leaves = [Web3.keccak(text=s) for s in record.secrets.values()]
    tree = MerkleTree(leaves)
    record.merkle_tree = tree

    w3 = get_web3()
    deployed = load_deployed()
    election = get_election_contract(w3, record.address)

    try:
        tx_hash = election.functions.updateMerkleRoot(tree.root).transact(
            {"from": deployed["election_admin_account"]}
        )
        w3.eth.wait_for_transaction_receipt(tx_hash)

        # Fast-forward test chain clock past startTime so voting opens immediately for demo testing
        try:
            start_time = election.functions.startTime().call()
            current_chain_time = w3.eth.get_block("latest")["timestamp"]
            if current_chain_time < start_time:
                time_diff = (start_time - current_chain_time) + 15
                w3.provider.make_request("evm_increaseTime", [time_diff])
                w3.provider.make_request("evm_mine", [])
        except Exception as err:
            print(f"EVM time advance note: {err}")
    except Exception as e:
        raise HTTPException(400, f"Contract rejected Merkle Root update: {e}")

    return {
        "election_id": election_id,
        "voters_issued": len(record.secrets),
        "merkle_root": tree.root.hex(),
    }


# ---------- Voter endpoints (Step 2a & 2b) ----------

@app.post("/voter/request-otp")
def request_otp(payload: RequestOtpIn):
    """
    Step 2a: Voter submits identity (Aadhaar / Roll number).
    Verifies eligibility and issues a one-time OTP secret.
    """
    record = store.get(payload.election_id)

    if not verify_identity(record.domain, payload.voter_id):
        raise HTTPException(403, f"Identity verification failed for domain '{record.domain}'.")
    if payload.voter_id not in record.eligible_voters:
        raise HTTPException(403, "You are not on the eligible voter list for this election.")

    # Generate or lookup voter's secret OTP
    if payload.voter_id not in record.secrets:
        record.secrets[payload.voter_id] = pysecrets.token_hex(16)

    otp_secret = record.secrets[payload.voter_id]

    # Console log as requested
    print(f"\n[OTP SMS/EMAIL SERVICE] Generated OTP Secret for Voter '{payload.voter_id}': {otp_secret}\n")

    response_data = {
        "election_id": payload.election_id,
        "voter_id": payload.voter_id,
        "message": f"One-Time OTP sent to voter's registered contact for election #{payload.election_id}."
    }

    if DEMO_MODE:
        response_data["demo_otp_hint"] = otp_secret

    return response_data


@app.post("/voter/verify-otp")
def verify_otp(payload: VerifyOtpIn):
    """
    Step 2b: Voter inputs OTP. Checks match against generated secret.
    Marks voter as verified upon success.
    """
    record = store.get(payload.election_id)

    if payload.voter_id not in record.secrets:
        raise HTTPException(400, "No OTP request found for this voter. Please click 'Request OTP' first.")

    expected_otp = record.secrets[payload.voter_id]

    if payload.otp.strip() != expected_otp:
        raise HTTPException(400, "Invalid OTP code! Please enter the exact OTP sent to your contact.")

    # Mark voter as OTP verified for this election
    record.otp_verified[payload.voter_id] = True

    return {
        "status": "verified",
        "voter_id": payload.voter_id,
        "election_id": payload.election_id,
        "message": "OTP verification successful! You may now cast your secret vote."
    }


@app.post("/vote/cast")
def cast_vote(payload: CastVoteIn):
    """
    Step 3: Relays vote on-chain. Enforces that voter has completed OTP verification (Step 2b).
    """
    record = store.get(payload.election_id)

    if not verify_identity(record.domain, payload.voter_id):
        raise HTTPException(403, "Identity verification failed.")
    if payload.voter_id not in record.secrets:
        raise HTTPException(400, "Voter has not been issued an OTP secret yet.")
    if not record.otp_verified.get(payload.voter_id, False):
        raise HTTPException(400, "Voter has not completed OTP verification! Please verify your OTP before voting.")
    if record.merkle_tree is None:
        raise HTTPException(400, "Merkle tree not built on-chain yet by admin.")

    secret = record.secrets[payload.voter_id]
    leaf = Web3.keccak(text=secret)
    proof = record.merkle_tree.get_proof(leaf)

    w3 = get_web3()
    deployed = load_deployed()
    election = get_election_contract(w3, record.address)

    try:
        tx_hash = election.functions.castVote(
            payload.candidate_id, leaf, proof
        ).transact({"from": deployed["owner_account"]})
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    except Exception as e:
        raise HTTPException(400, f"Vote rejected by smart contract: {e}")

    return {"status": "accepted", "tx_hash": receipt.transactionHash.hex()}


# ---------- Public results ----------

@app.get("/results/{election_id}")
def get_results(election_id: int):
    record = store.get(election_id)
    w3 = get_web3()
    election = get_election_contract(w3, record.address)
    candidates = election.functions.getResults().call()
    total = election.functions.totalVotesCast().call()
    return {
        "election_id": election_id,
        "title": record.title,
        "candidates": [{"id": c[0], "name": c[1], "votes": c[2]} for c in candidates],
        "total_votes_cast": total,
    }
