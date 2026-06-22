#!/usr/bin/env bash
# Dump the ingested corpus (all tables incl. embeddings) to a SQL file, so it can
# be handed over / restored without re-running the multi-hour embed. Run with the
# stack up, from repo root.  Usage: bash scripts/dump_corpus.sh [out.sql]
set -euo pipefail
OUT="${1:-handover/corpus_dump.sql}"
DB="${POSTGRES_DB:-taxmedha}"; USER="${POSTGRES_USER:-taxmedha}"
mkdir -p "$(dirname "$OUT")"
echo "Dumping database '$DB' → $OUT"
docker compose exec -T postgres pg_dump -U "$USER" -d "$DB" --no-owner --no-privileges > "$OUT"
echo "Done: $(du -h "$OUT" | cut -f1)"
