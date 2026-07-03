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

SCOLS = "id,key,domain,name,source_type,base_url,config,enabled,last_crawled_at,created_at"
DCOLS = "id,source_id,title,doc_type,source_url,raw_minio_key,extracted_text,checksum,published_date,status,fetched_at,sections_cited"
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

    import os, tempfile
    pmax = {t: int(prod_psql(f"SELECT coalesce(max(id),0) FROM corpus_{t}") or 0)
            for t in ("sources", "documents", "chunks")}
    n = {t: int(dev_psql(f"SELECT count(*) FROM corpus_{t} WHERE id>{pmax[t]}") or 0)
         for t in ("sources", "documents", "chunks")}
    print(f"prod max {pmax} | new on dev: {n['sources']} sources, {n['documents']} docs, {n['chunks']} chunks")
    if a.dry_run:
        return
    if not any(n.values()):
        print("prod already up to date.")
        return

    # 1) export new rows from dev (exclude generated tsv), gzip. Order: sources->docs->chunks (FK).
    print("exporting new rows from dev...")
    tables = [("sources", SCOLS, pmax["sources"]), ("documents", DCOLS, pmax["documents"]), ("chunks", CCOLS, pmax["chunks"])]
    for t, cols, thr in tables:
        subprocess.run(["docker", "exec", DEV_PG, "psql", "-U", DB[0], "-d", DB[1], "-c",
                        f"\\copy (SELECT {cols} FROM corpus_{t} WHERE id>{thr} ORDER BY id) TO '{SCRATCH}/sync_{t}.dat'"], check=True)
    subprocess.run(["docker", "exec", DEV_PG, "sh", "-c",
                    f"gzip -f {SCRATCH}/sync_sources.dat {SCRATCH}/sync_documents.dat {SCRATCH}/sync_chunks.dat"], check=True)

    # 2) build the prod-side SQL + shell script as FILES (LF endings — avoids Windows \r
    #    from stdin heredocs), scp everything, run the script file on prod.
    tmp = tempfile.gettempdir()
    sql = "".join(f"COPY corpus_{t}({cols}) FROM '{SCRATCH}/sync_{t}.dat';\n" for t, cols, _ in tables) + \
        "".join(f"SELECT setval(pg_get_serial_sequence('corpus_{t}','id'),(SELECT max(id) FROM corpus_{t}));\n"
                for t in ("sources", "documents", "chunks"))
    runsh = ("set -e\n"
             + "".join(f"docker cp {SCRATCH}/sync_{t}.dat.gz {PROD_PG}:{SCRATCH}/\n" for t, _, _ in tables)
             + f"docker cp {SCRATCH}/sync.sql {PROD_PG}:{SCRATCH}/sync.sql\n"
             + f"docker exec {PROD_PG} sh -c 'gunzip -f {SCRATCH}/sync_sources.dat.gz {SCRATCH}/sync_documents.dat.gz {SCRATCH}/sync_chunks.dat.gz'\n"
             + f"docker exec {PROD_PG} psql -U {DB[0]} -d {DB[1]} -v ON_ERROR_STOP=1 -f {SCRATCH}/sync.sql\n"
             + f"docker exec {PROD_PG} sh -c 'rm -f {SCRATCH}/sync_*.dat* {SCRATCH}/sync.sql'\n"
             + "docker exec bharathtax-web-api-1 python -m app.ingestion.pipeline verify 2>&1 | grep -E 'corpus_chunks|with embedding|by domain|PASS|FAIL'\n")
    p_sql, p_sh = os.path.join(tmp, "sync.sql"), os.path.join(tmp, "sync_run.sh")
    open(p_sql, "w", newline="\n").write(sql)
    open(p_sh, "w", newline="\n").write(runsh)

    # 3) transfer .gz + the two script files to prod
    print("importing into prod (zero-downtime COPY-append)...")
    for t, _, _ in tables:
        subprocess.run(["docker", "cp", f"{DEV_PG}:{SCRATCH}/sync_{t}.dat.gz", os.path.join(tmp, f"sync_{t}.dat.gz")], check=True)
        subprocess.run(["scp", "-P", "20202", "-o", "BatchMode=yes", os.path.join(tmp, f"sync_{t}.dat.gz"), f"{PROD_HOST}:{SCRATCH}/sync_{t}.dat.gz"], check=True)
    subprocess.run(["scp", "-P", "20202", "-o", "BatchMode=yes", p_sql, f"{PROD_HOST}:{SCRATCH}/sync.sql"], check=True)
    subprocess.run(["scp", "-P", "20202", "-o", "BatchMode=yes", p_sh, f"{PROD_HOST}:{SCRATCH}/sync_run.sh"], check=True)

    # 4) run the script FILE on prod (no stdin -> no \r issues)
    r = subprocess.run(["ssh", "-o", "BatchMode=yes", PROD_HOST, "bash", f"{SCRATCH}/sync_run.sh"], capture_output=True, text=True)
    print((r.stdout + r.stderr).strip())
    subprocess.run(["ssh", "-o", "BatchMode=yes", PROD_HOST, f"rm -f {SCRATCH}/sync_run.sh {SCRATCH}/sync.sql"])

    # 5) cleanup dev + host temp
    subprocess.run(["docker", "exec", DEV_PG, "sh", "-c", f"rm -f {SCRATCH}/sync_*.dat*"])
    for fn in os.listdir(tmp):
        if fn.startswith("sync_") or fn in ("sync.sql", "sync_run.sh"):
            try: os.remove(os.path.join(tmp, fn))
            except OSError: pass
    print("### prod sync complete.")


if __name__ == "__main__":
    main()
