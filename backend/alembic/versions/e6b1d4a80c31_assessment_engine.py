"""assessment-order engine: cases, documents, runs, outputs

Revision ID: e6b1d4a80c31
Revises: d5a9c3f1e720
Create Date: 2026-08-25 12:00:00.000000

Parallels the appeals tables for the AO-side assessment-order engine.
Idempotent (IF NOT EXISTS) to stay safe alongside the boot-time create_all.
"""
from alembic import op


revision = "e6b1d4a80c31"
down_revision = "d5a9c3f1e720"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS assessment_cases (
            id SERIAL PRIMARY KEY,
            slug VARCHAR(36) NOT NULL UNIQUE,
            owner_user_id INTEGER NOT NULL REFERENCES users(id),
            wing_id INTEGER NOT NULL REFERENCES wings(id),
            title VARCHAR(300) NOT NULL,
            assessment_year VARCHAR(20),
            pan VARCHAR(20),
            section VARCHAR(40),
            status VARCHAR(20) NOT NULL DEFAULT 'new',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS assessment_cases_slug_idx ON assessment_cases (slug)")
    op.execute("CREATE INDEX IF NOT EXISTS assessment_cases_owner_idx ON assessment_cases (owner_user_id)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS assessment_documents (
            id SERIAL PRIMARY KEY,
            case_id INTEGER NOT NULL REFERENCES assessment_cases(id),
            filename VARCHAR(500) NOT NULL,
            category VARCHAR(50) NOT NULL DEFAULT 'unclassified',
            minio_key VARCHAR(500) NOT NULL,
            text TEXT NOT NULL DEFAULT '',
            pages INTEGER NOT NULL DEFAULT 0,
            sha256 VARCHAR(64),
            digest TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS assessment_documents_case_idx ON assessment_documents (case_id)")
    op.execute("CREATE INDEX IF NOT EXISTS assessment_documents_sha_idx ON assessment_documents (sha256)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS assessment_runs (
            id SERIAL PRIMARY KEY,
            case_id INTEGER NOT NULL REFERENCES assessment_cases(id),
            status VARCHAR(20) NOT NULL DEFAULT 'queued',
            progress VARCHAR(200),
            provider VARCHAR(40),
            model VARCHAR(80),
            error TEXT,
            task_id VARCHAR(64),
            created_by INTEGER NOT NULL REFERENCES users(id),
            started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            finished_at TIMESTAMPTZ
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS assessment_runs_case_idx ON assessment_runs (case_id)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS assessment_outputs (
            id SERIAL PRIMARY KEY,
            run_id INTEGER NOT NULL REFERENCES assessment_runs(id),
            kind VARCHAR(40) NOT NULL,
            seq INTEGER NOT NULL DEFAULT 0,
            label VARCHAR(300),
            content TEXT NOT NULL DEFAULT '',
            citations JSONB NOT NULL DEFAULT '[]'::jsonb,
            edited BOOLEAN NOT NULL DEFAULT FALSE,
            version INTEGER NOT NULL DEFAULT 1,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            docx_blob BYTEA
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS assessment_outputs_run_idx ON assessment_outputs (run_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS assessment_outputs")
    op.execute("DROP TABLE IF EXISTS assessment_runs")
    op.execute("DROP TABLE IF EXISTS assessment_documents")
    op.execute("DROP TABLE IF EXISTS assessment_cases")
