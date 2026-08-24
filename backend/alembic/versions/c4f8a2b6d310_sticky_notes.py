"""daily workspace: sticky notes

Revision ID: c4f8a2b6d310
Revises: b3e7d9a1c204
Create Date: 2026-08-24 13:00:00.000000

Adds sticky_notes — colour-coded notes pinned to a matter (and optionally a
section / source). Idempotent (IF NOT EXISTS) to stay safe alongside the
boot-time create_all/patch schema path this deployment also uses.
"""
from alembic import op


revision = "c4f8a2b6d310"
down_revision = "b3e7d9a1c204"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS sticky_notes (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            matter_id INTEGER REFERENCES matters(id) ON DELETE CASCADE,
            body TEXT NOT NULL,
            color VARCHAR(16) NOT NULL DEFAULT 'yellow',
            section_ref VARCHAR(40),
            source VARCHAR(120),
            pinned BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS sticky_notes_user_id_idx ON sticky_notes (user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS sticky_notes_matter_id_idx ON sticky_notes (matter_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS sticky_notes")
