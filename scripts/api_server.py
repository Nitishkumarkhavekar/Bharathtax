"""BharathTax public API — one keyed endpoint for the RAG chatbot.

POST /v1/chat  {question, version?, source?}  ->  {grounded, answer, citations, latency_ms}
GET  /health   (no auth)

Auth: send the API key as either header:
  Authorization: Bearer <KEY>      or      X-API-Key: <KEY>

Wraps scripts/rag_core.py (hybrid retrieve -> rerank -> grounding gate -> Llama).
Config via env: BHARATTAX_API_KEY, CORPUS_DIR, ML_URL, LLM_URL, ALLOWED_ORIGINS.
"""
from __future__ import annotations

import os
import re
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import rag_core

# ---- config from environment -------------------------------------------------
if os.getenv("CORPUS_DIR"):
    rag_core.DATA = Path(os.environ["CORPUS_DIR"])
if os.getenv("ML_URL"):
    rag_core.ML = os.environ["ML_URL"].rstrip("/")
if os.getenv("LLM_URL"):
    rag_core.LLM = os.environ["LLM_URL"].rstrip("/")
API_KEY = os.getenv("BHARATTAX_API_KEY", "")
ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o.strip()]

_STATE: dict = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    _STATE["store"] = rag_core.Store_singleton()   # loads chunks + embeddings + BM25 once
    yield


app = FastAPI(title="BharathTax API", version="1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS or ["*"],
                   allow_methods=["*"], allow_headers=["*"])


class ChatRequest(BaseModel):
    question: str
    version: str | None = None     # "1961" | "2025" | "1962" | "2026"  (optional filter)
    source: str | None = None      # e.g. "it_act_1961" (optional filter)


def _check_key(authorization: str | None, x_api_key: str | None) -> None:
    key = x_api_key
    if not key and authorization and authorization.lower().startswith("bearer "):
        key = authorization.split(" ", 1)[1].strip()
    if not API_KEY or key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


@app.get("/health")
def health() -> dict:
    store = _STATE.get("store")
    return {"status": "ok", "chunks": len(store.rows) if store else 0,
            "model": rag_core.LLM_MODEL}


@app.post("/v1/chat")
def chat(req: ChatRequest,
         authorization: str | None = Header(default=None),
         x_api_key: str | None = Header(default=None)) -> dict:
    _check_key(authorization, x_api_key)
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="question is required")
    t0 = time.time()
    res = rag_core.answer(req.question, version=req.version, source=req.source)
    citations = [{
        "n": i + 1,
        "act": p["row"]["act_name"],
        "section": p["row"].get("section_number") or p["row"].get("rule_number"),
        "breadcrumb": p["row"]["breadcrumb"],
        "score": round(p["score"], 3),
    } for i, p in enumerate(res["passages"])]
    return {"grounded": res["grounded"], "answer": res["text"], "citations": citations,
            "latency_ms": int((time.time() - t0) * 1000)}


# ---- OpenAI-compatible surface (so LiteLLM / any OpenAI SDK can call the RAG) --
def _sources_footer(passages: list[dict]) -> str:
    seen, lines = set(), []
    for p in passages:
        r = p["row"]
        sec = r.get("section_number") or r.get("rule_number") or ""
        key = (r["act_name"], sec)
        if key in seen:
            continue
        seen.add(key)
        lines.append(f"- {r['act_name']} {sec}".rstrip())
    return ("\n\nSources:\n" + "\n".join(lines)) if lines else ""


@app.get("/v1/models")
def list_models() -> dict:
    return {"object": "list", "data": [
        {"id": "bharattax-rag", "object": "model", "owned_by": "bharattax"},
        {"id": rag_core.LLM_MODEL, "object": "model", "owned_by": "bharattax"},
    ]}


@app.post("/v1/chat/completions")
def chat_completions(body: dict[str, Any],
                     authorization: str | None = Header(default=None),
                     x_api_key: str | None = Header(default=None)) -> dict:
    """OpenAI ChatCompletion shape, multi-turn aware. The last user message is the
    question; earlier messages are conversation history. Greetings/basics are
    answered naturally; specific provisions are grounded + cited (sources appended)."""
    _check_key(authorization, x_api_key)
    msgs = [m for m in (body.get("messages") or []) if m.get("role") != "system"]
    last_user_i = next((i for i in range(len(msgs) - 1, -1, -1)
                        if msgs[i].get("role") == "user"), None)
    if last_user_i is None or not msgs[last_user_i].get("content", "").strip():
        raise HTTPException(status_code=400, detail="no user message")
    question = msgs[last_user_i]["content"]
    history = msgs[:last_user_i]
    res = rag_core.answer(question, version=body.get("version"),
                          source=body.get("source"), history=history)
    content = res["text"]
    # Only show Sources when the answer actually cited the law ([1], [2], ...) — keeps
    # greetings, basics and general answers free of irrelevant source lists.
    if res["passages"] and re.search(r"\[\d+\]", content):
        cited = re.findall(r"\[(\d+)\]", content)
        idxs = sorted({int(c) for c in cited})
        used = [res["passages"][i - 1] for i in idxs if 1 <= i <= len(res["passages"])]
        content += _sources_footer(used or res["passages"])
    return {
        "id": "chatcmpl-" + uuid.uuid4().hex[:24],
        "object": "chat.completion",
        "created": int(time.time()),
        "model": body.get("model", "bharattax-rag"),
        "choices": [{"index": 0, "finish_reason": "stop",
                     "message": {"role": "assistant", "content": content}}],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }
