"""user personalization: profile fields + settings + global memory

Revision ID: f7b2c4d9e310
Revises: 69f0cf8bdc11
Create Date: 2026-07-26 10:00:00.000000

Adds:
- users.charge, users.preferred_language (profile for personalization + drafting)
- user_settings (custom instructions + style + memory on/off)
- user_memory (durable cross-conversation facts; complements chat_memory)

Idempotent (IF NOT EXISTS) to stay safe alongside the boot-time create_all/patch
schema path used by this deployment.
"""
from alembic import op


revision = "f7b2c4d9e310"
down_revision = "69f0cf8bdc11"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS charge VARCHAR(200)")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(10) NOT NULL DEFAULT 'en'")

    op.execute("""
        CREATE TABLE IF NOT EXISTS user_settings (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            custom_instructions TEXT NOT NULL DEFAULT '',
            about_me TEXT NOT NULL DEFAULT '',
            style JSONB NOT NULL DEFAULT '{}'::jsonb,
            memory_enabled BOOLEAN NOT NULL DEFAULT TRUE,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS user_memory (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            kind VARCHAR(16) NOT NULL DEFAULT 'fact',
            content TEXT NOT NULL,
            source VARCHAR(48) NOT NULL DEFAULT 'manual',
            pinned BOOLEAN NOT NULL DEFAULT FALSE,
            confidence DOUBLE PRECISION NOT NULL DEFAULT 1.0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_used_at TIMESTAMPTZ
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS user_memory_user_id_idx ON user_memory (user_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS user_memory")
    op.execute("DROP TABLE IF EXISTS user_settings")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS preferred_language")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS charge")
