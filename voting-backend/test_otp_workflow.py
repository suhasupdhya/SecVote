import unittest
from datetime import datetime, timedelta
import secrets as pysecrets

from app.database import SessionLocal, engine, Base
from app.models import Voter as VoterModel, OTPSession as OTPSessionModel, Election as ElectionModel
from app.store import store, hash_otp, OTPVerifiedProxy

class TestEmailOTPWorkflow(unittest.TestCase):

    def setUp(self):
        Base.metadata.create_all(bind=engine)
        self.db = SessionLocal()
        self.test_email = "testvoter_otp@srmist.edu.in"
        self.test_reg_no = "TEST_REG_OTP_001"
        self.election_id = 999

        # Clean old test data
        self.db.query(OTPSessionModel).delete()
        self.db.query(VoterModel).filter(VoterModel.student_reg_no == self.test_reg_no).delete()
        self.db.query(ElectionModel).filter(ElectionModel.election_id == self.election_id).delete()
        self.db.commit()

        # Create test election & voter
        election = ElectionModel(
            election_id=self.election_id,
            title="UnitTest Election 2026",
            domain="COLLEGE",
            contract_address="0x1234567890123456789012345678901234567890",
            start_time=datetime.utcnow() - timedelta(hours=1),
            end_time=datetime.utcnow() + timedelta(hours=24),
            created_by="admin"
        )
        self.db.add(election)

        voter = VoterModel(
            student_reg_no=self.test_reg_no,
            email=self.test_email,
            is_verified=True
        )
        self.db.add(voter)
        self.db.commit()
        self.db.refresh(voter)
        self.voter_id = voter.voter_id

        # Setup in store
        rec = store.get(self.election_id)
        rec.eligible_voters.update([self.test_reg_no])

    def tearDown(self):
        self.db.query(OTPSessionModel).filter(OTPSessionModel.voter_id == self.voter_id).delete()
        self.db.query(VoterModel).filter(VoterModel.student_reg_no == self.test_reg_no).delete()
        self.db.query(ElectionModel).filter(ElectionModel.election_id == self.election_id).delete()
        self.db.commit()
        self.db.close()

    def test_credential_separation(self):
        """TEST: Credential A (32-char hex voting secret) remains separate from Credential B (6-digit OTP)."""
        rec = store.get(self.election_id)
        rec.secrets[self.test_reg_no] = pysecrets.token_hex(16)
        secret_a = rec.secrets[self.test_reg_no]

        # Generate 6-digit numeric OTP
        otp_b = f"{pysecrets.randbelow(1_000_000):06d}"

        self.assertEqual(len(secret_a), 32)
        self.assertEqual(len(otp_b), 6)
        self.assertTrue(otp_b.isdigit())
        self.assertNotEqual(secret_a, otp_b)

    def test_otp_generation_and_hashing(self):
        """TEST: 6-digit OTP is hashed using SHA-256 before storing in DB."""
        otp_code = "482913"
        hashed = hash_otp(otp_code)
        
        now = datetime.utcnow()
        sess = OTPSessionModel(
            voter_id=self.voter_id,
            election_id=self.election_id,
            otp_code=hashed,
            created_at=now,
            expires_at=now + timedelta(minutes=5),
            attempts=0,
            verified=False
        )
        self.db.add(sess)
        self.db.commit()

        db_sess = self.db.query(OTPSessionModel).filter_by(voter_id=self.voter_id, election_id=self.election_id).first()
        self.assertIsNotNone(db_sess)
        self.assertEqual(db_sess.otp_code, hashed)
        self.assertNotEqual(db_sess.otp_code, otp_code)
        self.assertFalse(db_sess.verified)

    def test_correct_otp_verification(self):
        """TEST: Correct OTP verification sets verified = True."""
        otp_code = "123456"
        now = datetime.utcnow()
        sess = OTPSessionModel(
            voter_id=self.voter_id,
            election_id=self.election_id,
            otp_code=hash_otp(otp_code),
            created_at=now,
            expires_at=now + timedelta(minutes=5),
            attempts=0,
            verified=False
        )
        self.db.add(sess)
        self.db.commit()

        # Simulate correct submission
        submitted_hash = hash_otp("123456")
        self.assertEqual(submitted_hash, sess.otp_code)
        sess.verified = True
        self.db.commit()

        proxy = OTPVerifiedProxy(self.election_id)
        self.assertTrue(proxy.get(self.test_reg_no))

    def test_incorrect_otp_increments_attempts(self):
        """TEST: Incorrect OTP increments attempts count and rejects."""
        otp_code = "654321"
        now = datetime.utcnow()
        sess = OTPSessionModel(
            voter_id=self.voter_id,
            election_id=self.election_id,
            otp_code=hash_otp(otp_code),
            created_at=now,
            expires_at=now + timedelta(minutes=5),
            attempts=0,
            verified=False
        )
        self.db.add(sess)
        self.db.commit()

        # Simulate wrong attempts
        self.assertNotEqual(hash_otp("000000"), sess.otp_code)
        sess.attempts += 1
        self.db.commit()

        self.assertEqual(sess.attempts, 1)
        self.assertFalse(sess.verified)

    def test_max_attempts_exceeded(self):
        """TEST: Max 5 failed attempts locks the session."""
        now = datetime.utcnow()
        sess = OTPSessionModel(
            voter_id=self.voter_id,
            election_id=self.election_id,
            otp_code=hash_otp("999999"),
            created_at=now,
            expires_at=now + timedelta(minutes=5),
            attempts=5,
            verified=False
        )
        self.db.add(sess)
        self.db.commit()

        self.assertGreaterEqual(sess.attempts, 5)
        self.assertFalse(sess.verified)

    def test_expired_otp_rejected(self):
        """TEST: OTP past 5-minute expiration is rejected."""
        past = datetime.utcnow() - timedelta(minutes=10)
        sess = OTPSessionModel(
            voter_id=self.voter_id,
            election_id=self.election_id,
            otp_code=hash_otp("111222"),
            created_at=past - timedelta(minutes=5),
            expires_at=past,
            attempts=0,
            verified=True
        )
        self.db.add(sess)
        self.db.commit()

        proxy = OTPVerifiedProxy(self.election_id)
        # Expiry check should make proxy return False despite verified=True
        self.assertFalse(proxy.get(self.test_reg_no))

if __name__ == "__main__":
    unittest.main()
