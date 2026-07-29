"""user email, organisation, approval workflow

Revision ID: 69f0cf8bdc11
Revises: e5a1c9d740bf
Create Date: 2026-06-30 12:02:47.718356

Re-parented onto the current head (was branched off 3e1329648201, which created
a second Alembic head). Operations are idempotent (ADD COLUMN IF NOT EXISTS)
because these same columns are also applied at boot by
app.main._patch_user_columns — so this migration is safe whether or not they
already exist. Keeps the migration history as the versioned source of truth.
"""
from alembic import op


revision = '69f0cf8bdc11'
down_revision = 'e5a1c9d740bf'
branch_labels = None
depends_on = None


_COLS = [
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS organisation VARCHAR(200)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) NOT NULL DEFAULT 'approved'",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_by_user_id INTEGER",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE",
]


def upgrade() -> None:
    for stmt in _COLS:
        op.execute(stmt)


def downgrade() -> None:
    for col in ("approved_at", "approved_by_user_id", "approval_status", "organisation"):
        op.execute(f"ALTER TABLE users DROP COLUMN IF EXISTS {col}")
