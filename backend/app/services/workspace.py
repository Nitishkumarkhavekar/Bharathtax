"""Daily-workspace service: matters, statutory deadlines, reminders.

All reads and writes are scoped to a ``user_id`` — ownership is enforced here
so the route layer stays thin. Deadlines are computed via
:mod:`app.services.limitation`; when a statutory deadline is created we also
seed a single in-app reminder a week ahead so nothing slips silently.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.models.workspace import (
    Deadline, Matter, MatterShare, Reminder, StickyNote, Watchlist, WorkspaceTemplate,
)
from app.services import limitation

# How far ahead of a statutory deadline to seed the auto-reminder.
_AUTO_REMINDER_LEAD_DAYS = 7
# India Standard Time — reminders fire at 09:00 IST, not 09:00 UTC.
_IST = timezone(timedelta(hours=5, minutes=30))
# Bound unpaginated list queries so a heavy account can't load unbounded rows.
_LIST_CAP = 500


# --- matters -----------------------------------------------------------------
def list_matters(db: Session, user_id: int) -> list[Matter]:
    """Matters the user owns, plus matters shared with them."""
    owned = list(db.scalars(
        select(Matter).where(Matter.user_id == user_id)
        .order_by(Matter.updated_at.desc()).limit(_LIST_CAP)))
    shared_ids = [s.matter_id for s in db.scalars(
        select(MatterShare).where(MatterShare.shared_with_user_id == user_id).limit(_LIST_CAP))]
    shared = list(db.scalars(select(Matter).where(Matter.id.in_(shared_ids)))) if shared_ids else []
    everything = owned + shared
    everything.sort(key=lambda m: m.updated_at or m.created_at, reverse=True)
    return everything


def get_matter(db: Session, matter_id: int, user_id: int) -> Matter | None:
    """OWNED matter — the write-access check (compute, edit, delete)."""
    return db.scalar(
        select(Matter).where(Matter.id == matter_id, Matter.user_id == user_id)
    )


def readable_matter(db: Session, matter_id: int, user_id: int) -> Matter | None:
    """Matter the user can READ — owned or shared with them."""
    m = db.get(Matter, matter_id)
    if not m:
        return None
    if m.user_id == user_id:
        return m
    share = db.scalar(select(MatterShare).where(
        MatterShare.matter_id == matter_id, MatterShare.shared_with_user_id == user_id))
    return m if share else None


def create_matter(db: Session, user_id: int, **fields) -> Matter:
    m = Matter(user_id=user_id, **fields)
    db.add(m)
    db.commit()
    db.refresh(m)
    return m


def update_matter(db: Session, matter_id: int, user_id: int, **fields) -> Matter | None:
    m = get_matter(db, matter_id, user_id)
    if not m:
        return None
    for k, v in fields.items():
        if v is not None:
            setattr(m, k, v)
    db.commit()
    db.refresh(m)
    return m


def delete_matter(db: Session, matter_id: int, user_id: int) -> bool:
    m = get_matter(db, matter_id, user_id)
    if not m:
        return False
    db.delete(m)          # deadlines + reminders cascade at the DB level
    db.commit()
    return True


# --- deadlines ---------------------------------------------------------------
def list_deadlines(db: Session, matter_id: int) -> list[Deadline]:
    """All deadlines on a matter (caller must gate matter access first)."""
    return list(db.scalars(
        select(Deadline)
        .where(Deadline.matter_id == matter_id)
        .order_by(Deadline.due_date)
    ))


def _seed_reminder(db: Session, dl: Deadline) -> None:
    lead = dl.due_date - timedelta(days=_AUTO_REMINDER_LEAD_DAYS)
    when = max(lead, datetime.now(_IST).date())
    due_at = datetime.combine(when, time(9, 0), tzinfo=_IST)   # 09:00 IST
    db.add(Reminder(
        user_id=dl.user_id, matter_id=dl.matter_id, deadline_id=dl.id,
        title=dl.label, due_at=due_at, channels=["in_app"], status="pending",
    ))


def compute_and_store(db: Session, matter_id: int, user_id: int,
                      trigger: str, trigger_date: date) -> list[Deadline]:
    """Compute the deadlines a trigger produces, persist them, seed reminders."""
    if not get_matter(db, matter_id, user_id):
        return []
    created: list[Deadline] = []
    for c in limitation.compute_deadlines(trigger, trigger_date):
        dl = Deadline(
            matter_id=matter_id, user_id=user_id, kind=c["rule_id"],
            label=c["label"], section_ref=c["section"], trigger_event=trigger,
            trigger_date=trigger_date, due_date=c["due_date"], is_auto=True,
        )
        db.add(dl)
        db.flush()               # need dl.id for the reminder
        _seed_reminder(db, dl)
        created.append(dl)
    db.commit()
    for dl in created:
        db.refresh(dl)
    return created


def add_manual_deadline(db: Session, matter_id: int, user_id: int,
                        label: str, due_date: date, section_ref: str | None = None,
                        notes: str | None = None, remind: bool = True) -> Deadline | None:
    if not get_matter(db, matter_id, user_id):
        return None
    dl = Deadline(
        matter_id=matter_id, user_id=user_id, kind="manual", label=label,
        section_ref=section_ref, due_date=due_date, is_auto=False, notes=notes,
    )
    db.add(dl)
    db.flush()
    if remind:
        _seed_reminder(db, dl)
    db.commit()
    db.refresh(dl)
    return dl


def update_deadline(db: Session, deadline_id: int, user_id: int, **fields) -> Deadline | None:
    dl = db.scalar(select(Deadline).where(
        Deadline.id == deadline_id, Deadline.user_id == user_id))
    if not dl:
        return None
    for k, v in fields.items():
        if v is not None:
            setattr(dl, k, v)
    db.commit()
    db.refresh(dl)
    return dl


def delete_deadline(db: Session, deadline_id: int, user_id: int) -> bool:
    dl = db.scalar(select(Deadline).where(
        Deadline.id == deadline_id, Deadline.user_id == user_id))
    if not dl:
        return False
    db.delete(dl)
    db.commit()
    return True


# --- calendar ----------------------------------------------------------------
def calendar(db: Session, user_id: int, start: date, end: date,
             include_done: bool = False) -> list[Deadline]:
    conds = [Deadline.user_id == user_id,
             Deadline.due_date >= start, Deadline.due_date <= end]
    if not include_done:
        conds.append(Deadline.status == "open")
    return list(db.scalars(
        select(Deadline).where(and_(*conds)).order_by(Deadline.due_date)
    ))


# --- workload / portfolio ----------------------------------------------------
def workload(db: Session, user_id: int, today: date | None = None) -> dict:
    """A portfolio view: every matter (owned + shared) enriched with its next
    open statutory deadline and per-matter counts, plus caseload-wide totals."""
    today = today or datetime.now(_IST).date()
    matters = list_matters(db, user_id)
    mids = [m.id for m in matters]
    deadlines: list[Deadline] = []
    if mids:
        deadlines = list(db.scalars(
            select(Deadline).where(Deadline.matter_id.in_(mids), Deadline.status == "open")))

    by_matter: dict[int, list[Deadline]] = {}
    for d in deadlines:
        by_matter.setdefault(d.matter_id, []).append(d)

    summary = {"total_matters": len(matters), "open_deadlines": len(deadlines),
               "overdue": 0, "due_7": 0, "due_30": 0}
    for d in deadlines:
        diff = (d.due_date - today).days
        if diff < 0:
            summary["overdue"] += 1
        elif diff <= 7:
            summary["due_7"] += 1
        elif diff <= 30:
            summary["due_30"] += 1

    rows = []
    for m in matters:
        dls = sorted(by_matter.get(m.id, []), key=lambda d: d.due_date)
        nxt = dls[0] if dls else None
        overdue = sum(1 for d in dls if (d.due_date - today).days < 0)
        urgent = sum(1 for d in dls if 0 <= (d.due_date - today).days <= 7)
        rows.append({
            "id": m.id, "title": m.title, "pan": m.pan, "assessment_year": m.assessment_year,
            "category": m.category, "status": m.status, "owned": m.user_id == user_id,
            "open_count": len(dls), "overdue_count": overdue, "urgent_count": urgent,
            "next_due_date": nxt.due_date.isoformat() if nxt else None,
            "next_label": nxt.label if nxt else None,
            "next_section": nxt.section_ref if nxt else None,
            "updated_at": m.updated_at.isoformat() if m.updated_at else None,
        })
    return {"summary": summary, "matters": rows}


# --- reminders ---------------------------------------------------------------
def list_reminders(db: Session, user_id: int, pending_only: bool = True) -> list[Reminder]:
    stmt = select(Reminder).where(Reminder.user_id == user_id)
    if pending_only:
        stmt = stmt.where(Reminder.status == "pending")
    return list(db.scalars(stmt.order_by(Reminder.due_at).limit(_LIST_CAP)))


def due_reminders(db: Session, user_id: int, now: datetime | None = None) -> list[Reminder]:
    """Pending reminders whose time has arrived — the in-app bell feed."""
    now = now or datetime.now(timezone.utc)
    return list(db.scalars(
        select(Reminder)
        .where(Reminder.user_id == user_id, Reminder.status == "pending",
               Reminder.due_at <= now)
        .order_by(Reminder.due_at)
    ))


def create_reminder(db: Session, user_id: int, title: str, due_at: datetime,
                    matter_id: int | None = None, channels: list | None = None,
                    notes: str | None = None) -> Reminder:
    r = Reminder(user_id=user_id, title=title, due_at=due_at, matter_id=matter_id,
                 channels=channels or ["in_app"], notes=notes, status="pending")
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


def update_reminder(db: Session, reminder_id: int, user_id: int, **fields) -> Reminder | None:
    r = db.scalar(select(Reminder).where(
        Reminder.id == reminder_id, Reminder.user_id == user_id))
    if not r:
        return None
    for k, v in fields.items():
        if v is not None:
            setattr(r, k, v)
    db.commit()
    db.refresh(r)
    return r


def delete_reminder(db: Session, reminder_id: int, user_id: int) -> bool:
    r = db.scalar(select(Reminder).where(
        Reminder.id == reminder_id, Reminder.user_id == user_id))
    if not r:
        return False
    db.delete(r)
    db.commit()
    return True


# --- sticky notes ------------------------------------------------------------
def list_notes(db: Session, user_id: int, matter_id: int | None = None) -> list[StickyNote]:
    stmt = select(StickyNote).where(StickyNote.user_id == user_id)
    if matter_id is not None:
        stmt = stmt.where(StickyNote.matter_id == matter_id)
    return list(db.scalars(
        stmt.order_by(StickyNote.pinned.desc(), StickyNote.updated_at.desc()).limit(_LIST_CAP)
    ))


def create_note(db: Session, user_id: int, body: str, matter_id: int | None = None,
                color: str = "yellow", section_ref: str | None = None,
                source: str | None = None) -> StickyNote:
    n = StickyNote(user_id=user_id, body=body, matter_id=matter_id, color=color,
                   section_ref=section_ref, source=source)
    db.add(n)
    db.commit()
    db.refresh(n)
    return n


def update_note(db: Session, note_id: int, user_id: int, **fields) -> StickyNote | None:
    n = db.scalar(select(StickyNote).where(
        StickyNote.id == note_id, StickyNote.user_id == user_id))
    if not n:
        return None
    for k, v in fields.items():
        if v is not None:
            setattr(n, k, v)
    db.commit()
    db.refresh(n)
    return n


def delete_note(db: Session, note_id: int, user_id: int) -> bool:
    n = db.scalar(select(StickyNote).where(
        StickyNote.id == note_id, StickyNote.user_id == user_id))
    if not n:
        return False
    db.delete(n)
    db.commit()
    return True


# --- personal templates ------------------------------------------------------
def list_templates(db: Session, user_id: int) -> list[WorkspaceTemplate]:
    return list(db.scalars(
        select(WorkspaceTemplate).where(WorkspaceTemplate.user_id == user_id)
        .order_by(WorkspaceTemplate.updated_at.desc()).limit(_LIST_CAP)
    ))


def create_template(db: Session, user_id: int, name: str, body: str,
                    category: str = "other") -> WorkspaceTemplate:
    t = WorkspaceTemplate(user_id=user_id, name=name, body=body, category=category)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


def update_template(db: Session, template_id: int, user_id: int, **fields) -> WorkspaceTemplate | None:
    t = db.scalar(select(WorkspaceTemplate).where(
        WorkspaceTemplate.id == template_id, WorkspaceTemplate.user_id == user_id))
    if not t:
        return None
    for k, v in fields.items():
        if v is not None:
            setattr(t, k, v)
    db.commit()
    db.refresh(t)
    return t


def delete_template(db: Session, template_id: int, user_id: int) -> bool:
    t = db.scalar(select(WorkspaceTemplate).where(
        WorkspaceTemplate.id == template_id, WorkspaceTemplate.user_id == user_id))
    if not t:
        return False
    db.delete(t)
    db.commit()
    return True


# --- watchlists --------------------------------------------------------------
def list_watchlists(db: Session, user_id: int) -> list[Watchlist]:
    return list(db.scalars(
        select(Watchlist).where(Watchlist.user_id == user_id)
        .order_by(Watchlist.updated_at.desc()).limit(_LIST_CAP)
    ))


def create_watchlist(db: Session, user_id: int, label: str, query: str,
                     kind: str = "topic") -> Watchlist:
    w = Watchlist(user_id=user_id, label=label, query=query, kind=kind)
    db.add(w)
    db.commit()
    db.refresh(w)
    return w


def update_watchlist(db: Session, wl_id: int, user_id: int, **fields) -> Watchlist | None:
    w = db.scalar(select(Watchlist).where(Watchlist.id == wl_id, Watchlist.user_id == user_id))
    if not w:
        return None
    for k, v in fields.items():
        if v is not None:
            setattr(w, k, v)
    db.commit()
    db.refresh(w)
    return w


def delete_watchlist(db: Session, wl_id: int, user_id: int) -> bool:
    w = db.scalar(select(Watchlist).where(Watchlist.id == wl_id, Watchlist.user_id == user_id))
    if not w:
        return False
    db.delete(w)
    db.commit()
    return True


# --- collaboration (matter shares) -------------------------------------------
def list_shares(db: Session, matter_id: int, owner_id: int) -> list[dict] | None:
    """The people a matter is shared with. Owner-only — returns None if the
    caller doesn't own the matter."""
    from app.models.org import User
    if not get_matter(db, matter_id, owner_id):
        return None
    rows = list(db.scalars(select(MatterShare).where(MatterShare.matter_id == matter_id)))
    out = []
    for s in rows:
        u = db.get(User, s.shared_with_user_id)
        out.append({"id": s.id, "permission": s.permission,
                    "email": getattr(u, "email", None) if u else None,
                    "name": getattr(u, "full_name", None) if u else None})
    return out


def share_matter(db: Session, matter_id: int, owner_id: int, email: str,
                 permission: str = "view") -> tuple[str, dict | None]:
    """Share a matter with another user by email. Returns (status, share_dict)."""
    from app.models.org import User
    if not get_matter(db, matter_id, owner_id):
        return ("no_matter", None)
    target = db.scalar(select(User).where(User.email == email.strip().lower()))
    if not target:
        return ("no_user", None)
    if target.id == owner_id:
        return ("self", None)
    existing = db.scalar(select(MatterShare).where(
        MatterShare.matter_id == matter_id, MatterShare.shared_with_user_id == target.id))
    if existing:
        return ("exists", None)
    s = MatterShare(matter_id=matter_id, owner_user_id=owner_id,
                    shared_with_user_id=target.id, permission=permission)
    db.add(s)
    db.commit()
    db.refresh(s)
    return ("ok", {"id": s.id, "permission": s.permission,
                   "email": target.email, "name": getattr(target, "full_name", None)})


def unshare(db: Session, share_id: int, owner_id: int) -> bool:
    s = db.scalar(select(MatterShare).where(
        MatterShare.id == share_id, MatterShare.owner_user_id == owner_id))
    if not s:
        return False
    db.delete(s)
    db.commit()
    return True
