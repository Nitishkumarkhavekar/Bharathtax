"""add digest (LLM headnote) to corpus_documents

Revision ID: b2d8e3a1c9f7
Revises: a1c7f2e9b4d0
Create Date: 2026-07-03 12:40:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 'b2d8e3a1c9f7'
down_revision = 'a1c7f2e9b4d0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("corpus_documents", sa.Column("digest", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("corpus_documents", "digest")
