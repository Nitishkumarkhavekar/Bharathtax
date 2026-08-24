"""daily workspace: templates, watchlists, matter shares

Revision ID: d5a9c3f1e720
Revises: c4f8a2b6d310
Create Date: 2026-08-24 14:00:00.000000

Adds the P1/P2 batch tables:
- workspace_templates — a user's reusable drafting templates
- watchlists          — saved section/topic/assessee watches
- matter_shares       — collaboration: share a matter with another user

Idempotent (IF NOT EXISTS) to stay safe alongside the boot-time create_all
schema path this deployment also uses.
"""
from alembic import op


revision = "d5a9c3f1e720"
down_revision = "c4f8a2b6d310"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS workspace_templates (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name VARCHAR(120) NOT NULL,
            category VARCHAR(32) NOT NULL DEFAULT 'other',
            body TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS workspace_templates_user_id_idx ON workspace_templates (user_id)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS watchlists (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            label VARCHAR(120) NOT NULL,
            query VARCHAR(300) NOT NULL,
            kind VARCHAR(16) NOT NULL DEFAULT 'topic',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS watchlists_user_id_idx ON watchlists (user_id)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS matter_shares (
            id SERIAL PRIMARY KEY,
            matter_id INTEGER NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
            owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            shared_with_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            permission VARCHAR(8) NOT NULL DEFAULT 'view',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS matter_shares_matter_id_idx ON matter_shares (matter_id)")
    op.execute("CREATE INDEX IF NOT EXISTS matter_shares_shared_with_idx ON matter_shares (shared_with_user_id)")
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS matter_shares_uniq
        ON matter_shares (matter_id, shared_with_user_id)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS matter_shares")
    op.execute("DROP TABLE IF EXISTS watchlists")
    op.execute("DROP TABLE IF EXISTS workspace_templates")
