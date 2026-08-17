"""add mobile column to contact_messages (leads capture)

Revision ID: d8a3b1c2f4e5
Revises: c1d5a7f9e802
Create Date: 2026-08-17 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "d8a3b1c2f4e5"
down_revision = "c1d5a7f9e802"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nullable so existing rows keep validating; the marketing form makes it
    # required at the API level for NEW submissions only.
    op.add_column(
        "contact_messages",
        sa.Column("mobile", sa.String(length=32), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("contact_messages", "mobile")
