"""documents: sha256 + pipeline_version for extraction cache

Revision ID: c1d5a7f9e802
Revises: a3c8e12f4b90
Create Date: 2026-08-11 13:00:00.000000

Warm-path speed-up for repeat uploads of the same file. Adds:
  * documents.sha256           — cache key (64-char hex, indexed)
  * documents.pipeline_version — cache-invalidation tag; bumped whenever
                                 extraction logic changes so stale results
                                 (e.g. pre-mojibake-fix Tesseract output)
                                 never resurface.

Idempotent, matching the project convention.
"""
from alembic import op


revision = "c1d5a7f9e802"
down_revision = "a3c8e12f4b90"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS sha256 CHAR(64)")
    op.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS pipeline_version VARCHAR(40)")
    # Partial index: we only look up already-indexed rows with a hash.
    # Keeps the index small and hot.
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_documents_sha256_indexed
        ON documents (sha256, pipeline_version)
        WHERE sha256 IS NOT NULL AND status = 'indexed'
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_documents_sha256_indexed")
    op.execute("ALTER TABLE documents DROP COLUMN IF EXISTS pipeline_version")
    op.execute("ALTER TABLE documents DROP COLUMN IF EXISTS sha256")
