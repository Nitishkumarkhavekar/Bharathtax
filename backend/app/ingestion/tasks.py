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

celery_app = Celery("taxmedha", broker=settings.redis_url, backend=settings.redis_url)
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
}


@celery_app.task
def incremental_update() -> str:
    from app.ingestion import pipeline  # lazy: avoid heavy import at worker boot

    pipeline.run()
    return "incremental_update complete"


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
