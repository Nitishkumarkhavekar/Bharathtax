"""Ask Bot route: ask the primary-law corpus, get a grounded, cited answer.
Every query is persisted and audit-logged."""
from __future__ import annotations

import logging
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import Principal, client_meta, get_principal, require_license
from app.core.db import get_db
from app.models.org import User
from app.services import tokens
from app.services.quota import require_quota
from app.core.enums import Domain, QueryScope
from app.models.activity import Query
from app.schemas import AnswerResponse, AskRequest, CitationOut
from app.services import audit, capture, rag

router = APIRouter(prefix="/ask", tags=["ask"])
log = logging.getLogger(__name__)


# Anything raised by the LLM/Gemini path when the upstream is unreachable or
# broken. Not our bug — but we translate to a friendly 503 so the user isn't
# staring at "Internal Server Error".
_UPSTREAM_EXC = (
    httpx.HTTPStatusError,
    httpx.ConnectError,
    httpx.ReadError,
    httpx.RemoteProtocolError,
    httpx.TimeoutException,
    ConnectionError,
)


def _domain(value: str | None) -> Domain | None:
    if not value:
        return None
    try:
        return Domain(value)
    except ValueError:
        return None


@router.post("", response_model=AnswerResponse)
def ask(body: AskRequest, request: Request,
        p: Principal = Depends(get_principal),
        _licensed: User = Depends(require_license),
        _quota: Principal = Depends(require_quota),
        db: Session = Depends(get_db)) -> AnswerResponse:
    started = time.monotonic()
    domain = _domain(body.domain)
    try:
        _use_agent = False
        try:
            from app.services import agent as _agent
            _use_agent = _agent.enabled()
        except Exception:  # noqa: BLE001
            _use_agent = False
        if _use_agent:
            try:
                _t, _am = _agent.answer_agentic(db, body.question, user_id=p.user.id,
                                                chat_id=body.chat_id, domain=domain)
                result = type("AgentResult", (), {})()
                result.text, result.grounded, result.citations, result.meta = _t, True, [], _am
            except Exception as _ae:  # noqa: BLE001
                log.warning("agent failed, falling back to RAG: %s", _ae)
                result = rag.answer_question(db, body.question, domain=domain, user=p.user)
        else:
            result = rag.answer_question(db, body.question, domain=domain, user=p.user)
    except _UPSTREAM_EXC as e:
        log.warning("Ask Bot upstream error: %s", e)
        raise HTTPException(
            status_code=503,
            detail={
                "code": "llm_unavailable",
                "message": (
                    "The AI service is temporarily unavailable. Please try "
                    "again in a minute — if this keeps happening, contact your "
                    "administrator."
                ),
            },
        ) from e
    latency = int((time.monotonic() - started) * 1000)

    citations = [
        CitationOut(n=c.n, chunk_id=c.chunk_id, breadcrumb=c.breadcrumb,
                    source_url=c.source_url, section_number=c.section_number,
                    digest=c.digest, sections_cited=c.sections_cited)
        for c in result.citations
    ]
    q = Query(
        user_id=p.user.id, wing_id=p.user.wing_id, scope=QueryScope.corpus,
        domain=body.domain, question=body.question, answer=result.text,
        citations=[c.model_dump() for c in citations],
        retrieval_meta={**result.meta, "grounded": result.grounded}, latency_ms=latency,
    )
    db.add(q)
    db.commit()
    # Optionally persist this turn into a server-owned chat conversation (only
    # if the chat belongs to this user — otherwise silently skip, never leak).
    if body.chat_id is not None:
        from app.models.chat import Chat, ChatMessage
        chat = db.get(Chat, body.chat_id)
        if chat is not None and chat.user_id == p.user.id:
            um = ChatMessage(chat_id=chat.id, user_id=p.user.id, role="user",
                             content=body.question)
            am = ChatMessage(chat_id=chat.id, user_id=p.user.id, role="assistant",
                             content=result.text,
                             citations=[c.model_dump() for c in citations],
                             meta={"grounded": result.grounded, **(result.meta or {})})
            db.add(um)
            db.add(am)
            if chat.title == "New chat":
                chat.title = (body.question.strip()[:60]) or chat.title
            db.commit()
            # Per-chat semantic memory (best-effort; never breaks the response).
            try:
                from app.services import chat_memory as _mem
                _mem.remember(db, chat_id=chat.id, user_id=p.user.id, message_id=um.id,
                              role="user", content=body.question)
                _mem.remember(db, chat_id=chat.id, user_id=p.user.id, message_id=am.id,
                              role="assistant", content=result.text)
                _mem.maybe_summarize(db, chat_id=chat.id, user_id=p.user.id)
            except Exception:  # noqa: BLE001
                pass
    # Book the LLM token spend against this user for each underlying model call
    # (primary bharattax-rag, plus the optional llama fallback).
    for call in (result.meta.get("llm_calls") or []):
        tokens.record(
            db,
            user_id=p.user.id,
            action="ask",
            model=call.get("model"),
            usage=call.get("usage"),
            latency_ms=call.get("latency_ms"),
        )
    audit.log_event(db, action="ask", user_id=p.user.id, wing_id=p.user.wing_id,
                    resource_type="query", resource_id=str(q.id),
                    query_text=body.question, **client_meta(request))
    try:
        capture.log_event("chat", task="chat.ask", user_id=p.user.id,
                          user_prompt=body.question, response=result.text,
                          meta={"domain": body.domain, "grounded": result.grounded,
                                "citations": [c.model_dump() for c in citations],
                                "llm_calls": result.meta.get("llm_calls")})
    except Exception:  # noqa: BLE001
        pass
    return AnswerResponse(
        query_id=q.id, scope=QueryScope.corpus, grounded=result.grounded,
        answer=result.text, citations=citations, meta=result.meta, latency_ms=latency,
    )


@router.post("/stream")
def ask_stream(body: AskRequest, request: Request,
               p: Principal = Depends(get_principal),
               _licensed: User = Depends(require_license),
               _quota: Principal = Depends(require_quota),
               db: Session = Depends(get_db)) -> StreamingResponse:
    """Server-Sent-Events streaming answer: grounds on the primary-law corpus,
    then streams the composed answer token-by-token from Gemini so the user sees
    the first words in <1s. Persists the turn (Query + chat messages) at the end.
    Falls back to a single 'delta' if streaming fails. Scoped to the caller."""
    import json as _json
    import os as _os
    from app.core.config import settings

    question = body.question
    chat_id = body.chat_id
    uid, wing = p.user.id, p.user.wing_id

    def _gen():
        # 1) grounding context from the corpus (best-effort)
        ctx, grounded = "", False
        try:
            r = httpx.post(settings.llm_base_url.rstrip("/") + "/law",
                           headers={"Authorization": f"Bearer {settings.llm_api_key}"},
                           json={"query": question, "k": 6}, timeout=15.0)
            if r.status_code == 200:
                ps = r.json().get("passages", []) or []
                if ps:
                    grounded = True
                    ctx = "\n\n".join(
                        f"[{i+1}] {x.get('breadcrumb','')}\n{(x.get('text') or '')[:700]}"
                        for i, x in enumerate(ps[:6]))
        except Exception:
            pass

        key = (_os.getenv("GEMINI_API_KEY") or "").strip()
        model = _os.getenv("GEMINI_SEARCH_MODEL", "gemini-2.5-flash")
        sys_p = ("You are BharathTax, an expert Indian income-tax assistant for tax officers. "
                 "Answer from the PASSAGES when relevant and cite them inline as [n]; be precise on "
                 "sections, amounts, dates and the assessment year; never invent a provision. If the "
                 "passages don't cover it, answer from general Indian income-tax knowledge and say so.")
        user_p = (f"PASSAGES:\n{ctx}\n\nQUESTION: {question}" if ctx else question)
        req_body = {"systemInstruction": {"parts": [{"text": sys_p}]},
                    "contents": [{"role": "user", "parts": [{"text": user_p}]}],
                    "generationConfig": {"temperature": 0.2, "maxOutputTokens": 1200,
                                         "thinkingConfig": {"thinkingBudget": 0}}}
        chunks = []
        try:
            with httpx.stream(
                "POST",
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse",
                headers={"x-goog-api-key": key, "Content-Type": "application/json"},
                json=req_body, timeout=httpx.Timeout(60.0),
            ) as resp:
                for line in resp.iter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    payload = line[5:].strip()
                    if not payload or payload == "[DONE]":
                        continue
                    try:
                        d = _json.loads(payload)
                        parts = ((d.get("candidates") or [{}])[0].get("content", {}) or {}).get("parts", []) or []
                        txt = "".join(pt.get("text", "") for pt in parts)
                    except Exception:
                        txt = ""
                    if txt:
                        chunks.append(txt)
                        yield "data: " + _json.dumps({"delta": txt}) + "\n\n"
        except Exception as e:  # noqa: BLE001
            yield "data: " + _json.dumps({"error": str(e)[:120]}) + "\n\n"

        answer = "".join(chunks).strip()
        # 2) persist (Query + optional chat), scoped to this user
        try:
            db.add(Query(user_id=uid, wing_id=wing, scope=QueryScope.corpus,
                         domain=body.domain, question=question, answer=answer, citations=[],
                         retrieval_meta={"streamed": True, "grounded": grounded}, latency_ms=None))
            db.commit()
            if chat_id is not None:
                from app.models.chat import Chat, ChatMessage
                chat = db.get(Chat, chat_id)
                if chat is not None and chat.user_id == uid:
                    db.add(ChatMessage(chat_id=chat.id, user_id=uid, role="user", content=question))
                    db.add(ChatMessage(chat_id=chat.id, user_id=uid, role="assistant", content=answer,
                                       meta={"grounded": grounded, "streamed": True}))
                    if chat.title == "New chat":
                        chat.title = (question.strip()[:60]) or chat.title
                    db.commit()
                    try:
                        from app.services import chat_memory as _mem
                        _mem.remember(db, chat_id=chat.id, user_id=uid, message_id=None,
                                      role="user", content=question)
                        _mem.remember(db, chat_id=chat.id, user_id=uid, message_id=None,
                                      role="assistant", content=answer)
                    except Exception:
                        pass
        except Exception:
            db.rollback()
        yield "data: " + _json.dumps({"done": True, "grounded": grounded}) + "\n\n"

    return StreamingResponse(_gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


class _FollowupsRequest(BaseModel):
    question: str
    answer: str
    domain: str | None = None


@router.post("/followups")
def ask_followups(body: _FollowupsRequest,
                  p: Principal = Depends(get_principal),
                  db: Session = Depends(get_db)) -> dict:
    """Return 3 short, topic-relevant follow-up questions for the last Q&A, so the
    UI can offer them as one-tap suggestions. Best-effort + cheap (flash-lite);
    returns [] on any failure so it never blocks the chat."""
    import os as _os
    import json as _json

    key = (_os.getenv("GEMINI_API_KEY") or "").strip()
    if not key or not (body.question or "").strip():
        return {"suggestions": []}
    model = _os.getenv("GEMINI_FOLLOWUP_MODEL", "gemini-2.5-flash")
    prompt = (
        f"A tax officer asked: {body.question}\n"
        f"The assistant answered: {(body.answer or '')[:1400]}\n\n"
        "Suggest exactly 3 short, natural follow-up questions the officer would "
        "likely ask NEXT about this Indian income-tax topic. Each under 12 words, "
        "specific and useful. Return ONLY a JSON array of 3 strings."
    )
    try:
        r = httpx.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            headers={"x-goog-api-key": key, "Content-Type": "application/json"},
            json={"contents": [{"parts": [{"text": prompt}]}],
                  "generationConfig": {"temperature": 0.4, "maxOutputTokens": 200,
                                       "responseMimeType": "application/json",
                                       "thinkingConfig": {"thinkingBudget": 0}}},
            timeout=12.0,
        )
        if r.status_code != 200:
            return {"suggestions": []}
        txt = "".join(pt.get("text", "") for pt in
                      ((r.json().get("candidates") or [{}])[0].get("content", {}) or {}).get("parts", []))
        arr = _json.loads(txt)
        sugg = [str(x).strip() for x in arr if str(x).strip()][:3]
        return {"suggestions": sugg}
    except Exception:  # noqa: BLE001
        return {"suggestions": []}
