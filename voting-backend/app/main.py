from __future__ import annotations

import os
import shutil
import secrets as pysecrets
from dotenv import load_dotenv

load_dotenv(override=True)
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"), override=True)
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"), override=True)
from typing import List, Dict, Optional
from datetime import datetime, timedelta

from fastapi import FastAPI, HTTPException, status, Depends, BackgroundTasks, UploadFile, File, Form
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from web3 import Web3
from sqlalchemy.orm import Session

from app.blockchain import get_web3, get_election_contract, load_deployed, load_artifact, ensure_chain_sync
from app.identity import verify_identity
from app.merkle import MerkleTree
from app.store import store, log_audit, hash_otp
from app.email_service import send_otp_email
from app.database import get_db, SessionLocal
from app.models import (
    Admin as AdminModel,
    Election as ElectionModel,
    Voter as VoterModel,
    OTPSession as OTPSessionModel,
    VoterApplication as VoterApplicationModel,
    ElectionResultsCache as ElectionResultsCacheModel
)
from app.auth import hash_password, verify_password, create_access_token, get_current_admin

from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="SecVote Blockchain E-Voting API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ],
    allow_origin_regex=r"https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "..", "uploads", "applications")
os.makedirs(UPLOAD_DIR, exist_ok=True)

DEMO_MODE = True  # Flag to include OTP hint in API response for presentation testing


@app.on_event("startup")
def startup():
    try:
        deployed = ensure_chain_sync()
        store.add_election(
            election_id=deployed["demo_election_id"],
            address=deployed["demo_election_address"],
            domain="COLLEGE",
            title="SRM Student Council Election 2026"
        )
        
        # Initialize default demo admin account if not exists
        db = SessionLocal()
        try:
            admin = db.query(AdminModel).filter_by(username="admin").first()
            if not admin:
                admin = AdminModel(
                    username="admin",
                    password_hash=hash_password("admin123")
                )
                db.add(admin)
                db.commit()
                print("Initialized default admin user: username='admin', password='admin123'")
            
            # Initialize default demo voter account if not exists
            voter = db.query(VoterModel).filter_by(email="voter@srmist.edu.in").first()
            if not voter:
                voter = VoterModel(
                    student_reg_no="RA2111003010001",
                    email="voter@srmist.edu.in",
                    password_hash=hash_password("voter123"),
                    is_verified=True
                )
                db.add(voter)
                db.commit()
                print("Initialized default voter user: email='voter@srmist.edu.in', password='voter123', reg_no='RA2111003010001'")
        finally:
            db.close()
    except Exception as e:
        print(f"Startup warning: {e}")


@app.get("/")
def root():
    return {
        "status": "online",
        "service": "SecVote Blockchain E-Voting API",
        "documentation": "http://127.0.0.1:8000/docs",
        "active_elections": "http://127.0.0.1:8000/elections"
    }


# ---------- Schemas ----------

class AdminAuthIn(BaseModel):
    username: str
    password: str


class VoterLoginIn(BaseModel):
    email: str
    password: str


class VoterRegisterIn(BaseModel):
    student_reg_no: str
    email: str
    password: str


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


# ---------- Admin & Voter Auth endpoints ----------

@app.post("/auth/admin/register")
def admin_register(payload: AdminAuthIn):
    """Registers a new admin user."""
    db = SessionLocal()
    try:
        existing = db.query(AdminModel).filter_by(username=payload.username.strip()).first()
        if existing:
            raise HTTPException(400, "Username already exists")

        admin = AdminModel(
            username=payload.username.strip(),
            password_hash=hash_password(payload.password)
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)

        access_token = create_access_token({"admin_id": admin.admin_id, "username": admin.username})
        return {
            "status": "success",
            "message": "Admin registered successfully",
            "access_token": access_token,
            "token_type": "bearer",
            "username": admin.username
        }
    finally:
        db.close()


@app.post("/auth/admin/login")
def admin_login(payload: AdminAuthIn):
    """Authenticates admin and returns JWT access token."""
    db = SessionLocal()
    try:
        admin = db.query(AdminModel).filter_by(username=payload.username.strip()).first()
        if not admin or not verify_password(payload.password, admin.password_hash):
            raise HTTPException(401, "Invalid username or password")

        access_token = create_access_token({"admin_id": admin.admin_id, "username": admin.username})
        return {
            "status": "success",
            "message": "Login successful",
            "access_token": access_token,
            "token_type": "bearer",
            "username": admin.username
        }
    finally:
        db.close()


@app.post("/auth/voter/register")
def voter_register(payload: VoterRegisterIn):
    """Registers a new voter account with Email, Reg No, and Password."""
    db = SessionLocal()
    try:
        email = payload.email.strip().lower()
        reg_no = payload.student_reg_no.strip()

        existing = db.query(VoterModel).filter(
            (VoterModel.email == email) | (VoterModel.student_reg_no.ilike(reg_no))
        ).first()

        if existing:
            if existing.password_hash:
                # If password matches existing account, auto-login seamlessly!
                if verify_password(payload.password, existing.password_hash):
                    return {
                        "status": "success",
                        "message": f"Welcome back! Logged in as '{existing.email}'.",
                        "student_reg_no": existing.student_reg_no,
                        "email": existing.email
                    }
                raise HTTPException(400, f"An account with email '{email}' or Reg No '{reg_no}' is already registered. Please switch to 'Voter Login' tab to log in.")
            
            # Set password for existing voter row created during eligibility setup or application approval
            existing.password_hash = hash_password(payload.password)
            existing.email = email
            existing.student_reg_no = reg_no
            db.commit()
            return {
                "status": "success",
                "message": "Voter account password set successfully! You are now logged in.",
                "student_reg_no": existing.student_reg_no,
                "email": existing.email
            }

        voter = VoterModel(
            student_reg_no=reg_no,
            email=email,
            password_hash=hash_password(payload.password),
            is_verified=True
        )
        db.add(voter)
        db.commit()
        db.refresh(voter)

        return {
            "status": "success",
            "message": "Voter registered successfully!",
            "student_reg_no": voter.student_reg_no,
            "email": voter.email
        }
    finally:
        db.close()


@app.post("/auth/voter/login")
def voter_login(payload: VoterLoginIn):
    """Authenticates voter using Email or Student Reg No and Password."""
    db = SessionLocal()
    try:
        identifier = payload.email.strip().lower()
        voter = db.query(VoterModel).filter(
            (VoterModel.email == identifier) | (VoterModel.student_reg_no.ilike(identifier))
        ).first()

        if not voter:
            # Check if there is an application submitted
            app_rec = db.query(VoterApplicationModel).filter(
                (VoterApplicationModel.email == identifier) | (VoterApplicationModel.student_reg_no.ilike(identifier))
            ).first()
            if app_rec:
                if app_rec.status == "PENDING":
                    raise HTTPException(400, f"Application for Reg No '{app_rec.student_reg_no}' is currently PENDING Admin approval.")
                elif app_rec.status == "APPROVED":
                    raise HTTPException(400, f"Application for '{identifier}' is APPROVED! Click 'New Voter? Register account' below to set your account password.")
            
            raise HTTPException(404, f"No registered account found for '{identifier}'. Click 'New Voter? Register account' below to create your password.")

        if not voter.password_hash:
            raise HTTPException(400, f"Voter account for '{voter.student_reg_no}' ({voter.email}) is approved! Click 'New Voter? Register account' below to set your account password.")

        if not verify_password(payload.password, voter.password_hash):
            raise HTTPException(401, f"Incorrect password for '{identifier}'. Please check your password.")

        return {
            "status": "success",
            "message": "Voter login successful",
            "voter_id": voter.voter_id,
            "student_reg_no": voter.student_reg_no,
            "email": voter.email
        }
    finally:
        db.close()


# ---------- Public & Voter Application endpoints ----------

@app.get("/elections/public")
def list_public_elections():
    """Public list of active elections for voters to select and apply."""
    return [
        {
            "election_id": rec.election_id,
            "address": rec.address,
            "domain": rec.domain,
            "title": rec.title,
            "status": rec.status,
            "eligible_count": len(rec.eligible_voters)
        }
        for rec in store.elections.values()
    ]


@app.get("/elections")
def list_elections():
    """Returns list of all elections."""
    return list_public_elections()


@app.post("/voter/apply-booth")
async def apply_voter_booth(
    election_id: int = Form(...),
    student_reg_no: str = Form(...),
    email: str = Form(...),
    id_proof_pdf: UploadFile = File(...)
):
    """
    Voter applies to a voting booth with an attached ID proof PDF file.
    """
    if not id_proof_pdf.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are accepted for ID proof.")

    db = SessionLocal()
    try:
        record = store.get(election_id)

        reg_no = student_reg_no.strip()
        voter_email = email.strip().lower()

        existing_app = db.query(VoterApplicationModel).filter_by(
            election_id=election_id, student_reg_no=reg_no
        ).first()

        if existing_app:
            raise HTTPException(400, f"An application for reg number '{reg_no}' has already been submitted for this voting booth.")

        filename = f"election_{election_id}_{reg_no.replace('/', '_')}_{int(datetime.utcnow().timestamp())}.pdf"
        file_path = os.path.join(UPLOAD_DIR, filename)

        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(id_proof_pdf.file, buffer)

        app_record = VoterApplicationModel(
            election_id=election_id,
            student_reg_no=reg_no,
            email=voter_email,
            pdf_proof_path=filename,
            status="PENDING",
            submitted_at=datetime.utcnow()
        )
        db.add(app_record)
        log_audit(db, election_id, "VOTER_APPLICATION_SUBMITTED", detail=f"Voter {reg_no} submitted application with PDF proof {filename}")
        db.commit()

        return {
            "status": "submitted",
            "message": f"Application for election #{election_id} submitted successfully! Your application is pending Admin verification.",
            "student_reg_no": reg_no,
            "election_id": election_id
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Failed to submit application: {str(e)}")
    finally:
        db.close()


# ---------- Admin Application Review endpoints ----------

@app.get("/admin/applications/{election_id}")
def get_voter_applications(election_id: int, current_admin: dict = Depends(get_current_admin)):
    """Protected route for Admin to view pending/historical applications for an election."""
    db = SessionLocal()
    try:
        apps = db.query(VoterApplicationModel).filter_by(election_id=election_id).all()
        return [
            {
                "application_id": a.application_id,
                "election_id": a.election_id,
                "student_reg_no": a.student_reg_no,
                "email": a.email,
                "pdf_filename": a.pdf_proof_path,
                "status": a.status,
                "submitted_at": a.submitted_at.isoformat(),
                "reviewed_at": a.reviewed_at.isoformat() if a.reviewed_at else None
            }
            for a in apps
        ]
    finally:
        db.close()


@app.get("/admin/applications/{app_id}/pdf")
def view_application_pdf(app_id: int):
    """Serves the uploaded PDF file stream for Admin review."""
    db = SessionLocal()
    try:
        app_rec = db.query(VoterApplicationModel).filter_by(application_id=app_id).first()
        if not app_rec:
            raise HTTPException(404, "Application not found")

        file_path = os.path.join(UPLOAD_DIR, app_rec.pdf_proof_path)
        if not os.path.exists(file_path):
            raise HTTPException(404, "Uploaded PDF file not found on server")

        return FileResponse(file_path, media_type="application/pdf", filename=app_rec.pdf_proof_path)
    finally:
        db.close()


def update_merkle_tree_and_root(election_id: int):
    """
    Helper function to ensure all eligible voters have secrets,
    construct the Merkle tree, and push/sync the root on-chain.
    Preserves existing secrets so issued OTP secrets remain valid.
    """
    record = store.get(election_id)
    if not record.eligible_voters:
        return {"election_id": election_id, "voters_issued": 0, "merkle_root": None}

    # Ensure every registered eligible voter has an OTP secret
    for vid in record.eligible_voters:
        if vid not in record.secrets:
            record.secrets[vid] = pysecrets.token_hex(16)

    all_secrets = [record.secrets[vid] for vid in record.eligible_voters if vid in record.secrets]
    if not all_secrets:
        return {"election_id": election_id, "voters_issued": 0, "merkle_root": None}

    leaves = [Web3.keccak(text=s) for s in all_secrets]
    tree = MerkleTree(leaves)
    record.merkle_tree = tree

    w3 = get_web3()
    deployed = ensure_chain_sync(w3)
    election = get_election_contract(w3, record.address)

    admin_sender = deployed.get("election_admin_account")
    if admin_sender not in w3.eth.accounts and len(w3.eth.accounts) > 1:
        admin_sender = w3.eth.accounts[1]

    # Push updated Merkle Root on-chain
    tx_hash = election.functions.updateMerkleRoot(tree.root).transact(
        {"from": admin_sender}
    )
    w3.eth.wait_for_transaction_receipt(tx_hash)

    return {
        "election_id": election_id,
        "voters_issued": len(all_secrets),
        "merkle_root": tree.root.hex(),
        "onchain_updated": True
    }


@app.post("/admin/applications/{app_id}/approve")
def approve_voter_application(app_id: int, current_admin: dict = Depends(get_current_admin)):
    """
    One-click Admin approval:
    1. Updates application status to APPROVED.
    2. Registers student_reg_no into election's eligible voters list.
    3. Issues voter secret, rebuilds Merkle Tree & updates smart contract root on-chain.
    """
    db = SessionLocal()
    try:
        app_rec = db.query(VoterApplicationModel).filter_by(application_id=app_id).first()
        if not app_rec:
            raise HTTPException(404, "Application not found")

        if app_rec.status == "APPROVED":
            raise HTTPException(400, "Application has already been approved.")

        app_rec.status = "APPROVED"
        app_rec.reviewed_at = datetime.utcnow()

        # Update or create VoterModel row with both student_reg_no and email from application!
        voter_rec = db.query(VoterModel).filter(
            (VoterModel.student_reg_no.ilike(app_rec.student_reg_no)) | (VoterModel.email == app_rec.email)
        ).first()
        if not voter_rec:
            voter_rec = VoterModel(
                student_reg_no=app_rec.student_reg_no,
                email=app_rec.email,
                is_verified=True
            )
            db.add(voter_rec)
            db.flush()
        else:
            voter_rec.email = app_rec.email
            voter_rec.student_reg_no = app_rec.student_reg_no
            voter_rec.is_verified = True

        record = store.get(app_rec.election_id)
        record.eligible_voters.update([app_rec.student_reg_no])

        # Automatically rebuild Merkle tree & update Merkle root on-chain for the newly approved voter!
        res = update_merkle_tree_and_root(app_rec.election_id)

        otp_secret = record.secrets[app_rec.student_reg_no]

        log_audit(db, app_rec.election_id, "VOTER_APPLICATION_APPROVED", voter_identifier=app_rec.student_reg_no, detail=f"Admin {current_admin['username']} approved application, updated Merkle root on-chain, and issued OTP token")
        db.commit()

        return {
            "status": "APPROVED",
            "message": f"Application approved! Voter '{app_rec.student_reg_no}' registered into voters list, Merkle root updated on-chain, and OTP token issued.",
            "student_reg_no": app_rec.student_reg_no,
            "election_id": app_rec.election_id,
            "demo_otp_hint": otp_secret if DEMO_MODE else None,
            "merkle_root": res.get("merkle_root")
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"Approval failed: {str(e)}")
    finally:
        db.close()


@app.post("/admin/applications/{app_id}/reject")
def reject_voter_application(app_id: int, current_admin: dict = Depends(get_current_admin)):
    """Rejects a voter application."""
    db = SessionLocal()
    try:
        app_rec = db.query(VoterApplicationModel).filter_by(application_id=app_id).first()
        if not app_rec:
            raise HTTPException(404, "Application not found")

        app_rec.status = "REJECTED"
        app_rec.reviewed_at = datetime.utcnow()
        log_audit(db, app_rec.election_id, "VOTER_APPLICATION_REJECTED", voter_identifier=app_rec.student_reg_no, detail=f"Admin {current_admin['username']} rejected application")
        db.commit()

        return {
            "status": "REJECTED",
            "message": f"Application for voter '{app_rec.student_reg_no}' rejected.",
            "student_reg_no": app_rec.student_reg_no
        }
    finally:
        db.close()


# ---------- Admin endpoints ----------

@app.post("/admin/create-election")
def create_election(payload: CreateElectionIn):
    """
    Deploys a new isolated Election smart contract instance on-chain via ElectionFactory.
    """
    w3 = get_web3()
    deployed = ensure_chain_sync(w3)

    factory_artifact = load_artifact("ElectionFactory")
    factory = w3.eth.contract(address=deployed["factory_address"], abi=factory_artifact["abi"])

    chain_now = w3.eth.get_block("latest")["timestamp"]
    start_time = payload.start_time or (chain_now - 60)
    end_time = payload.end_time or (start_time + 60 * 60 * 24 * 30)

    placeholder_root = b"\x00" * 32

    owner_acc = deployed.get("owner_account")
    admin_acc = deployed.get("election_admin_account")
    current_accounts = [a.lower() for a in w3.eth.accounts]

    if not owner_acc or owner_acc.lower() not in current_accounts:
        deployed = ensure_chain_sync(w3)
        owner_acc = deployed.get("owner_account")
        admin_acc = deployed.get("election_admin_account")

    if not admin_acc or admin_acc.lower() not in current_accounts:
        admin_acc = w3.eth.accounts[1] if len(w3.eth.accounts) > 1 else w3.eth.accounts[0]

    try:
        tx_hash = factory.functions.createElection(
            admin_acc,
            payload.name,
            payload.domain.upper(),
            payload.candidate_names,
            start_time,
            end_time,
            placeholder_root
        ).transact({"from": owner_acc})

        receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
        logs = factory.events.ElectionCreated().process_receipt(receipt)
        
        new_election_id = logs[0]["args"]["electionId"]
        new_election_address = logs[0]["args"]["electionAddress"]

        assigned_election_id = store.add_election(
            election_id=new_election_id,
            address=new_election_address,
            domain=payload.domain.upper(),
            title=payload.name,
            force_new=True
        )

        return {
            "election_id": assigned_election_id,
            "election_address": new_election_address,
            "title": payload.name,
            "domain": payload.domain.upper(),
            "candidates": payload.candidate_names,
            "message": f"Successfully created new election '{payload.name}' on-chain with ID #{assigned_election_id}!"
        }
    except Exception as e:
        err_msg = str(e)
        if "sender account not recognized" in err_msg:
            # Re-sync immediately so subsequent attempts succeed
            try:
                ensure_chain_sync(w3)
            except Exception:
                pass
            raise HTTPException(
                status_code=400,
                detail="Local blockchain (Ganache) was restarted. Contracts have been auto-synchronized — please click 'Create Election' again."
            )
        raise HTTPException(400, f"Failed to create election on-chain: {e}")


@app.post("/admin/eligible-voters")
def set_eligible_voters(payload: EligibleVotersIn):
    """Admin uploads the list of who is allowed to vote in this election."""
    record = store.get(payload.election_id)
    record.eligible_voters.update(payload.voter_ids)
    res = update_merkle_tree_and_root(payload.election_id)
    return {
        "election_id": payload.election_id,
        "eligible_count": len(record.eligible_voters),
        "merkle_root": res.get("merkle_root")
    }


@app.post("/admin/generate-secrets")
def generate_secrets(election_id: int):
    """
    For every eligible voter, generate a one-time secret, build the Merkle
    tree of their hashes, and push the new root on-chain. Must be called
    BEFORE the voting window opens (the contract enforces this).
    """
    return update_merkle_tree_and_root(election_id)


@app.post("/admin/election/{election_id}/pause")
def pause_election(election_id: int, current_admin: dict = Depends(get_current_admin)):
    """Admin endpoint to pause an active election."""
    record = store.get(election_id)
    record.set_status("PAUSED")
    return {
        "status": "PAUSED",
        "election_id": election_id,
        "message": f"Election #{election_id} ('{record.title}') has been PAUSED. Voting is temporarily suspended."
    }


@app.post("/admin/election/{election_id}/resume")
def resume_election(election_id: int, current_admin: dict = Depends(get_current_admin)):
    """Admin endpoint to resume a paused election."""
    record = store.get(election_id)
    record.set_status("ACTIVE")
    return {
        "status": "ACTIVE",
        "election_id": election_id,
        "message": f"Election #{election_id} ('{record.title}') has been RESUMED to ACTIVE."
    }


@app.post("/admin/election/{election_id}/close")
def close_election(election_id: int, current_admin: dict = Depends(get_current_admin)):
    """Admin endpoint to permanently close an election."""
    record = store.get(election_id)
    record.set_status("CLOSED")
    return {
        "status": "CLOSED",
        "election_id": election_id,
        "message": f"Election #{election_id} ('{record.title}') has been CLOSED."
    }


def sync_results_to_db(election_id: int):
    """Helper background task to sync smart contract getResults() to election_results_cache."""
    db = SessionLocal()
    try:
        record = store.get(election_id)
        w3 = get_web3()
        election = get_election_contract(w3, record.address)
        candidates = election.functions.getResults().call()
        now = datetime.utcnow()

        for c in candidates:
            cand_id = c[0]
            cand_name = c[1]
            vote_cnt = c[2]

            cache = db.query(ElectionResultsCacheModel).filter_by(
                election_id=election_id, candidate_id=cand_id
            ).first()

            if cache:
                cache.vote_count = vote_cnt
                cache.candidate_name = cand_name
                cache.synced_at = now
            else:
                cache = ElectionResultsCacheModel(
                    election_id=election_id,
                    candidate_id=cand_id,
                    candidate_name=cand_name,
                    vote_count=vote_cnt,
                    synced_at=now
                )
                db.add(cache)

        db.commit()
    except Exception as e:
        db.rollback()
        print(f"Error syncing results cache for election {election_id}: {e}")
    finally:
        db.close()


@app.post("/admin/sync-results/{election_id}")
def sync_election_results_endpoint(election_id: int):
    """On-demand endpoint to sync smart contract getResults() tally into PostgreSQL cache."""
    sync_results_to_db(election_id)
    return {"status": "synced", "election_id": election_id, "synced_at": datetime.utcnow().isoformat()}


# ---------- Voter endpoints (Step 2a & 2b) ----------

@app.post("/voter/request-otp")
def request_otp(payload: RequestOtpIn):
    """
    Step 2a: Voter submits identity (Aadhaar / Roll number).
    Verifies eligibility, preserves Credential A (32-char voting secret for Merkle Tree),
    and dispatches a 6-digit numeric email OTP (Credential B) via Resend.
    """
    record = store.get(payload.election_id)

    if record.status == "PAUSED":
        raise HTTPException(400, f"Election #{payload.election_id} ('{record.title}') is currently PAUSED by the Administrator. Voting is temporarily suspended.")
    if record.status == "CLOSED":
        raise HTTPException(400, f"Election #{payload.election_id} ('{record.title}') has been CLOSED by the Administrator. Voting is no longer allowed.")

    if not verify_identity(record.domain, payload.voter_id):
        raise HTTPException(403, f"Identity verification failed for domain '{record.domain}'.")
    if payload.voter_id not in record.eligible_voters:
        raise HTTPException(403, "You are not on the eligible voter list for this election.")

    # CREDENTIAL A: Ensure internal 32-char voting secret exists for Merkle tree & proof generation
    if payload.voter_id not in record.secrets:
        record.secrets[payload.voter_id] = pysecrets.token_hex(16)

    # CREDENTIAL B: Query voter's registered email strictly from database
    db = SessionLocal()
    try:
        voter = db.query(VoterModel).filter(
            (VoterModel.student_reg_no.ilike(payload.voter_id.strip())) |
            (VoterModel.email.ilike(payload.voter_id.strip()))
        ).first()

        if not voter:
            raise HTTPException(404, f"No registered voter record found for '{payload.voter_id}'. Please register or apply for eligibility first.")

        registered_email = voter.email

        # Check if an active unexpired OTP session already exists within 60s window
        existing_sess = db.query(OTPSessionModel).filter_by(
            voter_id=voter.voter_id, election_id=payload.election_id
        ).first()

        now = datetime.utcnow()
        if existing_sess and existing_sess.created_at and not existing_sess.verified and now < existing_sess.expires_at:
            elapsed = (now - existing_sess.created_at).total_seconds()
            if elapsed < 60:
                return {
                    "status": "active_session",
                    "election_id": payload.election_id,
                    "voter_id": payload.voter_id,
                    "message": f"An active verification code was sent to your registered email address ({registered_email})."
                }

        # Generate Cryptographically Secure 6-Digit Numeric Email OTP
        otp_code_6digit = f"{pysecrets.randbelow(1_000_000):06d}"
        hashed_otp = hash_otp(otp_code_6digit)
        expires_at = now + timedelta(minutes=5)

        if existing_sess:
            existing_sess.otp_code = hashed_otp
            existing_sess.created_at = now
            existing_sess.expires_at = expires_at
            existing_sess.attempts = 0
            existing_sess.verified = False
        else:
            new_sess = OTPSessionModel(
                voter_id=voter.voter_id,
                election_id=payload.election_id,
                otp_code=hashed_otp,
                created_at=now,
                expires_at=expires_at,
                attempts=0,
                verified=False
            )
            db.add(new_sess)

        log_audit(db, payload.election_id, "OTP_REQUESTED", voter_identifier=payload.voter_id, detail=f"Email OTP code dispatched to registered email '{registered_email}'")
        db.commit()

        # Dispatch Email via Resend
        send_otp_email(registered_email, otp_code_6digit, record.title)

        # Return clean success message with NO OTP or secret tokens exposed
        return {
            "status": "sent",
            "election_id": payload.election_id,
            "voter_id": payload.voter_id,
            "message": f"Verification code sent to your registered email address ({registered_email})."
        }
    finally:
        db.close()


@app.post("/voter/verify-otp")
def verify_otp(payload: VerifyOtpIn):
    """
    Step 2b: Voter inputs 6-digit numeric email OTP. Checks SHA-256 hash match against DB.
    Enforces 5-minute expiration, maximum 5 attempts, and single-use verification.
    """
    submitted_otp = payload.otp.strip()
    if not submitted_otp or len(submitted_otp) != 6 or not submitted_otp.isdigit():
        raise HTTPException(400, "Verification code must be exactly 6 numeric digits.")

    db = SessionLocal()
    try:
        voter = db.query(VoterModel).filter(
            (VoterModel.student_reg_no.ilike(payload.voter_id.strip())) |
            (VoterModel.email.ilike(payload.voter_id.strip()))
        ).first()

        if not voter:
            raise HTTPException(404, f"Voter '{payload.voter_id}' registration record not found.")

        otp_sess = db.query(OTPSessionModel).filter_by(
            voter_id=voter.voter_id, election_id=payload.election_id
        ).first()

        if not otp_sess:
            raise HTTPException(400, "No verification code request found. Please click 'Request Verification Code' first.")

        now = datetime.utcnow()

        if otp_sess.attempts >= 5:
            log_audit(db, payload.election_id, "OTP_FAILED", voter_identifier=payload.voter_id, detail="Max OTP verification attempts exceeded (5/5)")
            db.commit()
            raise HTTPException(400, "Too many failed attempts. Please request a new verification code.")

        if now > otp_sess.expires_at:
            log_audit(db, payload.election_id, "OTP_EXPIRED", voter_identifier=payload.voter_id, detail="OTP verification code expired (> 5 minutes)")
            db.commit()
            raise HTTPException(400, "This verification code has expired. Please request a new code.")

        hashed_submitted = hash_otp(submitted_otp)

        if hashed_submitted != otp_sess.otp_code:
            otp_sess.attempts += 1
            remaining = 5 - otp_sess.attempts
            event_detail = f"Invalid OTP code entered (Attempt {otp_sess.attempts}/5)"
            log_audit(db, payload.election_id, "OTP_FAILED", voter_identifier=payload.voter_id, detail=event_detail)
            db.commit()

            if otp_sess.attempts >= 5:
                raise HTTPException(400, "Too many failed attempts. Please request a new verification code.")
            else:
                raise HTTPException(400, f"Invalid verification code. {remaining} attempt(s) remaining.")

        otp_sess.verified = True
        record = store.get(payload.election_id)
        record.otp_verified[payload.voter_id] = True
        log_audit(db, payload.election_id, "OTP_VERIFIED", voter_identifier=payload.voter_id, detail="6-digit email OTP verified successfully")
        db.commit()

        return {
            "status": "verified",
            "voter_id": payload.voter_id,
            "election_id": payload.election_id,
            "message": "Email verification successful! You may now cast your secret vote."
        }
    finally:
        db.close()


@app.post("/vote/cast")
def cast_vote(payload: CastVoteIn):
    """
    Step 3: Relays vote on-chain. Enforces that voter has completed OTP verification (Step 2b).
    """
    record = store.get(payload.election_id)
    db = SessionLocal()

    try:
        if record.status == "PAUSED":
            log_audit(db, payload.election_id, "VOTE_RELAY_FAILED", voter_identifier=payload.voter_id, detail="Election is PAUSED")
            db.commit()
            raise HTTPException(400, f"Election #{payload.election_id} ('{record.title}') is currently PAUSED by the Administrator.")

        if record.status == "CLOSED":
            log_audit(db, payload.election_id, "VOTE_RELAY_FAILED", voter_identifier=payload.voter_id, detail="Election is CLOSED")
            db.commit()
            raise HTTPException(400, f"Election #{payload.election_id} ('{record.title}') has been CLOSED by the Administrator.")

        if not verify_identity(record.domain, payload.voter_id):
            log_audit(db, payload.election_id, "VOTE_RELAY_FAILED", voter_identifier=payload.voter_id, detail="Identity verification failed")
            db.commit()
            raise HTTPException(403, "Identity verification failed.")

        if payload.voter_id not in record.secrets:
            log_audit(db, payload.election_id, "VOTE_RELAY_FAILED", voter_identifier=payload.voter_id, detail="No OTP secret issued")
            db.commit()
            raise HTTPException(400, "Voter has not been issued an OTP secret yet.")

        if not record.otp_verified.get(payload.voter_id, False):
            log_audit(db, payload.election_id, "VOTE_RELAY_FAILED", voter_identifier=payload.voter_id, detail="OTP not verified")
            db.commit()
            raise HTTPException(400, "Voter has not completed OTP verification! Please verify your OTP before voting.")

        if record.merkle_tree is None:
            log_audit(db, payload.election_id, "VOTE_RELAY_FAILED", voter_identifier=payload.voter_id, detail="Merkle tree not built")
            db.commit()
            raise HTTPException(400, "Merkle tree not built on-chain yet by admin.")

        log_audit(db, payload.election_id, "VOTE_RELAY_ATTEMPT", voter_identifier=payload.voter_id, detail=f"Attempting to relay vote for candidate_id {payload.candidate_id}")
        db.commit()

        secret = record.secrets[payload.voter_id]
        leaf = Web3.keccak(text=secret)
        proof = record.merkle_tree.get_proof(leaf)

        log_audit(db, payload.election_id, "PROOF_GENERATED", voter_identifier=payload.voter_id, detail=f"Generated Merkle proof for leaf {leaf.hex()}")
        db.commit()

        w3 = get_web3()
        deployed = ensure_chain_sync(w3)
        election = get_election_contract(w3, record.address)

        sender = deployed.get("owner_account")
        current_accounts = [a.lower() for a in w3.eth.accounts]
        if not sender or sender.lower() not in current_accounts:
            sender = w3.eth.accounts[0]

        tx_hash = election.functions.castVote(
            payload.candidate_id, leaf, proof
        ).transact({"from": sender})
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash)

        tx_hex = receipt.transactionHash.hex()
        log_audit(db, payload.election_id, "VOTE_RELAY_SUCCESS", voter_identifier=payload.voter_id, detail=f"Vote relayed on-chain tx: {tx_hex}")
        db.commit()

        sync_results_to_db(payload.election_id)

    except HTTPException:
        raise
    except Exception as e:
        log_audit(db, payload.election_id, "VOTE_RELAY_FAILED", voter_identifier=payload.voter_id, detail=f"Smart contract rejected vote: {str(e)}")
        db.commit()
        raise HTTPException(400, f"Vote rejected by smart contract: {e}")
    finally:
        db.close()

    return {"status": "accepted", "tx_hash": receipt.transactionHash.hex()}


# ---------- Public results ----------

@app.get("/results/{election_id}")
def get_results(election_id: int):
    record = store.get(election_id)
    try:
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
    except Exception as e:
        db = SessionLocal()
        try:
            cached = db.query(ElectionResultsCacheModel).filter_by(election_id=election_id).all()
            if cached:
                total_votes = sum(c.vote_count for c in cached)
                return {
                    "election_id": election_id,
                    "title": record.title,
                    "candidates": [{"id": c.candidate_id, "name": c.candidate_name, "votes": c.vote_count} for c in cached],
                    "total_votes_cast": total_votes,
                    "blockchain_status": "offline",
                    "note": f"Displaying database cache. Blockchain node offline: {str(e)}"
                }
        finally:
            db.close()

        return {
            "election_id": election_id,
            "title": record.title,
            "candidates": [
                {"id": 0, "name": "Priya Sharma", "votes": 0},
                {"id": 1, "name": "Rahul Verma", "votes": 0},
                {"id": 2, "name": "Ananya Iyer", "votes": 0}
            ],
            "total_votes_cast": 0,
            "blockchain_status": "offline",
            "note": f"Blockchain node offline (http://127.0.0.1:8545). Start 'npx ganache' to sync live on-chain tallies."
        }
