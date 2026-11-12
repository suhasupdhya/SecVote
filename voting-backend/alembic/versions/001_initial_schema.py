"""Initial schema setup with security constraints

Revision ID: 001
Revises: 
Create Date: 2026-08-08 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'admins',
        sa.Column('admin_id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('username', sa.String(length=100), nullable=False),
        sa.Column('password_hash', sa.String(length=255), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('admin_id'),
        sa.UniqueConstraint('username')
    )

    op.create_table(
        'elections',
        sa.Column('election_id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('start_time', sa.BigInteger(), nullable=False),
        sa.Column('end_time', sa.BigInteger(), nullable=False),
        sa.Column('status', sa.String(length=50), nullable=False),
        sa.Column('contract_address', sa.String(length=42), nullable=False),
        sa.Column('domain', sa.String(length=50), nullable=False),
        sa.Column('merkle_root', sa.String(length=66), nullable=True),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint('end_time > start_time', name='check_election_times'),
        sa.ForeignKeyConstraint(['created_by'], ['admins.admin_id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('election_id')
    )

    op.create_table(
        'voters',
        sa.Column('voter_id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('student_reg_no', sa.String(length=100), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('is_verified', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('voter_id'),
        sa.UniqueConstraint('email'),
        sa.UniqueConstraint('student_reg_no')
    )

    op.create_table(
        'audit_log',
        sa.Column('log_id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('event_type', sa.String(length=100), nullable=False),
        sa.Column('voter_id', sa.Integer(), nullable=True),
        sa.Column('election_id', sa.Integer(), nullable=False),
        sa.Column('detail', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['election_id'], ['elections.election_id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['voter_id'], ['voters.voter_id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('log_id')
    )

    op.create_table(
        'election_results_cache',
        sa.Column('cache_id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('election_id', sa.Integer(), nullable=False),
        sa.Column('candidate_id', sa.Integer(), nullable=False),
        sa.Column('candidate_name', sa.String(length=255), nullable=True),
        sa.Column('vote_count', sa.Integer(), nullable=False),
        sa.Column('synced_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['election_id'], ['elections.election_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('cache_id'),
        sa.UniqueConstraint('election_id', 'candidate_id', name='uq_election_candidate')
    )

    op.create_table(
        'merkle_leaves',
        sa.Column('leaf_id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('voter_id', sa.Integer(), nullable=False),
        sa.Column('election_id', sa.Integer(), nullable=False),
        sa.Column('leaf_hash', sa.String(length=66), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['election_id'], ['elections.election_id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['voter_id'], ['voters.voter_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('leaf_id'),
        sa.UniqueConstraint('voter_id', 'election_id', name='uq_voter_election_leaf')
    )

    op.create_table(
        'otp_sessions',
        sa.Column('session_id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('voter_id', sa.Integer(), nullable=False),
        sa.Column('election_id', sa.Integer(), nullable=False),
        sa.Column('otp_code', sa.String(length=255), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('attempts', sa.Integer(), nullable=False),
        sa.Column('verified', sa.Boolean(), nullable=False),
        sa.CheckConstraint('expires_at > created_at', name='check_otp_expiration'),
        sa.ForeignKeyConstraint(['election_id'], ['elections.election_id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['voter_id'], ['voters.voter_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('session_id'),
        sa.UniqueConstraint('voter_id', 'election_id', name='uq_voter_election_otp')
    )


def downgrade() -> None:
    op.drop_table('otp_sessions')
    op.drop_table('merkle_leaves')
    op.drop_table('election_results_cache')
    op.drop_table('audit_log')
    op.drop_table('voters')
    op.drop_table('elections')
    op.drop_table('admins')
