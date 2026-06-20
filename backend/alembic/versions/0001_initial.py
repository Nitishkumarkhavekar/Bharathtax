"""initial schema: pgvector extension + all tables + HNSW/GIN indexes

Revision ID: 0001_initial
Revises:
Create Date: 2026-06-20

The full schema is defined declaratively in app.models. Rather than restate
twelve tables here, we ensure the `vector` extension exists, then build
everything from Base.metadata (which includes the Vector columns, the tsvector
generated columns, and the HNSW/GIN indexes declared via __table_args__).
Subsequent migrations use normal autogenerate.
"""
from alembic import op

from app.core.db import Base
import app.models  # noqa: F401  (register all tables)

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    Base.metadata.create_all(bind=bind)


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind)
