"""Celery app + scheduled jobs.

  * incremental_update — re-runs the (idempotent, checksum-deduped) pipeline so
    only NEW circulars/notifications/etc. are ingested. This is how we stay
    fresh, rather than fetching at query time.
  * reap_seat_leases — frees seats whose lease has expired (users who closed the
    tab without logging out), so the concurrency pool self-heals.
"""
from __future__ import annotations

import os
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
    # Daily fresh-precedent pull: new ITAT orders from Indian Kanoon into the
    # case-law corpus so answers cite current tribunal decisions. Runs at 03:30
    # UTC (after the 02:00 statutory-corpus update), idempotent + cost-capped.
    "daily-case-law-update": {
        "task": "app.ingestion.tasks.daily_case_law_update",
        "schedule": _crontab_from_str(os.getenv("CASE_LAW_UPDATE_CRON", "30 3 * * *")),
    },
    # Poll every configured news source (Google Alerts Atom, Google News RSS,
    # PIB / CBDT) — new stories land in `news_items` and light up the sidebar
    # "News" page. Default cadence 30 min; override with NEWS_POLL_SECONDS.
    "news-feed-poll": {
        "task": "app.ingestion.tasks.poll_news_feeds",
        "schedule": float(os.getenv("NEWS_POLL_SECONDS", "1800")),
    },
}

# Weekly deadline digest — the retention hook. OFF by default; a deployment opts
# in with WEEKLY_DIGEST_ENABLED=1 (so the shared/demo instance never emails real
# officers unsolicited). Default: Monday 03:00 UTC.
if os.getenv("WEEKLY_DIGEST_ENABLED", "0") == "1":
    celery_app.conf.beat_schedule["weekly-digest"] = {
        "task": "app.ingestion.tasks.weekly_digest",
        "schedule": _crontab_from_str(os.getenv("WEEKLY_DIGEST_CRON", "0 3 * * 1")),
    }


def _send_html_email(to: str, subject: str, html: str) -> bool:
    """Best-effort HTML email via the same SMTP env vars password-reset uses."""
    import smtplib
    from email.message import EmailMessage
    host = os.getenv("SMTP_HOST")
    if not host:
        log.warning("SMTP not configured — digest to %s not sent", to)
        return False
    port = int(os.getenv("SMTP_PORT", "587"))
    user, pw = os.getenv("SMTP_USER"), os.getenv("SMTP_PASSWORD")
    sender = os.getenv("SMTP_FROM", user or "no-reply@bharattax.local")
    msg = EmailMessage()
    msg["Subject"], msg["From"], msg["To"] = subject, sender, to
    msg.set_content("Your BharatTax weekly deadline digest — open the app to view your desk.")
    msg.add_alternative(html, subtype="html")
    try:
        with smtplib.SMTP(host, port, timeout=20) as s:
            s.starttls()
            if user and pw:
                s.login(user, pw)
            s.send_message(msg)
        return True
    except Exception as e:  # noqa: BLE001
        log.warning("digest email to %s failed: %s", to, e)
        return False


def _digest_html(name: str, wl: dict, app_url: str) -> str | None:
    """Compose the digest HTML from a user's workload; None if nothing is due."""
    s = wl.get("summary", {})
    overdue, week = s.get("overdue", 0), s.get("due_7", 0)
    if overdue == 0 and week == 0 and s.get("due_30", 0) == 0:
        return None
    rows = sorted((m for m in wl.get("matters", []) if m.get("next_due_date")),
                  key=lambda m: m["next_due_date"])[:8]
    def _row(m: dict) -> str:
        from datetime import date
        try:
            d = date.fromisoformat(m["next_due_date"])
            days = (d - date.today()).days
            when = d.strftime("%d %b %Y")
            tag = ("OVERDUE" if days < 0 else f"{days}d" if days <= 30 else "")
            tone = "#b91c1c" if days < 0 else "#b45309" if days <= 7 else "#475569"
        except Exception:
            when, tag, tone = m.get("next_due_date", ""), "", "#475569"
        label = (m.get("next_label") or "Deadline")
        sec = f" · {m['next_section']}" if m.get("next_section") else ""
        return (f'<tr><td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:13px;color:#0f172a">'
                f'<b>{m.get("title","")}</b><div style="color:#64748b;font-size:12px">{label}{sec}</div></td>'
                f'<td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:13px;text-align:right;color:{tone};white-space:nowrap">'
                f'{when}{" · <b>"+tag+"</b>" if tag else ""}</td></tr>')
    table = "".join(_row(m) for m in rows)
    hdr = []
    if overdue:
        hdr.append(f'<span style="color:#b91c1c;font-weight:600">{overdue} overdue</span>')
    if week:
        hdr.append(f'<span style="color:#b45309;font-weight:600">{week} due this week</span>')
    return f"""\
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto">
  <div style="padding:20px 4px 12px"><span style="font-size:18px;font-weight:700;color:#173f70">BharatTax</span>
    <span style="color:#64748b;font-size:12px"> · your week ahead</span></div>
  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:18px 20px">
    <div style="font-size:15px;color:#0f172a">Hello {name},</div>
    <div style="font-size:13.5px;color:#475569;margin-top:6px">On your desk: {" · ".join(hdr) or "upcoming deadlines"}.
      Here's what needs you — don't let a case go time-barred.</div>
    <table style="width:100%;border-collapse:collapse;margin-top:14px">{table}</table>
    <div style="margin-top:18px">
      <a href="{app_url}/workspace" style="display:inline-block;background:#173f70;color:#fff;text-decoration:none;
        font-weight:600;font-size:13.5px;padding:10px 18px;border-radius:10px">Open my desk →</a>
    </div>
  </div>
  <div style="color:#94a3b8;font-size:11px;padding:12px 4px">You get this because you have upcoming deadlines in BharatTax.
    Manage it in your profile.</div>
</div>"""


@celery_app.task
def weekly_digest() -> dict:
    """Email each active officer their upcoming deadlines. Opt-out honoured."""
    from sqlalchemy import select
    from app.core.db import SessionLocal
    from app.models.org import User
    from app.services import workspace as ws
    app_url = os.getenv("APP_BASE_URL", "https://bharattax.wenvia.global")
    db = SessionLocal()
    sent = skipped = failed = 0
    try:
        users = list(db.scalars(select(User).where(
            User.is_active.is_(True), User.email.isnot(None), User.digest_optout.is_(False))))
        for u in users:
            try:
                wl = ws.workload(db, u.id)
                html = _digest_html(u.full_name or u.username or "Officer", wl, app_url)
                if not html:
                    skipped += 1
                    continue
                if _send_html_email(u.email, "Your BharatTax week — deadlines ahead", html):
                    sent += 1
                else:
                    failed += 1
            except Exception as e:  # noqa: BLE001
                failed += 1
                log.warning("weekly_digest for user %s failed: %s", u.id, e)
    finally:
        db.close()
    log.info("weekly_digest done: sent=%d skipped=%d failed=%d", sent, skipped, failed)
    return {"sent": sent, "skipped": skipped, "failed": failed}


# Every ITAT order is income-tax, so one broad catch-all query + doctypes:itat +
# sortby:mostrecent (embedded in acquire._search) surfaces the recent tribunal
# orders; the publishdate window then keeps only fresh ones. Extra terms would
# just re-fetch the same orders (dedup collapses them) and cost billable pages.
_CASE_LAW_QUERIES = ["income tax"]

# Relevance guard for unsupervised ingestion. Indian Kanoon's doctypes=itat
# still surfaces statutory-provision pages ("Section 11 in The Land Acquisition
# Act, 1894") and non-income-tax matter; those must not pollute the corpus.
import re as _re
# "Section 158BB in The Income Tax Act, 1961", "Article 14 in ...", etc. — these
# are Indian Kanoon statutory-provision landing pages, NOT judgments.
_PROVISION_RE = _re.compile(r"^\s*(section|article|rule|order|regulation)\s+[\w.\-]+\s+in\b", _re.I)
# Real judgments are party-vs-party.
_PARTY_RE = _re.compile(r"\b(vs?\.?|versus)\b", _re.I)
_ITAX_SIGNALS = (
    "income tax", "income-tax", "i.t.a", "ita no", "i.t.a. no", "itat",
    "appellate tribunal", "acit", "dcit", "assessing officer",
    "commissioner of income", "income tax officer", "assessment year",
)


# The income-tax party signal must be in the TITLE — income-tax tribunal cases
# are "Commissioner of Income Tax / ACIT / DCIT / ITO vs X". Requiring it in the
# title (not the body) rejects off-topic party-vs-party cases that merely mention
# tax in passing (e.g. a wills or constitutional judgment).
_TITLE_ITAX_RE = _re.compile(
    r"\b(income[\s-]?tax|itat|a\.?c\.?i\.?t|d\.?c\.?i\.?t|\bito\b|"
    r"commissioner of income|appellate tribunal|\bcit\b)\b", _re.I)


def _accept_itax_judgment(title: str, text: str) -> bool:
    """True only for an actual income-tax tribunal judgment: a party-vs-party
    title (not a statutory-provision page) whose parties are an income-tax
    authority. Deliberately strict — a clean, smaller pull beats a polluted
    corpus."""
    t = (title or "").strip()
    if _PROVISION_RE.match(t):           # statutory-provision landing page
        return False
    if not _PARTY_RE.search(t):          # not "X vs Y" → not a judgment
        return False
    return bool(_TITLE_ITAX_RE.search(t))  # income-tax party in the title


@celery_app.task
def daily_case_law_update() -> dict:
    """Pull the last few days of fresh ITAT orders from Indian Kanoon into the
    case-law corpus, so answers cite current precedent instead of only the
    static seed set. Idempotent (content-hash dedup skips already-ingested
    orders) and cost-capped per run. Token: IK_API_TOKEN or INDIANKANOON_API_TOKEN.

    Tunables (env): CASE_LAW_LOOKBACK_DAYS (default 8, overlaps the daily run so
    nothing slips through a gap), CASE_LAW_DAILY_CAP_PER_QUERY (default 15)."""
    from datetime import date, timedelta
    from app.ingestion.acquire import indiankanoon

    # OFF by default: the fetch/dedup/relevance mechanism is proven, but Indian
    # Kanoon's date window still surfaces old landmark cases, so recency must be
    # validated before this runs unsupervised. Enable with CASE_LAW_DAILY_ENABLED=1.
    if os.getenv("CASE_LAW_DAILY_ENABLED", "0").lower() not in ("1", "true", "yes", "on"):
        log.info("daily_case_law_update disabled (set CASE_LAW_DAILY_ENABLED=1 to enable)")
        return {"skipped": "disabled"}

    tok = (os.getenv("IK_API_TOKEN") or os.getenv("INDIANKANOON_API_TOKEN") or "").strip()
    if not tok:
        log.warning("daily_case_law_update: no Indian Kanoon token — skipping")
        return {"skipped": "no_token"}
    os.environ["IK_API_TOKEN"] = tok  # the acquire module reads this exact name

    lookback = int(os.getenv("CASE_LAW_LOOKBACK_DAYS", "8"))
    cap = int(os.getenv("CASE_LAW_DAILY_CAP_PER_QUERY", "40"))
    today = date.today()
    fromdate = (today - timedelta(days=lookback)).strftime("%d-%m-%Y")
    todate = today.strftime("%d-%m-%Y")

    total = {"ingested": 0, "docs_fetched": 0, "search_pages": 0}
    for q in _CASE_LAW_QUERIES:
        try:
            r = indiankanoon.run(q, cap, fromdate, todate, accept=_accept_itax_judgment)
            for k in total:
                total[k] += int(r.get(k, 0) or 0)
        except Exception as e:  # noqa: BLE001  (one bad query must not abort the sweep)
            log.warning("daily_case_law_update: query %r failed: %s", q, str(e)[:150])
    total["approx_billable_pages"] = total["search_pages"] + total["docs_fetched"]

    # Backfill sections_cited on the rows just ingested (they land with it NULL),
    # so today's fresh judgments are immediately matchable by the ruling
    # watchlist / "every case on s.68". Idempotent — touches only NULL rows.
    if total["ingested"]:
        try:
            from app.ingestion.pipeline import backfill_section_cites
            backfill_section_cites()
        except Exception as e:  # noqa: BLE001  (backfill must not fail the ingest)
            log.warning("daily_case_law_update: section backfill failed: %s", str(e)[:150])

    log.info("daily_case_law_update DONE %s (window %s..%s)", total, fromdate, todate)
    return total


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
    from app.services import gemini_transport as _tx
    status, detail = "ok", "Responding normally"
    if _tx.is_vertex():
        # Vertex: bearer-token auth + per-project model resource endpoint.
        if not _tx.available():
            status, detail = "down", "GEMINI_VERTEX_PROJECT not configured"
        else:
            try:
                pbody = {"contents": [{"role": "user", "parts": [{"text": "ping"}]}],
                         "generationConfig": {"maxOutputTokens": 5, "temperature": 0,
                                              "thinkingConfig": {"thinkingBudget": 0}}}
                with httpx.Client(timeout=10.0) as c:
                    r = c.post(_tx.url("gemini-2.5-flash", "generateContent"),
                               headers=_tx.headers(), json=pbody)
                if r.status_code == 200:
                    status, detail = "ok", "Responding via Vertex AI"
                elif r.status_code in (401, 403):
                    status, detail = "down", "Vertex auth failed (SA role?)"
                else:
                    status, detail = "error", f"Vertex HTTP {r.status_code}"
            except Exception as e:  # noqa: BLE001
                status, detail = "error", f"Vertex unreachable: {type(e).__name__}"
    elif not key:
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
def run_assessment_case(run_id: int) -> str:
    from app.services.assessment_draft import run_case  # lazy: avoid heavy import at worker boot

    run_case(run_id)
    return f"assessment run {run_id} complete"


@celery_app.task
def ingest_case_law(path: str = "/data/manual/case_law") -> dict:
    from app.ingestion.case_law import ingest_dir  # lazy

    return ingest_dir(path)


@celery_app.task
def poll_news_feeds() -> dict:
    """Poll every active NewsSource and upsert fresh items into news_items.
    Idempotent (SHA-256 hash dedup). One bad feed never aborts the sweep."""
    from app.services import news_ingest  # lazy — worker-cold-start safe

    # Bootstrap the default sources on first run so ops don't have to seed
    # the table by hand. Idempotent.
    try:
        news_ingest.ensure_default_sources()
    except Exception as e:  # noqa: BLE001
        log.warning("news source bootstrap failed: %s", e)

    r = news_ingest.poll_all()
    # After ingest, pick up og:images for the newest items that still
    # have image_url = NULL — bounded so this can't runaway.
    try:
        r["image_hydration"] = news_ingest.hydrate_images(limit=40)
    except Exception as e:  # noqa: BLE001
        log.warning("hydrate_images failed: %s", e)
    return r


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
