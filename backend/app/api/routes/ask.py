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
from app.services import gemini_transport as _tx

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
        _use_multi = False
        try:
            from app.services import agent as _agent
            _use_agent = _agent.enabled()
        except Exception:  # noqa: BLE001
            _use_agent = False
        try:
            from app.services import multi_agent as _multi
            from app.services import query_router as _router
            # Multi-agent (3–6 Gemini calls) only for genuinely complex asks;
            # simple lookups fall through to the single grounded agent.
            _use_multi = _multi.enabled() and _router.should_use_multi(body.question)
        except Exception:  # noqa: BLE001
            _use_multi = False
        if _use_agent:
            try:
                if _use_multi:
                    _t, _am = _multi.answer_multi_agent(
                        db, body.question, user_id=p.user.id,
                        chat_id=body.chat_id, domain=domain,
                    )
                else:
                    _t, _am = _agent.answer_agentic(
                        db, body.question, user_id=p.user.id,
                        chat_id=body.chat_id, domain=domain,
                    )
                result = type("AgentResult", (), {})()
                # Cite what the agent's search_tax_law tool actually retrieved
                # (act/section per passage). Fall back to parsing the answer's
                # "Sources:" footer when the agent answered without that tool.
                try:
                    _cites = rag.citations_from_law_refs(db, _am.get("law_refs") or [])
                    if not _cites:
                        _cites = rag.parse_source_citations(db, _t)
                except Exception:  # noqa: BLE001
                    log.exception("citation parsing failed (agent path)")
                    _cites = []
                result.text, result.grounded, result.citations, result.meta = _t, True, _cites, _am
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
    """Server-Sent-Events streaming answer. Runs the SAME tool-calling agent as
    POST /ask (corpus + case law + web + citations), but streams it: a 'status'
    event while each tool runs, 'delta' events as the final answer generates, and
    a 'done' event carrying citations + meta. Persists the turn at the end.
    Scoped to the caller; falls back to the non-streaming pipeline if needed."""
    import json as _json

    question = body.question
    chat_id = body.chat_id
    uid, wing = p.user.id, p.user.wing_id
    domain = _domain(body.domain)
    user = p.user

    def _sse(obj: dict) -> str:
        return "data: " + _json.dumps(obj) + "\n\n"

    def _cit_out(cits) -> list[CitationOut]:
        return [CitationOut(n=c.n, chunk_id=c.chunk_id, breadcrumb=c.breadcrumb,
                            source_url=c.source_url, section_number=c.section_number,
                            digest=c.digest, sections_cited=c.sections_cited) for c in cits]

    def _persist(answer: str, grounded: bool, meta: dict, cit_out: list[CitationOut]) -> None:
        cits = [c.model_dump() for c in cit_out]
        try:
            db.add(Query(user_id=uid, wing_id=wing, scope=QueryScope.corpus,
                         domain=body.domain, question=question, answer=answer, citations=cits,
                         retrieval_meta={**(meta or {}), "grounded": grounded, "streamed": True},
                         latency_ms=None))
            db.commit()
            if chat_id is not None:
                from app.models.chat import Chat, ChatMessage
                chat = db.get(Chat, chat_id)
                if chat is not None and chat.user_id == uid:
                    db.add(ChatMessage(chat_id=chat.id, user_id=uid, role="user", content=question))
                    db.add(ChatMessage(chat_id=chat.id, user_id=uid, role="assistant", content=answer,
                                       citations=cits, meta={"grounded": grounded, "streamed": True,
                                                             **(meta or {})}))
                    if chat.title == "New chat":
                        chat.title = (question.strip()[:60]) or chat.title
                    db.commit()
                    try:
                        from app.services import chat_memory as _mem
                        _mem.remember(db, chat_id=chat.id, user_id=uid, message_id=None,
                                      role="user", content=question)
                        _mem.remember(db, chat_id=chat.id, user_id=uid, message_id=None,
                                      role="assistant", content=answer)
                    except Exception:  # noqa: BLE001
                        pass
        except Exception:  # noqa: BLE001
            db.rollback()
        for call in (meta or {}).get("llm_calls") or []:
            try:
                tokens.record(db, user_id=uid, action="ask", model=call.get("model"),
                              usage=call.get("usage"), latency_ms=call.get("latency_ms"))
            except Exception:  # noqa: BLE001
                pass

    def _gen():
        use_agent = False
        use_multi = False
        try:
            from app.services import agent as _agent
            use_agent = _agent.enabled()
        except Exception:  # noqa: BLE001
            use_agent = False
        try:
            from app.services import multi_agent as _multi
            from app.services import query_router as _router
            use_multi = _multi.enabled() and _router.should_use_multi(question)
        except Exception:  # noqa: BLE001
            use_multi = False

        if use_agent:
            from app.services import agent as _agent
            _stream_fn = (
                _multi.answer_multi_agent_stream if use_multi
                else _agent.answer_agentic_stream
            )
            full, meta = "", {}
            try:
                for ev in _stream_fn(db, question, user_id=uid,
                                     chat_id=chat_id, domain=domain):
                    if "delta" in ev:
                        full += ev["delta"]
                        yield _sse({"delta": ev["delta"]})
                    elif "status" in ev:
                        yield _sse({"status": ev["status"]})
                    elif ev.get("reset"):
                        full = ""
                        yield _sse({"reset": True})
                    elif "clarify" in ev:
                        clr = ev["clarify"]
                        cq = (clr.get("question") or "").strip()
                        yield _sse({"reset": True})
                        yield _sse({"delta": cq})
                        _persist(cq, True, {"clarify": clr}, [])
                        yield _sse({"done": True, "grounded": True, "citations": [],
                                    "meta": {"clarify": clr}})
                        return
                    elif "done" in ev:
                        meta = ev["done"] or {}
                        full = (meta.get("text") or full).strip()
                try:
                    cites = rag.citations_from_law_refs(db, meta.get("law_refs") or [])
                    if not cites:
                        cites = rag.parse_source_citations(db, full)
                except Exception:  # noqa: BLE001
                    log.exception("stream citation parse failed")
                    cites = []
                cit_out = _cit_out(cites)
                meta_out = {k: v for k, v in (meta or {}).items() if k != "text"}
                _persist(full, True, meta_out, cit_out)
                yield _sse({"done": True, "grounded": True,
                            "citations": [c.model_dump() for c in cit_out], "meta": meta_out})
                return
            except Exception as e:  # noqa: BLE001
                log.warning("agent stream failed: %s", e)
                if full:  # already streaming — close it out rather than restart
                    _persist(full, True, meta, [])
                    yield _sse({"done": True, "grounded": True, "citations": [], "meta": {}})
                    return
                # else fall through to the non-streaming pipeline

        # Fallback (agent disabled, or it failed before emitting anything): run the
        # real RAG pipeline and deliver it as a single delta so the UI still works.
        try:
            res = rag.answer_question(db, question, domain=domain, user=user)
        except _UPSTREAM_EXC:
            yield _sse({"error": "The AI service is temporarily unavailable."})
            yield _sse({"done": True, "grounded": False, "citations": [], "meta": {}})
            return
        cit_out = _cit_out(res.citations)
        _persist(res.text, res.grounded, res.meta, cit_out)
        yield _sse({"delta": res.text})
        yield _sse({"done": True, "grounded": res.grounded,
                    "citations": [c.model_dump() for c in cit_out], "meta": res.meta})

    return StreamingResponse(_gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


class _FollowupsRequest(BaseModel):
    question: str
    answer: str
    domain: str | None = None


@router.get("/starters")
def ask_starters(p: Principal = Depends(get_principal)) -> dict:
    """Rotating 'suggested starter' questions for the empty chat screen — a
    shuffled mix of today's trending topics and evergreen questions, so the same
    six do not appear on every visit. Fail-open: [] on any error."""
    try:
        from app.services import starters as _st
        return {"starters": _st.get_starters(6)}
    except Exception:  # noqa: BLE001
        return {"starters": []}


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
    model = _os.getenv("GEMINI_FOLLOWUP_MODEL", "gemini-flash-latest")
    prompt = (
        f"A tax officer asked: {body.question}\n"
        f"The assistant answered: {(body.answer or '')[:1400]}\n\n"
        "Suggest exactly 3 short, natural follow-up questions the officer would "
        "likely ask NEXT about this Indian income-tax topic. Each under 12 words, "
        "specific and useful. Return ONLY a JSON array of 3 strings."
    )
    try:
        r = httpx.post(
            _tx.url(model, "generateContent"),
            headers=_tx.headers(),
            json={"contents": [{"parts": [{"text": prompt}]}],
                  # thinkingBudget=128 is the sweet spot on gemini-flash-latest:
                  # (a) 0 combined with responseMimeType=json → 400 INVALID_ARG;
                  # (b) unset lets the model burn ~192 thinking tokens, blowing
                  #     past maxOutputTokens=200 and returning a fragment.
                  # 128 caps thinking so the JSON array actually fits.
                  "generationConfig": {"temperature": 0.4, "maxOutputTokens": 400,
                                       "responseMimeType": "application/json",
                                       "thinkingConfig": {"thinkingBudget": 128}}},
            timeout=12.0,
        )
        if r.status_code != 200:
            log.warning("followups HTTP %s: %s", r.status_code, r.text[:200])
            return {"suggestions": []}
        txt = "".join(pt.get("text", "") for pt in
                      ((r.json().get("candidates") or [{}])[0].get("content", {}) or {}).get("parts", []))
        arr = _json.loads(txt)
        sugg = [str(x).strip() for x in arr if str(x).strip()][:3]
        return {"suggestions": sugg}
    except Exception:  # noqa: BLE001
        return {"suggestions": []}


class _TranslateRequest(BaseModel):
    text: str
    lang: str  # target language name, e.g. "Hindi", "Tamil". "English" = no-op.


@router.post("/translate")
def ask_translate(body: _TranslateRequest,
                  p: Principal = Depends(get_principal)) -> dict:
    """On-demand translation of an answer into an Indian language. Section
    numbers, amounts, dates, case names and citations are preserved verbatim so
    the legal content stays exact. Fail-open: returns the original on any error."""
    import os as _os

    text = (body.text or "").strip()
    lang = (body.lang or "").strip()
    if not text or not lang or lang.lower() in ("english", "en"):
        return {"translated": text}
    key = (_os.getenv("GEMINI_API_KEY") or "").strip()
    if not key:
        return {"translated": text}
    model = _os.getenv("GEMINI_TRANSLATE_MODEL", "gemini-flash-latest")
    sys_p = (
        f"You are a precise legal translator. Translate the user's Indian income-tax "
        f"answer into {lang}. Rules: keep the meaning exact and natural; DO NOT "
        f"translate or alter section numbers, rule numbers, amounts, dates, "
        f"assessment years, PAN, case names, party names or citations — leave those "
        f"verbatim; preserve the markdown formatting and any [n] citation markers. "
        f"Output ONLY the translation, no preamble."
    )
    try:
        r = httpx.post(
            _tx.url(model, "generateContent"),
            headers=_tx.headers(),
            json={"systemInstruction": {"parts": [{"text": sys_p}]},
                  "contents": [{"role": "user", "parts": [{"text": text}]}],
                  # NB: drop thinkingConfig — gemini-flash-latest can 400 on
                  # thinkingBudget=0 for translate prompts. Auto is fine here.
                  "generationConfig": {"temperature": 0.1, "maxOutputTokens": 2000}},
            timeout=40.0,
        )
        if r.status_code != 200:
            log.warning("translate HTTP %s", r.status_code)
            return {"translated": text}
        out = "".join(pt.get("text", "") for pt in
                      ((r.json().get("candidates") or [{}])[0].get("content", {}) or {}).get("parts", []))
        return {"translated": out.strip() or text}
    except Exception:  # noqa: BLE001
        log.exception("translate failed")
        return {"translated": text}
