from datetime import datetime
from sqlalchemy import (
    Column,
    Integer,
    BigInteger,
    String,
    Text,
    Boolean,
    DateTime,
    ForeignKey,
    UniqueConstraint,
    CheckConstraint
)
from sqlalchemy.orm import relationship
from app.database import Base


class Admin(Base):
    """Admin users table."""
    __tablename__ = "admins"

    admin_id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(100), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    created_elections = relationship("Election", back_populates="creator")


class Election(Base):
    """Elections metadata table."""
    __tablename__ = "elections"

    election_id = Column(Integer, primary_key=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    start_time = Column(BigInteger, nullable=False)
    end_time = Column(BigInteger, nullable=False)
    status = Column(String(50), default="CREATED", nullable=False)
    contract_address = Column(String(42), nullable=False)
    domain = Column(String(50), default="COLLEGE", nullable=False)
    merkle_root = Column(String(66), nullable=True)
    created_by = Column(Integer, ForeignKey("admins.admin_id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    creator = relationship("Admin", back_populates="created_elections")
    otp_sessions = relationship("OTPSession", back_populates="election", cascade="all, delete-orphan")
    merkle_leaves = relationship("MerkleLeaf", back_populates="election", cascade="all, delete-orphan")
    audit_logs = relationship("AuditLog", back_populates="election", cascade="all, delete-orphan")
    results_cache = relationship("ElectionResultsCache", back_populates="election", cascade="all, delete-orphan")
    applications = relationship("VoterApplication", back_populates="election", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint("end_time > start_time", name="check_election_times"),
    )


class Voter(Base):
    """Voter identity table with Email & Password auth."""
    __tablename__ = "voters"

    voter_id = Column(Integer, primary_key=True, autoincrement=True)
    student_reg_no = Column(String(100), unique=True, nullable=False)
    email = Column(String(255), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=True)
    is_verified = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    otp_sessions = relationship("OTPSession", back_populates="voter", cascade="all, delete-orphan")
    merkle_leaves = relationship("MerkleLeaf", back_populates="voter", cascade="all, delete-orphan")
    audit_logs = relationship("AuditLog", back_populates="voter")


class OTPSession(Base):
    """OTP sessions for voter authentication."""
    __tablename__ = "otp_sessions"

    session_id = Column(Integer, primary_key=True, autoincrement=True)
    voter_id = Column(Integer, ForeignKey("voters.voter_id", ondelete="CASCADE"), nullable=False)
    election_id = Column(Integer, ForeignKey("elections.election_id", ondelete="CASCADE"), nullable=False)
    otp_code = Column(String(255), nullable=False)  # Stores SHA-256 hash of OTP code for security
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    attempts = Column(Integer, default=0, nullable=False)
    verified = Column(Boolean, default=False, nullable=False)

    # Relationships
    voter = relationship("Voter", back_populates="otp_sessions")
    election = relationship("Election", back_populates="otp_sessions")

    __table_args__ = (
        UniqueConstraint("voter_id", "election_id", name="uq_voter_election_otp"),
        CheckConstraint("expires_at > created_at", name="check_otp_expiration"),
    )


class MerkleLeaf(Base):
    """Off-chain Merkle leaf store (leaf_hash only for verification, raw secret_key NOT persisted)."""
    __tablename__ = "merkle_leaves"

    leaf_id = Column(Integer, primary_key=True, autoincrement=True)
    voter_id = Column(Integer, ForeignKey("voters.voter_id", ondelete="CASCADE"), nullable=False)
    election_id = Column(Integer, ForeignKey("elections.election_id", ondelete="CASCADE"), nullable=False)
    leaf_hash = Column(String(66), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    voter = relationship("Voter", back_populates="merkle_leaves")
    election = relationship("Election", back_populates="merkle_leaves")

    __table_args__ = (
        UniqueConstraint("voter_id", "election_id", name="uq_voter_election_leaf"),
    )


class AuditLog(Base):
    """Off-chain audit trail for security and compliance."""
    __tablename__ = "audit_log"

    log_id = Column(Integer, primary_key=True, autoincrement=True)
    event_type = Column(String(100), nullable=False)
    voter_id = Column(Integer, ForeignKey("voters.voter_id", ondelete="SET NULL"), nullable=True)
    election_id = Column(Integer, ForeignKey("elections.election_id", ondelete="CASCADE"), nullable=False)
    detail = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    voter = relationship("Voter", back_populates="audit_logs")
    election = relationship("Election", back_populates="audit_logs")


class ElectionResultsCache(Base):
    """Periodic off-chain cache of smart contract getResults() tally."""
    __tablename__ = "election_results_cache"

    cache_id = Column(Integer, primary_key=True, autoincrement=True)
    election_id = Column(Integer, ForeignKey("elections.election_id", ondelete="CASCADE"), nullable=False)
    candidate_id = Column(Integer, nullable=False)
    candidate_name = Column(String(255), nullable=True)
    vote_count = Column(Integer, default=0, nullable=False)
    synced_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    election = relationship("Election", back_populates="results_cache")

    __table_args__ = (
        UniqueConstraint("election_id", "candidate_id", name="uq_election_candidate"),
    )


class VoterApplication(Base):
    """Voter booth application with uploaded ID proof PDF."""
    __tablename__ = "voter_applications"

    application_id = Column(Integer, primary_key=True, autoincrement=True)
    election_id = Column(Integer, ForeignKey("elections.election_id", ondelete="CASCADE"), nullable=False)
    student_reg_no = Column(String(100), nullable=False)
    email = Column(String(255), nullable=False)
    pdf_proof_path = Column(String(500), nullable=False)
    status = Column(String(50), default="PENDING", nullable=False)  # PENDING, APPROVED, REJECTED
    submitted_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    reviewed_at = Column(DateTime, nullable=True)

    # Relationships
    election = relationship("Election", back_populates="applications")

    __table_args__ = (
        UniqueConstraint("election_id", "student_reg_no", name="uq_election_voter_app"),
    )
