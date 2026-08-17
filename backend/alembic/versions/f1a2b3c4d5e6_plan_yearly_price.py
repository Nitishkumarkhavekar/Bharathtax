"""subscription_plans: explicit yearly_price_inr override

Revision ID: f1a2b3c4d5e6
Revises: e9b4c1d5f2a6
Create Date: 2026-08-17 15:00:00.000000

Adds an optional yearly price column so the admin can set a nicer round
annual number (e.g. Rs 29,999) instead of always deriving it from
monthly_price * 12 * (1 - annual_discount_pct/100). When NULL the API
still auto-computes, so nothing breaks for existing rows.
"""
from alembic import op


revision = "f1a2b3c4d5e6"
down_revision = "e9b4c1d5f2a6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS yearly_price_inr NUMERIC(10, 2)")


def downgrade() -> None:
    op.execute("ALTER TABLE subscription_plans DROP COLUMN IF EXISTS yearly_price_inr")
