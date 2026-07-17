"""Authoring helpers shared by the Ask Bot and Documents input boxes.
Currently: "Improve prompt" — refine a rough query into a professional one."""
from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import Principal, get_principal
from app.core.db import get_db
from app.schemas import ImprovePromptRequest, ImprovePromptResponse
from app.services import prompt_refine, tokens
from app.services.quota import require_quota
from app.core.config import settings

router = APIRouter(prefix="/assist", tags=["assist"])
log = logging.getLogger(__name__)

_UPSTREAM_EXC = (
    httpx.HTTPStatusError,
    httpx.ConnectError,
    httpx.ReadError,
    httpx.RemoteProtocolError,
    httpx.TimeoutException,
    ConnectionError,
)


@router.post("/improve-prompt", response_model=ImprovePromptResponse)
def improve_prompt(body: ImprovePromptRequest,
                   p: Principal = Depends(get_principal),
                   _quota: Principal = Depends(require_quota),
                   db: Session = Depends(get_db)) -> ImprovePromptResponse:
    try:
        improved, call_meta = prompt_refine.refine(body.text, context=body.context or "ask")
    except _UPSTREAM_EXC as e:
        log.warning("Improve-prompt upstream error: %s", e)
        raise HTTPException(
            status_code=503,
            detail={
                "code": "llm_unavailable",
                "message": (
                    "The AI service is temporarily unavailable. Please try "
                    "again in a minute."
                ),
            },
        ) from e
    if call_meta:
        tokens.record(
            db, user_id=p.user.id, action="improve_prompt",
            model=call_meta.get("model"),
            usage=call_meta.get("usage"),
            latency_ms=call_meta.get("latency_ms"),
        )
    return ImprovePromptResponse(original=body.text, improved=improved,
                                 changed=improved.strip() != (body.text or "").strip())


@router.post("/feedback")
def feedback(body: dict, _: Principal = Depends(get_principal)) -> dict:
    """Forward a thumbs rating / correction to the model gateway so the model
    learns from it. Body: {question, answer?, rating?('up'|'down'), correction?}."""
    payload = {k: body.get(k) for k in ("question", "answer", "rating", "correction")}
    payload["source"] = "webapp"
    url = settings.llm_base_url.rstrip("/") + "/feedback"
    try:
        with httpx.Client(timeout=15.0) as c:
            r = c.post(url, headers={"Authorization": f"Bearer {settings.llm_api_key}"}, json=payload)
        if r.headers.get("content-type", "").startswith("application/json"):
            return r.json()
        return {"ok": r.status_code == 200}
    except Exception as e:  # never break the UI over feedback
        return {"ok": False, "error": type(e).__name__}
