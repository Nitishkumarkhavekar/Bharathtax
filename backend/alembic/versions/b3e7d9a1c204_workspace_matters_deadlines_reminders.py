"""daily workspace: matters, deadlines (limitation calendar), reminders

Revision ID: b3e7d9a1c204
Revises: f1a2b3c4d5e6
Create Date: 2026-08-24 12:00:00.000000

Adds the personalization / productivity layer's core tables:
- matters    — a case the user is working (PAN / AY / appeal no.)
- deadlines  — statutory (auto-computed) or manual dates on a matter
- reminders  — dated nudges, optionally tied to a matter / deadline

Idempotent (IF NOT EXISTS) to stay safe alongside the boot-time
create_all/patch schema path this deployment also uses.
"""
from alembic import op


revision = "b3e7d9a1c204"
down_revision = "f1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS matters (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title VARCHAR(200) NOT NULL,
            pan VARCHAR(10),
            assessment_year VARCHAR(9),
            appeal_no VARCHAR(80),
            category VARCHAR(32),
            status VARCHAR(20) NOT NULL DEFAULT 'open',
            notes TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS matters_user_id_idx ON matters (user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS matters_pan_idx ON matters (pan)")
    op.execute("CREATE INDEX IF NOT EXISTS matters_status_idx ON matters (status)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS deadlines (
            id SERIAL PRIMARY KEY,
            matter_id INTEGER NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            kind VARCHAR(40) NOT NULL DEFAULT 'manual',
            label VARCHAR(160) NOT NULL,
            section_ref VARCHAR(40),
            trigger_event VARCHAR(40),
            trigger_date DATE,
            due_date DATE NOT NULL,
            is_auto BOOLEAN NOT NULL DEFAULT TRUE,
            status VARCHAR(16) NOT NULL DEFAULT 'open',
            notes TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS deadlines_matter_id_idx ON deadlines (matter_id)")
    op.execute("CREATE INDEX IF NOT EXISTS deadlines_user_id_idx ON deadlines (user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS deadlines_due_date_idx ON deadlines (due_date)")
    op.execute("CREATE INDEX IF NOT EXISTS deadlines_status_idx ON deadlines (status)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS reminders (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            matter_id INTEGER REFERENCES matters(id) ON DELETE CASCADE,
            deadline_id INTEGER REFERENCES deadlines(id) ON DELETE CASCADE,
            title VARCHAR(200) NOT NULL,
            due_at TIMESTAMPTZ NOT NULL,
            channels JSONB NOT NULL DEFAULT '[]'::jsonb,
            status VARCHAR(16) NOT NULL DEFAULT 'pending',
            notes TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS reminders_user_id_idx ON reminders (user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS reminders_matter_id_idx ON reminders (matter_id)")
    op.execute("CREATE INDEX IF NOT EXISTS reminders_due_at_idx ON reminders (due_at)")
    op.execute("CREATE INDEX IF NOT EXISTS reminders_status_idx ON reminders (status)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS reminders")
    op.execute("DROP TABLE IF EXISTS deadlines")
    op.execute("DROP TABLE IF EXISTS matters")
