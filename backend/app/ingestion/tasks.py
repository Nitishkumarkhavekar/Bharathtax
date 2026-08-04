"""Celery app + scheduled jobs.

  * incremental_update — re-runs the (idempotent, checksum-deduped) pipeline so
    only NEW circulars/notifications/etc. are ingested. This is how we stay
    fresh, rather than fetching at query time.
  * reap_seat_leases — frees seats whose lease has expired (users who closed the
    tab without logging out), so the concurrency pool self-heals.
"""
from __future__ import annotations

from datetime import datetime, timezone

from celery import Celery
from celery.schedules import crontab
from sqlalchemy import update

from app.core.config import settings
from app.core.logging import get_logger
from app.models.org import SeatLease

log = get_logger(__name__)

celery_app = Celery("bharathtax", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.update(task_track_started=True, timezone="UTC")


def _crontab_from_str(expr: str) -> crontab:
    m, h, dom, mon, dow = expr.split()
    return crontab(minute=m, hour=h, day_of_month=dom, month_of_year=mon, day_of_week=dow)


celery_app.conf.beat_schedule = {
    "incremental-update": {
        "task": "app.ingestion.tasks.incremental_update",
        "schedule": _crontab_from_str(settings.incremental_update_cron),
    },
    "reap-seat-leases": {
        "task": "app.ingestion.tasks.reap_seat_leases",
        "schedule": float(settings.seat_lease_heartbeat_seconds),
    },
    "model-health-alert": {
        "task": "app.ingestion.tasks.model_health_alert",
        "schedule": 600.0,  # every 10 minutes
    },
}


@celery_app.task
def model_health_alert() -> dict:
    """Proactive Gemini watch: ping the API + roll up 24h Gemini spend, and raise
    a persisted alert (Redis + WARNING log) when credits are depleted / rate-
    limited, or spend nears the configured cap. Catches a silent credit
    depletion BEFORE it becomes an outage. (The GPU-box watchdog handles the
    local model backends separately.)"""
    import os
    import json
    import logging
    import httpx
    from datetime import datetime, timezone, timedelta

    log = logging.getLogger("model_alert")
    key = (os.getenv("GEMINI_API_KEY") or "").strip()

    # Health probe: hit `models.list` (auth-checked, zero token spend).
    # The old probe POSTed /generateContent with a fixed generationConfig
    # (maxOutputTokens=1 + thinkingConfig.thinkingBudget=0) which now
    # returns HTTP 400 INVALID_ARGUMENT on thinking models like
    # gemini-flash-latest / gemini-2.5-flash, producing spurious alerts.
    status, detail = "ok", "Responding normally"
    if not key:
        status, detail = "down", "No Gemini API key configured"
    else:
        try:
            with httpx.Client(timeout=10.0) as c:
                r = c.get(
                    "https://generativelanguage.googleapis.com/v1beta/models",
                    headers={"x-goog-api-key": key},
                )
            if r.status_code == 200:
                status, detail = "ok", "Responding normally"
            elif r.status_code in (401, 403):
                status, detail = "down", "Gemini API key rejected (auth failed)"
            elif r.status_code == 429:
                msg = ""
                try:
                    msg = (r.json().get("error", {}) or {}).get("message", "")
                except Exception:
                    pass
                if "credit" in msg.lower() or "depleted" in msg.lower():
                    status, detail = "depleted", "Gemini prepaid credits are depleted \u2014 top up billing"
                else:
                    status, detail = "rate_limited", "Gemini is rate-limited (HTTP 429)"
            else:
                status, detail = "error", f"Gemini HTTP {r.status_code}"
        except Exception as e:  # noqa: BLE001
            status, detail = "error", f"Gemini unreachable: {type(e).__name__}"

    spend = 0
    try:
        from sqlalchemy import text as _t
        from app.core.db import SessionLocal
        db = SessionLocal()
        since = datetime.now(timezone.utc) - timedelta(hours=24)
        spend = int(db.execute(_t(
            "SELECT COALESCE(SUM(total_tokens),0) FROM token_usage "
            "WHERE model LIKE 'gemini%' AND created_at >= :s"), {"s": since}).scalar() or 0)
        db.close()
    except Exception:
        pass
    cap = int(os.getenv("GEMINI_DAILY_TOKEN_CAP", "0"))
    near_cap = cap > 0 and spend >= 0.9 * cap

    alert = None
    if status in ("depleted", "down"):
        alert = {"level": "critical", "code": f"gemini_{status}", "message": detail}
    elif status in ("rate_limited", "error"):
        alert = {"level": "warning", "code": f"gemini_{status}", "message": detail}
    elif near_cap:
        alert = {"level": "warning", "code": "gemini_near_cap",
                 "message": f"Gemini 24h spend ({spend:,} tokens) is near the {cap:,}-token cap"}
    if alert:
        alert["spend_24h_tokens"] = spend
        alert["at"] = datetime.now(timezone.utc).isoformat()

    try:
        import redis as _redis
        rc = _redis.from_url(settings.redis_url)
        if alert:
            rc.set("bt:alert:gemini", json.dumps(alert), ex=3600)
            log.warning("MODEL ALERT: %s", alert["message"])
        else:
            rc.delete("bt:alert:gemini")
    except Exception:
        pass
    return {"status": status, "spend_24h_tokens": spend, "alert": bool(alert)}


@celery_app.task
def incremental_update() -> str:
    from app.ingestion import pipeline  # lazy: avoid heavy import at worker boot

    pipeline.run()
    return "incremental_update complete"


@celery_app.task
def run_appeal_case(run_id: int) -> str:
    from app.services.appeal_draft import run_case  # lazy: avoid heavy import at worker boot

    run_case(run_id)
    return f"appeal run {run_id} complete"


@celery_app.task
def ingest_case_law(path: str = "/data/manual/case_law") -> dict:
    from app.ingestion.case_law import ingest_dir  # lazy

    return ingest_dir(path)


@celery_app.task
def reap_seat_leases() -> int:
    from app.core.db import SessionLocal

    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        res = db.execute(
            update(SeatLease)
            .where(SeatLease.released_at.is_(None), SeatLease.expires_at < now)
            .values(released_at=now)
        )
        db.commit()
        if res.rowcount:
            log.info("reaped %d expired seat lease(s)", res.rowcount)
        return res.rowcount or 0
    finally:
        db.close()
