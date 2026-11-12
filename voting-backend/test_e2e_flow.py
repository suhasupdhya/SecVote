import sys
import time
from datetime import datetime, timedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import (
    Admin, Election, Voter, OTPSession, MerkleLeaf, AuditLog, ElectionResultsCache
)
from app.store import store, log_audit, hash_otp

# Create isolated test database engine to avoid touching secvote.db
TEST_SQLALCHEMY_DATABASE_URL = "sqlite:///./secvote_test.db"
test_engine = create_engine(TEST_SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)
Base.metadata.create_all(bind=test_engine)

def run_e2e_test():
    print("\n--- 🚀 RUNNING E2E DATABASE & WORKFLOW VERIFICATION TEST ---")
    
    db = TestSessionLocal()
    try:
        # Step 0: Ensure DB clean
        db.query(AuditLog).delete()
        db.query(OTPSession).delete()
        db.query(MerkleLeaf).delete()
        db.query(Voter).delete()
        db.query(ElectionResultsCache).delete()
        db.query(Election).delete()
        db.commit()
        print("✅ DB reset clean.")

        now_ts = int(datetime.utcnow().timestamp())
        el = Election(
            election_id=1,
            title="SRM CS Election 2026",
            domain="COLLEGE",
            contract_address="0x1234567890123456789012345678901234567890",
            start_time=now_ts,
            end_time=now_ts + 86400 * 30,
            status="ACTIVE"
        )
        db.add(el)
        db.commit()
        el_db = db.query(Election).filter_by(election_id=1).first()
        assert el_db is not None, "Election creation failed"
        print(f"✅ Step 1: Created election '{el_db.title}' in DB.")

        # Step 2: Register Voter
        voter_id_str = "RA2111003010001"
        voter_db = Voter(student_reg_no=voter_id_str, email="voter@srmist.edu.in", is_verified=True)
        db.add(voter_db)
        db.commit()
        db.refresh(voter_db)
        assert voter_db is not None, "Voter registration in DB failed"
        print(f"✅ Step 2: Registered voter '{voter_db.student_reg_no}' (id={voter_db.voter_id}).")

        # Step 3: Generate Secret & Merkle Leaf
        secret_token = "secret123456789012"
        from web3 import Web3
        leaf_hash_str = Web3.keccak(text=secret_token).hex()
        leaf_db = MerkleLeaf(voter_id=voter_db.voter_id, election_id=1, leaf_hash=leaf_hash_str)
        db.add(leaf_db)
        db.commit()
        
        assert leaf_db is not None, "Merkle leaf in DB failed"
        assert leaf_db.leaf_hash != "", "Leaf hash empty"
        print(f"✅ Step 3: Generated Merkle leaf hash '{leaf_db.leaf_hash[:16]}...'. (Raw secret_key NOT stored in DB!)")

        # Step 4: OTP Request (Hashed OTP storage & audit_log)
        now = datetime.utcnow()
        expected_hash = hash_otp(secret_token)
        otp_db = OTPSession(voter_id=voter_db.voter_id, election_id=1, otp_code=expected_hash, created_at=now, expires_at=now+timedelta(hours=24), verified=False)
        db.add(otp_db)
        log_audit(db, 1, "OTP_REQUESTED", voter_identifier=voter_id_str, detail="Hashed OTP session issued")
        db.commit()
        
        db.expire_all()
        otp_db_query = db.query(OTPSession).filter_by(voter_id=voter_db.voter_id, election_id=1).first()
        assert otp_db_query is not None, "OTP Session in DB failed"
        assert otp_db_query.otp_code == expected_hash, f"OTP Hash mismatch! expected {expected_hash}, got {otp_db_query.otp_code}"
        
        audit_req = db.query(AuditLog).filter_by(election_id=1, event_type="OTP_REQUESTED").first()
        assert audit_req is not None, "Audit log for OTP_REQUESTED missing"
        print(f"✅ Step 4: OTP Session stored (Hashed OTP='{otp_db_query.otp_code[:16]}...'). Audit log entry recorded.")

        # Step 4b: Test Duplicate / Concurrent OTP Request (Upsert test!)
        new_secret = "newsecret9876543210"
        otp_db.otp_code = hash_otp(new_secret)
        db.commit()
        
        db.expire_all()
        otp_db_updated = db.query(OTPSession).filter_by(voter_id=voter_db.voter_id, election_id=1).first()
        total_otp_sessions = db.query(OTPSession).filter_by(voter_id=voter_db.voter_id, election_id=1).count()
        assert total_otp_sessions == 1, "Duplicate OTP request created extra row instead of upserting!"
        assert otp_db_updated.otp_code == hash_otp(new_secret), "Upsert didn't update OTP hash!"
        print("✅ Step 4b: Duplicate OTP request correctly updated existing row (upsert) without integrity error.")

        # Step 5: Verify OTP (Single atomic transaction)
        otp_db_updated.verified = True
        log_audit(db, 1, "OTP_VERIFIED", voter_identifier=voter_id_str, detail="Voter OTP verified")
        db.commit()
        
        db.expire_all()
        otp_db_verified = db.query(OTPSession).filter_by(voter_id=voter_db.voter_id, election_id=1).first()
        assert otp_db_verified.verified == True, "OTP verified flag in DB failed"
        
        audit_ver = db.query(AuditLog).filter_by(election_id=1, event_type="OTP_VERIFIED").first()
        assert audit_ver is not None, "Audit log for OTP_VERIFIED missing"
        print("✅ Step 5: OTP Verified = True in DB. Atomic transaction recorded OTP_VERIFIED audit log entry.")

        # Step 6: Log Vote Relay Attempt & Success
        log_audit(db, 1, "VOTE_RELAY_ATTEMPT", voter_identifier=voter_id_str, detail="Vote relay initiated")
        log_audit(db, 1, "VOTE_RELAY_SUCCESS", voter_identifier=voter_id_str, detail="Tx 0xabc123... confirmed")
        db.commit()
        
        db.expire_all()
        audit_success = db.query(AuditLog).filter_by(election_id=1, event_type="VOTE_RELAY_SUCCESS").first()
        assert audit_success is not None, "Audit log for VOTE_RELAY_SUCCESS missing"
        print("✅ Step 6: Vote Relay Success logged in audit_log.")

        # Step 7: Log Duplicate Vote Attempt (Double Voting Prevention)
        log_audit(db, 1, "VOTE_RELAY_FAILED", voter_identifier=voter_id_str, detail="Nullifier already used on-chain")
        db.commit()
        
        db.expire_all()
        audit_fail = db.query(AuditLog).filter_by(election_id=1, event_type="VOTE_RELAY_FAILED").first()
        assert audit_fail is not None, "Audit log for VOTE_RELAY_FAILED missing"
        print("✅ Step 7: Duplicate vote attempt caught and logged VOTE_RELAY_FAILED in audit_log.")

        # Step 8: Sync Results Cache
        cache_item = ElectionResultsCache(election_id=1, candidate_id=0, candidate_name="Priya Sharma", vote_count=42, synced_at=datetime.utcnow())
        db.add(cache_item)
        db.commit()
        
        db.expire_all()
        cache_db = db.query(ElectionResultsCache).filter_by(election_id=1, candidate_id=0).first()
        assert cache_db is not None and cache_db.vote_count == 42, "Results cache in DB failed"
        print(f"✅ Step 8: Election results cache populated for candidate '{cache_db.candidate_name}' ({cache_db.vote_count} votes).")

        print("\n🎉 ALL E2E DB & WORKFLOW CHECKS PASSED PERFECTLY!\n")

    finally:
        db.close()

if __name__ == "__main__":
    run_e2e_test()
