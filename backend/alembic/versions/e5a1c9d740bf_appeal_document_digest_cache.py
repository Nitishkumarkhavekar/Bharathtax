"""cache document digests on appeal_documents

Revision ID: e5a1c9d740bf
Revises: d4f0b1e83a29
Create Date: 2026-07-12 08:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 'e5a1c9d740bf'
down_revision = 'd4f0b1e83a29'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Cached LLM digest of the document text, so re-runs of a case skip the
    # per-document digest cost. NULL = not yet digested.
    op.add_column("appeal_documents", sa.Column("digest", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("appeal_documents", "digest")
