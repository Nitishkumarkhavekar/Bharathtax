"""add sections_cited to corpus_documents (+GIN index)

Powers "every case on Section 68": a text[] of the top-level Income-tax Act
sections each judgment/circular cites, GIN-indexed for fast @> lookup.

Revision ID: a1c7f2e9b4d0
Revises: 3e1329648201
Create Date: 2026-07-03 10:20:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY


revision = 'a1c7f2e9b4d0'
down_revision = '3e1329648201'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("corpus_documents",
                  sa.Column("sections_cited", ARRAY(sa.String()), nullable=True))
    op.create_index("ix_corpus_documents_sections_cited", "corpus_documents",
                    ["sections_cited"], postgresql_using="gin")


def downgrade() -> None:
    op.drop_index("ix_corpus_documents_sections_cited", table_name="corpus_documents")
    op.drop_column("corpus_documents", "sections_cited")
