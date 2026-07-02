"""Incremental prod sync — push new corpus rows from the dev DB to the deployed
web VPS (cstrax), zero-downtime.

Everything on dev with an id greater than prod's current max id is, by construction,
new since the last sync (rows are only appended). We export those, transfer, and
COPY-append them into prod's live tables (indexes maintained during COPY, so the
site keeps serving), then bump sequences and verify.

    python scripts/prod_sync.py            # sync dev -> prod, verify
    python scripts/prod_sync.py --dry-run  # just report how many rows would sync
"""
from __future__ import annotations

import argparse
import subprocess
import sys

DEV_PG = "taxmedha-postgres-1"
PROD_HOST = "cstrax"                       # SSH alias (key authorized)
PROD_PG = "bharathtax-web-postgres-1"
DB = ("taxmedha", "taxmedha")             # (user, dbname), same on dev + prod
SCRATCH = "/tmp"

DCOLS = "id,source_id,title,doc_type,source_url,raw_minio_key,extracted_text,checksum,published_date,status,fetched_at"
CCOLS = ("id,corpus_document_id,source_id,domain,text,breadcrumb,chunk_level,parent_chunk_id,act_name,"
         "section_number,subsection,clause,proviso_no,explanation_no,rule_number,subrule,extra,embedding,"
         "effective_date,superseded_date,version,is_current,supersedes_id,created_at")


def dev_psql(sql: str) -> str:
    return subprocess.run(["docker", "exec", DEV_PG, "psql", "-U", DB[0], "-d", DB[1], "-tAc", sql],
                          capture_output=True, text=True).stdout.strip()


def prod_sh(script: str) -> str:
    # surface BOTH streams — psql \copy errors go to stderr and (without ON_ERROR_STOP)
    # don't fail the shell, so a silently-dropped COPY must still be visible.
    r = subprocess.run(["ssh", "-o", "BatchMode=yes", PROD_HOST, "bash", "-s"],
                       input=script, capture_output=True, text=True)
    return (r.stdout + r.stderr).strip()


def prod_psql(sql: str) -> str:
    return prod_sh(f"docker exec {PROD_PG} psql -U {DB[0]} -d {DB[1]} -tAc \"{sql}\"")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    pmax_doc = int(prod_psql("SELECT coalesce(max(id),0) FROM corpus_documents") or 0)
    pmax_chunk = int(prod_psql("SELECT coalesce(max(id),0) FROM corpus_chunks") or 0)
    n_docs = int(dev_psql(f"SELECT count(*) FROM corpus_documents WHERE id>{pmax_doc}") or 0)
    n_chunks = int(dev_psql(f"SELECT count(*) FROM corpus_chunks WHERE id>{pmax_chunk}") or 0)
    print(f"prod max: doc={pmax_doc} chunk={pmax_chunk} | new on dev: {n_docs} docs, {n_chunks} chunks")
    if a.dry_run:
        return
    if n_chunks == 0 and n_docs == 0:
        print("prod already up to date.")
        return

    # 1) export new rows from dev (exclude generated tsv col), gzip
    print("exporting new rows from dev...")
    subprocess.run(["docker", "exec", DEV_PG, "psql", "-U", DB[0], "-d", DB[1], "-c",
                    f"\\copy (SELECT {DCOLS} FROM corpus_documents WHERE id>{pmax_doc} ORDER BY id) TO '{SCRATCH}/sync_docs.dat'"], check=True)
    subprocess.run(["docker", "exec", DEV_PG, "psql", "-U", DB[0], "-d", DB[1], "-c",
                    f"\\copy (SELECT {CCOLS} FROM corpus_chunks WHERE id>{pmax_chunk} ORDER BY id) TO '{SCRATCH}/sync_chunks.dat'"], check=True)
    subprocess.run(["docker", "exec", DEV_PG, "sh", "-c",
                    f"gzip -f {SCRATCH}/sync_docs.dat {SCRATCH}/sync_chunks.dat"], check=True)
    # 2) out of container -> host -> scp to prod
    import tempfile, os
    tmp = tempfile.gettempdir()
    for f in ("sync_docs.dat.gz", "sync_chunks.dat.gz"):
        subprocess.run(["docker", "cp", f"{DEV_PG}:{SCRATCH}/{f}", os.path.join(tmp, f)], check=True)
        subprocess.run(["scp", "-P", "20202", "-o", "BatchMode=yes", os.path.join(tmp, f), f"{PROD_HOST}:{SCRATCH}/{f}"], check=True)
    # 3) import on prod via SERVER-SIDE COPY from a heredoc-written SQL file (taxmedha is
    #    superuser). ON_ERROR_STOP=1 makes any failure loud instead of a silent drop.
    #    docs before chunks (FK order); indexes stay live so the site keeps serving.
    print("importing into prod (zero-downtime COPY-append)...")
    sqlfile = (f"COPY corpus_documents({DCOLS}) FROM '{SCRATCH}/sync_docs.dat';\n"
               f"COPY corpus_chunks({CCOLS}) FROM '{SCRATCH}/sync_chunks.dat';\n")
    script = f"""set -e
docker cp {SCRATCH}/sync_docs.dat.gz {PROD_PG}:{SCRATCH}/; docker cp {SCRATCH}/sync_chunks.dat.gz {PROD_PG}:{SCRATCH}/
docker exec {PROD_PG} sh -c 'gunzip -f {SCRATCH}/sync_docs.dat.gz {SCRATCH}/sync_chunks.dat.gz'
cat > {SCRATCH}/sync.sql <<'SQLEOF'
{sqlfile}SQLEOF
docker cp {SCRATCH}/sync.sql {PROD_PG}:{SCRATCH}/sync.sql
docker exec {PROD_PG} psql -U {DB[0]} -d {DB[1]} -v ON_ERROR_STOP=1 -f {SCRATCH}/sync.sql
docker exec {PROD_PG} psql -U {DB[0]} -d {DB[1]} -c "SELECT setval(pg_get_serial_sequence('corpus_documents','id'),(SELECT max(id) FROM corpus_documents)); SELECT setval(pg_get_serial_sequence('corpus_chunks','id'),(SELECT max(id) FROM corpus_chunks));"
docker exec {PROD_PG} sh -c 'rm -f {SCRATCH}/sync_*.dat* {SCRATCH}/sync.sql'
docker exec bharathtax-web-api-1 python -m app.ingestion.pipeline verify 2>&1 | grep -E 'corpus_chunks|with embedding|by domain|PASS|FAIL'
"""
    print(prod_sh(script))
    # cleanup dev/host temp
    subprocess.run(["docker", "exec", DEV_PG, "sh", "-c", f"rm -f {SCRATCH}/sync_*.dat*"])
    for f in ("sync_docs.dat.gz", "sync_chunks.dat.gz"):
        try: os.remove(os.path.join(tmp, f))
        except OSError: pass
    print("### prod sync complete.")


if __name__ == "__main__":
    main()
