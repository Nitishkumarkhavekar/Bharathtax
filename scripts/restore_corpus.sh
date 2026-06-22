#!/usr/bin/env bash
# Restore a corpus dump into a freshly-migrated DB (skips re-embedding).
# Run AFTER `make up && make migrate`. Usage: bash scripts/restore_corpus.sh [in.sql]
set -euo pipefail
IN="${1:-handover/corpus_dump.sql}"
DB="${POSTGRES_DB:-taxmedha}"; USER="${POSTGRES_USER:-taxmedha}"
[ -f "$IN" ] || { echo "Not found: $IN"; exit 1; }
echo "Restoring $IN → database '$DB' (existing corpus rows will be replaced)"
# truncate corpus tables first so a re-restore is clean; ignore if tables absent
docker compose exec -T postgres psql -U "$USER" -d "$DB" \
  -c "TRUNCATE corpus_chunks, corpus_documents, corpus_sources RESTART IDENTITY CASCADE;" 2>/dev/null || true
docker compose exec -T postgres psql -U "$USER" -d "$DB" --set ON_ERROR_STOP=on < "$IN"
echo "Done. Verify: make verify-corpus"
