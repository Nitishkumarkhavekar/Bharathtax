"""LLM-generated case digests (headnotes) — a one-line "what it held" per judgment,
in law-report style. Batch-generated against the high-throughput GPU vLLM
(Llama-3.1-8B), stored on corpus_documents.digest. Idempotent + resumable: only
touches judgments with a NULL digest, and writes the sentinels PROCEDURAL /
INSUFFICIENT so re-runs don't reprocess non-substantive orders.
"""
from __future__ import annotations

import asyncio

import httpx

from app.core.config import settings
from app.core.db import SessionLocal
from app.core.enums import SourceType
from app.core.logging import configure_logging, get_logger
from sqlalchemy import func, select, update

from app.models.corpus import CorpusDocument

log = get_logger(__name__)

SYSTEM = (
    "You write the one-sentence HEADNOTE for an Indian income-tax judgment, in the terse "
    "neutral style of a law report (ITR/Taxman). Capture the LEGAL PROPOSITION the court "
    "settled — the section involved and the principle held — not the procedural outcome. "
    "Rules: start with the section (e.g. 'S.68:'); no party names; no 'the court/held "
    "that'; no citations; <=35 words; exactly one sentence. If the order is purely "
    "procedural (withdrawn, dismissed for delay/low tax effect, remanded, settled under "
    "Vivad se Vishwas) with no legal holding, reply exactly: PROCEDURAL. If the text is "
    "too fragmentary to tell, reply exactly: INSUFFICIENT.\n"
    "Example -> S.68: share-application money cannot be added as unexplained cash credit "
    "where the assessee proves identity, creditworthiness and genuineness of the subscribers."
)


def _window(text: str, head: int = 5000, tail: int = 3000) -> str:
    text = (text or "").strip()
    if len(text) <= head + tail:
        return text
    return text[:head] + "\n...\n" + text[-tail:]


def _clean(out: str) -> str:
    out = (out or "").strip().strip('"').strip()
    for pre in ("Headnote:", "HEADNOTE:", "Digest:"):
        if out.startswith(pre):
            out = out[len(pre):].strip()
    if not out:
        return "INSUFFICIENT"
    # keep it a single tight line
    out = " ".join(out.split())
    return out[:600]


async def _gen_one(client: httpx.AsyncClient, sem: asyncio.Semaphore, url: str,
                   model: str, title: str, text: str) -> str:
    user = f"Judgment title: {title}\n\nJudgment text:\n{_window(text)}\n\nHeadnote:"
    payload = {"model": model, "temperature": 0.2, "max_tokens": 110,
               "messages": [{"role": "system", "content": SYSTEM},
                            {"role": "user", "content": user}]}
    async with sem:
        for attempt in range(3):
            try:
                r = await client.post(f"{url}/chat/completions", json=payload)
                if r.status_code == 200:
                    return _clean(r.json()["choices"][0]["message"]["content"])
            except Exception:
                pass
            await asyncio.sleep(2 * (attempt + 1))
    return ""  # transient failure -> leave NULL, a re-run retries it


async def _gen_batch(rows: list[tuple[int, str, str]], url: str, model: str,
                     concurrency: int) -> dict[int, str]:
    sem = asyncio.Semaphore(concurrency)
    # Auth for the gateway/LiteLLM path (raw vLLM ignores it). Lets the batch run
    # from inside the app container against the same authenticated endpoint that
    # chat/appeals use, instead of only the direct-to-vLLM address.
    key = (settings.llm_api_key or "").strip()
    headers = {"Authorization": f"Bearer {key}"} if key and key != "not-needed" else {}
    async with httpx.AsyncClient(timeout=httpx.Timeout(180.0), headers=headers) as client:
        results = await asyncio.gather(
            *[_gen_one(client, sem, url, model, title, text) for _, title, text in rows]
        )
    return {rows[i][0]: results[i] for i in range(len(rows)) if results[i]}


def generate_digests(*, min_len: int = 2500, concurrency: int = 24, batch: int = 120,
                     sections: list[str] | None = None, limit: int | None = None) -> None:
    """Fill corpus_documents.digest for judgments (doc_type=judgment) with a NULL digest
    and extracted_text length >= min_len. Optional `sections` restricts to judgments citing
    one of those sections (via GIN &&) — used to do the high-value substantive tier first."""
    configure_logging()
    url = settings.digest_llm_url.rstrip("/")
    model = settings.digest_llm_model
    log.info("digest: LLM=%s model=%s min_len=%d conc=%d sections=%s", url, model, min_len, concurrency, sections)
    db = SessionLocal()
    done = proc = insuff = real = 0
    try:
        while True:
            stmt = select(CorpusDocument.id, CorpusDocument.title, CorpusDocument.extracted_text).where(
                CorpusDocument.digest.is_(None),
                CorpusDocument.doc_type == SourceType.judgment,
                CorpusDocument.extracted_text.isnot(None),
                func.length(CorpusDocument.extracted_text) >= min_len,
            )
            if sections:
                stmt = stmt.where(CorpusDocument.sections_cited.op("&&")(sections))
            stmt = stmt.order_by(CorpusDocument.id).limit(batch)
            rows = [(r[0], r[1] or "", r[2] or "") for r in db.execute(stmt).all()]
            if not rows:
                break
            digests = asyncio.run(_gen_batch(rows, url, model, concurrency))
            for did, dg in digests.items():
                db.execute(update(CorpusDocument).where(CorpusDocument.id == did).values(digest=dg))
                if dg == "PROCEDURAL":
                    proc += 1
                elif dg == "INSUFFICIENT":
                    insuff += 1
                else:
                    real += 1
            db.commit()
            done += len(digests)
            log.info("  digested %d docs (%d substantive, %d procedural, %d insufficient)",
                     done, real, proc, insuff)
            if limit and done >= limit:
                break
        log.info("DONE. digested %d judgments (%d substantive, %d procedural, %d insufficient)",
                 done, real, proc, insuff)
    finally:
        db.close()
