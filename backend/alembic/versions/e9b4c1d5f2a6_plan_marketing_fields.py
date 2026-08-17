"""add marketing fields to subscription_plans (features, badge, featured)

Revision ID: e9b4c1d5f2a6
Revises: d8a3b1c2f4e5
Create Date: 2026-08-17 13:30:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "e9b4c1d5f2a6"
down_revision = "d8a3b1c2f4e5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # `features` is a JSONB array of strings — one bullet per feature. Nullable
    # so existing rows (Free Trial) keep working without a backfill.
    op.add_column("subscription_plans", sa.Column("features", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.add_column("subscription_plans", sa.Column("is_featured", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("subscription_plans", sa.Column("badge", sa.String(length=60), nullable=True))
    op.add_column("subscription_plans", sa.Column("savings_note", sa.String(length=200), nullable=True))
    op.add_column("subscription_plans", sa.Column("annual_discount_pct", sa.Integer(), nullable=False, server_default=sa.text("20")))


def downgrade() -> None:
    op.drop_column("subscription_plans", "annual_discount_pct")
    op.drop_column("subscription_plans", "savings_note")
    op.drop_column("subscription_plans", "badge")
    op.drop_column("subscription_plans", "is_featured")
    op.drop_column("subscription_plans", "features")
