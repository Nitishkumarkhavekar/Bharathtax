"""add free-text user designation (job title)

Revision ID: d4f0b1e83a29
Revises: c3e9a1f27b58
Create Date: 2026-07-11 15:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 'd4f0b1e83a29'
down_revision = 'c3e9a1f27b58'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Free-text job title. NULL falls back to the role name in the UI, so every
    # existing user keeps a sensible label without a data backfill.
    op.add_column("users", sa.Column("designation", sa.String(length=100), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "designation")
