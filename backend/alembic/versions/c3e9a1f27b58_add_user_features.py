"""add per-user feature entitlements (module access)

Revision ID: c3e9a1f27b58
Revises: b2d8e3a1c9f7
Create Date: 2026-07-11 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY


revision = 'c3e9a1f27b58'
down_revision = 'b2d8e3a1c9f7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # NULL == all modules, so every existing user keeps full access by default.
    op.add_column("users", sa.Column("features", ARRAY(sa.String()), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "features")
