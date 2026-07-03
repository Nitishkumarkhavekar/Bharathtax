"""Training-data capture — records every LLM interaction (prompt + context + response),
generated drafts, and (later) chat turns into an append-only `ai_capture` table, for
later distillation/fine-tuning of an in-house model.

Design: FIRE-AND-FORGET. `log_*` enqueues and returns instantly; a single daemon
thread batches the writes on its own DB session. If the queue is full it DROPS the
record rather than ever blocking a user request — capturing must never slow the app.
Toggle with CAPTURE_ENABLED=0.
"""
from __future__ import annotations

import contextvars
import json
import os
import queue
import threading

from sqlalchemy import text

from app.core.db import SessionLocal
from app.core.logging import get_logger

log = get_logger(__name__)

_ENABLED = os.getenv("CAPTURE_ENABLED", "1").lower() not in ("0", "false", "no", "")
# Version tags stamped onto every record so the training set stays clean when prompts
# or the corpus change over time (mixing versions silently degrades a fine-tune).
_PROMPT_VERSION = os.getenv("PROMPT_VERSION", "")
_CORPUS_VERSION = os.getenv("CORPUS_VERSION", "")
_Q: "queue.Queue[dict]" = queue.Queue(maxsize=20000)
_started = False
_lock = threading.Lock()

# Per-request/run context (user_id, case_id, run_id) so every captured LLM call can be
# linked back to the case/run/user it belongs to.
_CTX: contextvars.ContextVar = contextvars.ContextVar("ai_capture_ctx", default=None)

_DDL = [
    """CREATE TABLE IF NOT EXISTS ai_capture (
        id BIGSERIAL PRIMARY KEY,
        ts TIMESTAMPTZ NOT NULL DEFAULT now(),
        kind TEXT NOT NULL,
        task TEXT,
        user_id INTEGER,
        case_id INTEGER,
        run_id INTEGER,
        model TEXT,
        system_prompt TEXT,
        user_prompt TEXT,
        context TEXT,
        response TEXT,
        meta JSONB
    )""",
    "CREATE INDEX IF NOT EXISTS ix_ai_capture_kind ON ai_capture(kind)",
    "CREATE INDEX IF NOT EXISTS ix_ai_capture_case ON ai_capture(case_id)",
    "CREATE INDEX IF NOT EXISTS ix_ai_capture_ts ON ai_capture(ts)",
]

_INSERT = text(
    "INSERT INTO ai_capture "
    "(kind,task,user_id,case_id,run_id,model,system_prompt,user_prompt,context,response,meta) "
    "VALUES (:kind,:task,:user_id,:case_id,:run_id,:model,:system_prompt,:user_prompt,"
    ":context,:response,CAST(:meta AS JSONB))"
)


def set_context(**kw) -> None:
    """Attach user_id/case_id/run_id to subsequent captures on this thread/context."""
    _CTX.set({k: v for k, v in kw.items() if v is not None})


def _ctx() -> dict:
    return _CTX.get() or {}


def get_context() -> dict:
    """Snapshot of the current capture context — pass into worker threads (which do
    not inherit contextvars) and re-apply with set_context(**snapshot)."""
    return dict(_ctx())


def _ensure_table(s) -> None:
    for stmt in _DDL:
        s.execute(text(stmt))
    s.commit()


def _writer() -> None:
    ready = False
    while True:
        batch = [_Q.get()]
        try:
            while len(batch) < 100:
                batch.append(_Q.get_nowait())
        except queue.Empty:
            pass
        s = None
        try:
            s = SessionLocal()
            if not ready:
                _ensure_table(s)
                ready = True
            s.execute(_INSERT, batch)
            s.commit()
        except Exception as e:  # noqa: BLE001 — capture must never crash the app
            log.warning("ai_capture: write of %d record(s) failed: %s", len(batch), e)
        finally:
            if s is not None:
                try:
                    s.close()
                except Exception:
                    pass


def _ensure_writer() -> None:
    global _started
    if _started:
        return
    with _lock:
        if not _started:
            threading.Thread(target=_writer, name="ai-capture", daemon=True).start()
            _started = True


def log_event(kind: str, *, task: str | None = None, model: str | None = None,
              system_prompt: str | None = None, user_prompt: str | None = None,
              context: str | None = None, response: str | None = None,
              meta: dict | None = None, **ctx_override) -> None:
    if not _ENABLED:
        return
    try:
        _ensure_writer()
        c = dict(_ctx())
        c.update({k: v for k, v in ctx_override.items() if v is not None})
        _meta = dict(meta or {})
        if _PROMPT_VERSION:
            _meta.setdefault("prompt_version", _PROMPT_VERSION)
        if _CORPUS_VERSION:
            _meta.setdefault("corpus_version", _CORPUS_VERSION)
        rec = {
            "kind": kind, "task": task,
            "user_id": c.get("user_id"), "case_id": c.get("case_id"), "run_id": c.get("run_id"),
            "model": model, "system_prompt": system_prompt, "user_prompt": user_prompt,
            "context": context, "response": response,
            "meta": json.dumps(_meta, ensure_ascii=False, default=str),
        }
        _Q.put_nowait(rec)
    except queue.Full:
        pass  # drop rather than block/slow the request
    except Exception:  # noqa: BLE001
        pass


def log_llm(system: str, user: str, response: str, *, model: str | None = None,
            usage: dict | None = None, latency_ms: int | None = None,
            task: str | None = None) -> None:
    log_event("llm_call", task=task, model=model, system_prompt=system, user_prompt=user,
              response=response, meta={"usage": usage, "latency_ms": latency_ms})
