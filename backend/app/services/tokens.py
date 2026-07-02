"""Helper for persisting per-call LLM token usage.

Every route / worker that calls the model gateway calls `record()` right after
`OpenAICompatLLM.complete()` so we get a per-request row in `token_usage`.
Never raises — token accounting is a nice-to-have, not a business gate.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.models.token_usage import TokenUsage

log = get_logger(__name__)


def record(
    db: Session,
    *,
    user_id: int | None,
    action: str,
    model: str | None,
    usage: dict | None,
    latency_ms: int | None = None,
) -> None:
    """Persist one token-usage row. Silently no-ops if the gateway didn't
    return a usage block (e.g. mock LLM, or if the gateway is misconfigured)."""
    try:
        # LiteLLM returns {"prompt_tokens": N, "completion_tokens": M, "total_tokens": K}
        pt = int((usage or {}).get("prompt_tokens") or 0)
        ct = int((usage or {}).get("completion_tokens") or 0)
        tt = int((usage or {}).get("total_tokens") or (pt + ct))
        if pt == 0 and ct == 0 and tt == 0:
            # Some backends return zeros — still record so the "call count"
            # matters, but don't spam if there's literally nothing.
            if not action:
                return
        row = TokenUsage(
            user_id=user_id,
            action=(action or "unknown")[:60],
            model=(model or "unknown")[:120],
            prompt_tokens=pt,
            completion_tokens=ct,
            total_tokens=tt,
            latency_ms=latency_ms,
        )
        db.add(row)
        db.commit()
    except Exception as exc:  # pragma: no cover — accounting must never break the caller
        log.warning("token_usage.record failed: %s", exc)
        try:
            db.rollback()
        except Exception:
            pass
