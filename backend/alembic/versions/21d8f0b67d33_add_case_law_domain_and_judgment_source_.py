"""add case_law domain and judgment source type

Revision ID: 21d8f0b67d33
Revises: 6ec82105cb75
Create Date: 2026-06-25 16:54:56.395532
"""
from alembic import op
import sqlalchemy as sa


revision = '21d8f0b67d33'
down_revision = '6ec82105cb75'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # PG enums: add the new values (idempotent). ADD VALUE can't run in a txn block,
    # so use autocommit for these statements.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE domain ADD VALUE IF NOT EXISTS 'case_law'")
        op.execute("ALTER TYPE sourcetype ADD VALUE IF NOT EXISTS 'judgment'")


def downgrade() -> None:
    # PostgreSQL does not support removing a value from an enum type.
    pass
