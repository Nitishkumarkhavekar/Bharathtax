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

from app.models.workspace import Deadline, Matter, Reminder
from app.services import limitation

# How far ahead of a statutory deadline to seed the auto-reminder.
_AUTO_REMINDER_LEAD_DAYS = 7


# --- matters -----------------------------------------------------------------
def list_matters(db: Session, user_id: int) -> list[Matter]:
    return list(db.scalars(
        select(Matter).where(Matter.user_id == user_id).order_by(Matter.updated_at.desc())
    ))


def get_matter(db: Session, matter_id: int, user_id: int) -> Matter | None:
    return db.scalar(
        select(Matter).where(Matter.id == matter_id, Matter.user_id == user_id)
    )


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
def list_deadlines(db: Session, matter_id: int, user_id: int) -> list[Deadline]:
    return list(db.scalars(
        select(Deadline)
        .where(Deadline.matter_id == matter_id, Deadline.user_id == user_id)
        .order_by(Deadline.due_date)
    ))


def _seed_reminder(db: Session, dl: Deadline) -> None:
    lead = dl.due_date - timedelta(days=_AUTO_REMINDER_LEAD_DAYS)
    when = max(lead, date.today())
    due_at = datetime.combine(when, time(9, 0), tzinfo=timezone.utc)
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


# --- reminders ---------------------------------------------------------------
def list_reminders(db: Session, user_id: int, pending_only: bool = True) -> list[Reminder]:
    stmt = select(Reminder).where(Reminder.user_id == user_id)
    if pending_only:
        stmt = stmt.where(Reminder.status == "pending")
    return list(db.scalars(stmt.order_by(Reminder.due_at)))


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
