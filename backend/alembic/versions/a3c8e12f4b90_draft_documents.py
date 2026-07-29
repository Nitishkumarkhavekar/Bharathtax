"""officer drafting suite: draft_documents

Revision ID: a3c8e12f4b90
Revises: f7b2c4d9e310
Create Date: 2026-07-26 12:00:00.000000

Idempotent (IF NOT EXISTS) to match the boot-time create_all/patch schema path.
"""
from alembic import op


revision = "a3c8e12f4b90"
down_revision = "f7b2c4d9e310"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS draft_documents (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            wing_id INTEGER REFERENCES wings(id),
            kind VARCHAR(40) NOT NULL,
            title VARCHAR(300) NOT NULL DEFAULT '',
            inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
            content TEXT NOT NULL DEFAULT '',
            status VARCHAR(16) NOT NULL DEFAULT 'draft',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS draft_documents_user_id_idx ON draft_documents (user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS draft_documents_kind_idx ON draft_documents (kind)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS draft_documents")
