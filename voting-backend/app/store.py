from __future__ import annotations
import hashlib
from typing import Set, Dict, Optional, Any
from datetime import datetime, timedelta
from fastapi import HTTPException, status
from web3 import Web3

from sqlalchemy import func
from app.database import SessionLocal, engine, Base
from app.models import (
    Election as ElectionModel,
    Voter as VoterModel,
    OTPSession as OTPSessionModel,
    MerkleLeaf as MerkleLeafModel,
    AuditLog as AuditLogModel,
    ElectionResultsCache as ElectionResultsCacheModel
)
from app.merkle import MerkleTree

# Auto-create tables if they don't exist yet
Base.metadata.create_all(bind=engine)

# In-memory secret vault for ephemeral secret resolution during active session execution
_ephemeral_secrets_vault: Dict[tuple[int, str], str] = {}


def hash_otp(otp_code: str) -> str:
    """Computes SHA-256 hash of OTP code for secure DB storage."""
    return hashlib.sha256(otp_code.strip().encode("utf-8")).hexdigest()


def log_audit(db, election_id: int, event_type: str, voter_identifier: Optional[str] = None, detail: Optional[str] = None):
    """Helper to append entries to audit_log table within a session."""
    voter_id_fk = None
    if voter_identifier:
        voter = db.query(VoterModel).filter(
            (VoterModel.student_reg_no == voter_identifier) | (VoterModel.email == voter_identifier)
        ).first()
        if voter:
            voter_id_fk = voter.voter_id

    log_entry = AuditLogModel(
        event_type=event_type,
        voter_id=voter_id_fk,
        election_id=election_id,
        detail=detail or f"Event {event_type} logged",
        created_at=datetime.utcnow()
    )
    db.add(log_entry)


class EligibleVotersProxy:
    """Provides set-like interface to voters registered for an election in DB."""
    def __init__(self, election_id: int):
        self.election_id = election_id

    def _get_voter_ids(self) -> Set[str]:
        db = SessionLocal()
        try:
            leaves = db.query(VoterModel.student_reg_no).join(
                MerkleLeafModel, VoterModel.voter_id == MerkleLeafModel.voter_id
            ).filter(MerkleLeafModel.election_id == self.election_id).all()
            return {r[0] for r in leaves}
        finally:
            db.close()

    def update(self, voter_ids: list[str] | set[str]):
        db = SessionLocal()
        try:
            for vid in voter_ids:
                voter = db.query(VoterModel).filter(
                    (VoterModel.student_reg_no == vid) | (VoterModel.email == vid)
                ).first()
                if not voter:
                    voter = VoterModel(student_reg_no=vid, email=vid, is_verified=True)
                    db.add(voter)
                    db.flush()

                leaf = db.query(MerkleLeafModel).filter_by(
                    voter_id=voter.voter_id, election_id=self.election_id
                ).first()
                if not leaf:
                    leaf = MerkleLeafModel(
                        voter_id=voter.voter_id,
                        election_id=self.election_id,
                        leaf_hash=""
                    )
                    db.add(leaf)

            log_audit(db, self.election_id, "ELIGIBLE_VOTERS_REGISTERED", detail=f"Registered {len(voter_ids)} eligible voters")
            db.commit()
        except Exception as e:
            db.rollback()
            raise e
        finally:
            db.close()

    def __contains__(self, vid: str) -> bool:
        vid_clean = vid.strip().lower()
        return any(v.strip().lower() == vid_clean for v in self._get_voter_ids())

    def __len__(self) -> int:
        return len(self._get_voter_ids())

    def __iter__(self):
        return iter(self._get_voter_ids())


class SecretsProxy:
    """Provides dict-like interface for voter secrets (leaf_hash stored in DB, raw secret in ephemeral vault)."""
    def __init__(self, election_id: int):
        self.election_id = election_id

    def __getitem__(self, vid: str) -> str:
        key = (self.election_id, vid)
        if key in _ephemeral_secrets_vault:
            return _ephemeral_secrets_vault[key]

        # Case-insensitive lookup in ephemeral vault
        for (eid, v), sec in _ephemeral_secrets_vault.items():
            if eid == self.election_id and v.strip().lower() == vid.strip().lower():
                return sec

        # Fallback if secret missing from vault: generate a new secret for this voter
        import secrets as pysecrets
        new_secret = pysecrets.token_hex(16)
        self[vid] = new_secret
        return new_secret

    def get(self, vid: str, default: Optional[str] = None) -> Optional[str]:
        try:
            return self[vid]
        except Exception:
            return default

    def __setitem__(self, vid: str, secret: str):
        key = (self.election_id, vid)
        _ephemeral_secrets_vault[key] = secret

        db = SessionLocal()
        try:
            voter = db.query(VoterModel).filter(
                (VoterModel.student_reg_no.ilike(vid.strip())) | (VoterModel.email.ilike(vid.strip()))
            ).first()
            if not voter:
                voter = VoterModel(student_reg_no=vid, email=vid, is_verified=True)
                db.add(voter)
                db.flush()

            leaf_hash_str = Web3.keccak(text=secret).hex()
            leaf = db.query(MerkleLeafModel).filter_by(
                voter_id=voter.voter_id, election_id=self.election_id
            ).first()
            if leaf:
                leaf.leaf_hash = leaf_hash_str
            else:
                leaf = MerkleLeafModel(
                    voter_id=voter.voter_id,
                    election_id=self.election_id,
                    leaf_hash=leaf_hash_str
                )
                db.add(leaf)

            # Store HASHED OTP in otp_sessions table
            now = datetime.utcnow()
            expires = now + timedelta(hours=24)
            hashed_code = hash_otp(secret)

            otp_sess = db.query(OTPSessionModel).filter_by(
                voter_id=voter.voter_id, election_id=self.election_id
            ).first()

            if otp_sess:
                otp_sess.otp_code = hashed_code
                otp_sess.created_at = now
                otp_sess.expires_at = expires
                otp_sess.attempts = 0
                otp_sess.verified = False
            else:
                otp_sess = OTPSessionModel(
                    voter_id=voter.voter_id,
                    election_id=self.election_id,
                    otp_code=hashed_code,
                    created_at=now,
                    expires_at=expires,
                    attempts=0,
                    verified=False
                )
                db.add(otp_sess)

            log_audit(db, self.election_id, "OTP_REQUESTED", voter_identifier=vid, detail=f"Hashed OTP session issued for voter {vid}")
            db.commit()
        except Exception as e:
            db.rollback()
            raise e
        finally:
            db.close()

    def __contains__(self, vid: str) -> bool:
        key = (self.election_id, vid)
        if key in _ephemeral_secrets_vault:
            return True
        for (eid, v), sec in _ephemeral_secrets_vault.items():
            if eid == self.election_id and v.strip().lower() == vid.strip().lower():
                return True
        db = SessionLocal()
        try:
            voter = db.query(VoterModel).filter(
                (VoterModel.student_reg_no.ilike(vid.strip())) | (VoterModel.email.ilike(vid.strip()))
            ).first()
            if not voter:
                return False
            leaf = db.query(MerkleLeafModel).filter_by(
                voter_id=voter.voter_id, election_id=self.election_id
            ).first()
            return leaf is not None
        finally:
            db.close()

    def values(self) -> list[str]:
        res = []
        for (eid, vid), sec in _ephemeral_secrets_vault.items():
            if eid == self.election_id:
                res.append(sec)
        return res

    def __len__(self) -> int:
        return len(self.values())


class OTPVerifiedProxy:
    """Provides dict-like interface for OTP verification status in DB."""
    def __init__(self, election_id: int):
        self.election_id = election_id

    def __getitem__(self, vid: str) -> bool:
        return self.get(vid, False)

    def __setitem__(self, vid: str, status_bool: bool):
        db = SessionLocal()
        try:
            voter = db.query(VoterModel).filter(
                (VoterModel.student_reg_no == vid) | (VoterModel.email == vid)
            ).first()
            if not voter:
                raise HTTPException(status.HTTP_404_NOT_FOUND, f"Voter {vid} not found")

            otp_sess = db.query(OTPSessionModel).filter_by(
                voter_id=voter.voter_id, election_id=self.election_id
            ).first()

            if otp_sess:
                otp_sess.verified = status_bool
                otp_sess.attempts += 1
            else:
                now = datetime.utcnow()
                otp_sess = OTPSessionModel(
                    voter_id=voter.voter_id,
                    election_id=self.election_id,
                    otp_code="N/A",
                    created_at=now,
                    expires_at=now + timedelta(hours=24),
                    attempts=1,
                    verified=status_bool
                )
                db.add(otp_sess)

            event_type = "OTP_VERIFIED" if status_bool else "OTP_FAILED"
            log_audit(db, self.election_id, event_type, voter_identifier=vid, detail=f"Voter {vid} OTP verification status set to {status_bool}")

            db.commit()
        except Exception as e:
            db.rollback()
            raise e
        finally:
            db.close()

    def get(self, vid: str, default: bool = False) -> bool:
        db = SessionLocal()
        try:
            voter = db.query(VoterModel).filter(
                (VoterModel.student_reg_no == vid) | (VoterModel.email == vid)
            ).first()
            if not voter:
                return default

            otp_sess = db.query(OTPSessionModel).filter_by(
                voter_id=voter.voter_id, election_id=self.election_id
            ).first()
            if not otp_sess or not otp_sess.verified:
                return False
            if datetime.utcnow() > otp_sess.expires_at:
                return False
            return True
        finally:
            db.close()


class ElectionRecordProxy:
    """DB-backed proxy matching the original ElectionRecord interface."""
    def __init__(self, election_id: int):
        self.election_id = election_id
        self._cached_merkle_tree: Optional[MerkleTree] = None

    def _get_election(self) -> ElectionModel:
        db = SessionLocal()
        try:
            el = db.query(ElectionModel).filter_by(election_id=self.election_id).first()
            if not el:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"No election registered with ID #{self.election_id}"
                )
            return el
        finally:
            db.close()

    @property
    def address(self) -> str:
        return self._get_election().contract_address

    @property
    def domain(self) -> str:
        return self._get_election().domain

    @property
    def title(self) -> str:
        return self._get_election().title

    @property
    def status(self) -> str:
        return self._get_election().status or "ACTIVE"

    def set_status(self, new_status: str):
        db = SessionLocal()
        try:
            el = db.query(ElectionModel).filter_by(election_id=self.election_id).first()
            if el:
                el.status = new_status
                log_audit(db, self.election_id, f"ELECTION_STATUS_{new_status}", detail=f"Election status changed to {new_status}")
                db.commit()
        except Exception as e:
            db.rollback()
            raise e
        finally:
            db.close()

    @property
    def eligible_voters(self) -> EligibleVotersProxy:
        return EligibleVotersProxy(self.election_id)

    @property
    def secrets(self) -> SecretsProxy:
        return SecretsProxy(self.election_id)

    @secrets.setter
    def secrets(self, secrets_dict: dict[str, str]):
        proxy = SecretsProxy(self.election_id)
        for vid, sec in secrets_dict.items():
            proxy[vid] = sec

    @property
    def otp_verified(self) -> OTPVerifiedProxy:
        return OTPVerifiedProxy(self.election_id)

    @property
    def merkle_tree(self) -> Optional[MerkleTree]:
        if self._cached_merkle_tree is not None:
            return self._cached_merkle_tree

        secrets_list = SecretsProxy(self.election_id).values()
        if secrets_list:
            leaves = [Web3.keccak(text=s) for s in secrets_list]
            tree = MerkleTree(leaves)
            self._cached_merkle_tree = tree
            return tree
        return None

    @merkle_tree.setter
    def merkle_tree(self, tree: MerkleTree):
        self._cached_merkle_tree = tree
        db = SessionLocal()
        try:
            el = db.query(ElectionModel).filter_by(election_id=self.election_id).first()
            if el and tree:
                el.merkle_root = tree.root.hex()
                log_audit(db, self.election_id, "PROOF_GENERATED", detail=f"Merkle root updated to {tree.root.hex()}")
                db.commit()
        except Exception as e:
            db.rollback()
            raise e
        finally:
            db.close()


class Store:
    """DB-backed Store matching original Store class interface."""
    def add_election(self, election_id: int, address: str, domain: str, title: str = "Demo Election", force_new: bool = False) -> int:
        db = SessionLocal()
        try:
            el = db.query(ElectionModel).filter_by(election_id=election_id).first()
            if el and (force_new or el.title != title):
                # If a new election is requested or an existing ID has a different title,
                # assign a brand new unique election_id so the existing booth is never replaced/overwritten!
                max_id = db.query(func.max(ElectionModel.election_id)).scalar()
                election_id = (max_id + 1) if max_id is not None else (election_id + 1)
                el = None

            if not el:
                now_ts = int(datetime.utcnow().timestamp())
                el = ElectionModel(
                    election_id=election_id,
                    title=title,
                    domain=domain,
                    contract_address=address,
                    start_time=now_ts,
                    end_time=now_ts + 86400 * 30,
                    status="ACTIVE"
                )
                db.add(el)
                log_audit(db, election_id, "ELECTION_CREATED", detail=f"Created election {title} ({domain}) at {address}")
            else:
                el.contract_address = address
                el.title = title
                el.domain = domain
                log_audit(db, election_id, "ELECTION_UPDATED", detail=f"Updated contract address for election #{election_id} to {address}")
            db.commit()
            return election_id
        except Exception as e:
            db.rollback()
            raise e
        finally:
            db.close()

    def get(self, election_id: int) -> ElectionRecordProxy:
        db = SessionLocal()
        try:
            el = db.query(ElectionModel).filter_by(election_id=election_id).first()
            if not el:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"No election registered with ID #{election_id}"
                )
            return ElectionRecordProxy(election_id)
        finally:
            db.close()

    @property
    def elections(self) -> Dict[int, ElectionRecordProxy]:
        db = SessionLocal()
        try:
            elections_db = db.query(ElectionModel.election_id).all()
            return {e[0]: ElectionRecordProxy(e[0]) for e in elections_db}
        finally:
            db.close()


store = Store()
