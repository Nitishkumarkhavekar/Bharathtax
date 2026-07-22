"""Tool-calling chat agent (Gemini function-calling).

Instead of stuffing corpus + web + memory into one prompt (context pollution),
the model calls SCOPED tools that each return a small, relevant slice. The
identity (user_id, chat_id) is INJECTED by the backend when a tool executes —
never supplied by the model — so a tool can never reach another user's data and
prompt-injection cannot redirect it. Feature-flagged via CHAT_AGENT_ENABLED.
"""
from __future__ import annotations

import json
import logging
import os
import time

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.services import chat_memory as _mem
from app.services import embeddings as _emb
from app.services import gemini_search as _gs

log = logging.getLogger("agent")

_KEY = os.getenv("GEMINI_API_KEY", "").strip()
_MODEL = os.getenv("CHAT_AGENT_MODEL", os.getenv("GEMINI_SEARCH_MODEL", "gemini-2.5-flash"))
_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
_MAX_ITERS = int(os.getenv("CHAT_AGENT_MAX_ITERS", "4"))


def enabled() -> bool:
    return bool(_KEY) and os.getenv("CHAT_AGENT_ENABLED", "0").lower() in ("1", "true", "yes")


_SYSTEM = (
    "You are BharathTax, an expert assistant for Indian income-tax officers. "
    "Answer ONLY from tool results — call tools to fetch grounded facts before you "
    "answer; never rely on unverified recollection. Tools: search_tax_law (the "
    "Income-tax Act & Rules), web_search (current circulars/notifications/case law "
    "and anything not in the static Act), recall_chat_memory (what THIS conversation "
    "already established), search_my_documents (the user's uploaded files). Use the "
    "FEWEST tools needed — a greeting needs none. If tools return nothing relevant, "
    "say so plainly; do not invent. Cite sources. Be precise on sections, amounts, "
    "dates and the assessment year. Finish with a short conclusion when useful."
)

_TOOLS = [{"functionDeclarations": [
    {"name": "search_tax_law",
     "description": "Search the Income-tax Act (1961/2025) and Rules. Use for statutory provisions, definitions, procedures, section text.",
     "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}},
    {"name": "web_search",
     "description": "Search the live web (official gov/CBDT sources preferred) for current circulars, notifications, press releases, case law, or anything not in the static Act/Rules.",
     "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}},
    {"name": "recall_chat_memory",
     "description": "Recall relevant earlier points from THIS conversation (facts/figures the user already stated).",
     "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}},
    {"name": "search_my_documents",
     "description": "Search the user's own uploaded documents for relevant passages.",
     "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}},
]}]


def _search_docs(db: Session, *, user_id: int, query: str, k: int = 5) -> list:
    try:
        from app.models.documents import Document, DocumentChunk
        qvec = _emb.embed_one(query)
        rows = db.execute(
            select(DocumentChunk.text, Document.filename,
                   DocumentChunk.embedding.cosine_distance(qvec).label("dist"))
            .join(Document, DocumentChunk.document_id == Document.id)
            .where(Document.owner_user_id == user_id)
            .order_by("dist").limit(k)
        ).all()
        return [{"file": r.filename, "text": (r.text or "")[:600], "score": round(1 - float(r.dist), 3)}
                for r in rows if float(r.dist) < 0.8]
    except Exception as e:  # noqa: BLE001
        log.warning("doc search failed: %s", e)
        return []


def _exec_tool(name: str, args: dict, *, db: Session, user_id: int, chat_id):
    q = (args or {}).get("query", "")
    if name == "search_tax_law":
        try:
            r = httpx.post(settings.llm_base_url.rstrip("/") + "/law",
                           headers={"Authorization": f"Bearer {settings.llm_api_key}"},
                           json={"query": q, "k": 6}, timeout=20.0)
            ps = r.json().get("passages", []) if r.status_code == 200 else []
            return {"passages": [{"n": p.get("n"), "breadcrumb": p.get("breadcrumb"),
                                  "text": (p.get("text") or "")[:800]} for p in ps[:6]]}
        except Exception as e:  # noqa: BLE001
            return {"passages": [], "error": str(e)[:100]}
    if name == "web_search":
        txt, srcs = _gs.web_answer(q)
        return {"answer": (txt or "")[:3000],
                "sources": [{"title": s.get("title"), "url": s.get("url")} for s in (srcs or [])[:6]]}
    if name == "recall_chat_memory":
        if chat_id is None:
            return {"memories": []}
        return {"memories": _mem.recall(db, user_id=user_id, chat_id=chat_id, query=q, k=5)}
    if name == "search_my_documents":
        return {"chunks": _search_docs(db, user_id=user_id, query=q, k=5)}
    return {"error": "unknown tool"}


def _recent_history(db: Session, *, chat_id, user_id, limit: int = 6) -> list:
    """Last few turns of THIS chat, verbatim, so a vague follow-up
    ('what is the max limit?') always carries its immediate context."""
    if chat_id is None:
        return []
    try:
        from app.models.chat import ChatMessage
        rows = db.execute(
            select(ChatMessage.role, ChatMessage.content)
            .where(ChatMessage.chat_id == chat_id, ChatMessage.user_id == user_id)
            .order_by(ChatMessage.id.desc()).limit(limit)
        ).all()
        turns = []
        for role, content in reversed(rows):
            if not (content or "").strip():
                continue
            g = "model" if role == "assistant" else "user"
            turns.append({"role": g, "parts": [{"text": content[:2000]}]})
        # Gemini requires the first turn to be role=user.
        while turns and turns[0]["role"] == "model":
            turns.pop(0)
        return turns
    except Exception as e:  # noqa: BLE001
        log.warning("history load failed: %s", e)
        return []


def answer_agentic(db: Session, question: str, *, user_id: int, chat_id=None, domain=None):
    """Run the tool-calling loop. Returns (text, meta)."""
    contents = _recent_history(db, chat_id=chat_id, user_id=user_id) + [{"role": "user", "parts": [{"text": question}]}]
    tools_used, all_sources, usage_calls = [], [], []
    cfg = {"temperature": 0.2, "maxOutputTokens": 1400, "thinkingConfig": {"thinkingBudget": 0}}
    base = {"systemInstruction": {"parts": [{"text": _SYSTEM}]}, "tools": _TOOLS, "generationConfig": cfg}
    for _ in range(_MAX_ITERS):
        t0 = time.time()
        with httpx.Client(timeout=httpx.Timeout(60.0)) as c:
            r = c.post(f"{_BASE}/{_MODEL}:generateContent",
                       headers={"x-goog-api-key": _KEY, "Content-Type": "application/json"},
                       json={**base, "contents": contents})
        if r.status_code != 200:
            raise RuntimeError(f"agent HTTP {r.status_code}: {r.text[:150]}")
        d = r.json()
        cand = (d.get("candidates") or [{}])[0]
        parts = (cand.get("content") or {}).get("parts") or []
        um = d.get("usageMetadata") or {}
        usage_calls.append({"model": _MODEL,
                            "usage": {"prompt_tokens": um.get("promptTokenCount"),
                                      "completion_tokens": um.get("candidatesTokenCount"),
                                      "total_tokens": um.get("totalTokenCount")},
                            "latency_ms": int((time.time() - t0) * 1000)})
        fcalls = [p["functionCall"] for p in parts if "functionCall" in p]
        if fcalls:
            contents.append({"role": "model", "parts": [{"functionCall": fc} for fc in fcalls]})
            resp_parts = []
            for fc in fcalls:
                name = fc.get("name")
                res = _exec_tool(name, fc.get("args") or {}, db=db, user_id=user_id, chat_id=chat_id)
                tools_used.append(name)
                if name == "web_search" and res.get("sources"):
                    all_sources += res["sources"]
                resp_parts.append({"functionResponse": {"name": name, "response": res}})
            contents.append({"role": "user", "parts": resp_parts})
            continue
        text = "".join(p.get("text", "") for p in parts).strip()
        seen, srcs = set(), []
        for s in all_sources:
            u = s.get("url")
            if u and u not in seen:
                seen.add(u)
                srcs.append(s)
        return text, {"used": "agent", "tools_used": tools_used, "web_sources": srcs, "llm_calls": usage_calls}
    return ("I couldn't complete that — please rephrase.",
            {"used": "agent", "tools_used": tools_used, "web_sources": [], "llm_calls": usage_calls})
