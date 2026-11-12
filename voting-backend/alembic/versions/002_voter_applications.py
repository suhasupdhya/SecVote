"""Add voter_applications table

Revision ID: 002
Revises: 001
Create Date: 2026-08-08 13:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '002'
down_revision = '001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'voter_applications',
        sa.Column('application_id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('election_id', sa.Integer(), nullable=False),
        sa.Column('student_reg_no', sa.String(length=100), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('pdf_proof_path', sa.String(length=500), nullable=False),
        sa.Column('status', sa.String(length=50), nullable=False),
        sa.Column('submitted_at', sa.DateTime(), nullable=False),
        sa.Column('reviewed_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['election_id'], ['elections.election_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('application_id'),
        sa.UniqueConstraint('election_id', 'student_reg_no', name='uq_election_voter_app')
    )


def downgrade() -> None:
    op.drop_table('voter_applications')
