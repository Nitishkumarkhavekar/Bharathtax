"""Daily-workspace API: matters (docket), statutory limitation calendar,
reminders. Everything is scoped to the authenticated user.

The limitation calendar is the hero: enter one trigger date on a matter and
:mod:`app.services.limitation` computes every downstream statutory deadline
(section-cited) and seeds reminders.
"""
from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import Principal, get_principal
from app.core.db import get_db
from app.services import limitation
from app.services import workspace as svc

router = APIRouter(prefix="/workspace", tags=["workspace"])


# ------------------------------------------------------------------ schemas
class MatterIn(BaseModel):
    title: str
    pan: str | None = None
    assessment_year: str | None = None
    appeal_no: str | None = None
    category: str | None = None
    status: str | None = None
    notes: str | None = None


class MatterPatch(BaseModel):
    title: str | None = None
    pan: str | None = None
    assessment_year: str | None = None
    appeal_no: str | None = None
    category: str | None = None
    status: str | None = None
    notes: str | None = None


class ComputeIn(BaseModel):
    trigger_event: str
    trigger_date: date


class DeadlineIn(BaseModel):
    label: str
    due_date: date
    section_ref: str | None = None
    notes: str | None = None
    remind: bool = True


class DeadlinePatch(BaseModel):
    label: str | None = None
    due_date: date | None = None
    status: str | None = None            # open | done | dismissed
    notes: str | None = None


class ReminderIn(BaseModel):
    title: str
    due_at: datetime
    matter_id: int | None = None
    channels: list[str] | None = None
    notes: str | None = None


class ReminderPatch(BaseModel):
    title: str | None = None
    due_at: datetime | None = None
    status: str | None = None            # pending | sent | done | dismissed
    notes: str | None = None


class NoteIn(BaseModel):
    body: str
    matter_id: int | None = None
    color: str | None = None             # yellow | blue | green | pink | slate
    section_ref: str | None = None
    source: str | None = None


class NotePatch(BaseModel):
    body: str | None = None
    color: str | None = None
    pinned: bool | None = None
    section_ref: str | None = None


# ------------------------------------------------------------------ serializers
def _matter_out(m) -> dict:
    return {"id": m.id, "title": m.title, "pan": m.pan,
            "assessment_year": m.assessment_year, "appeal_no": m.appeal_no,
            "category": m.category, "status": m.status, "notes": m.notes,
            "created_at": m.created_at.isoformat() if m.created_at else None,
            "updated_at": m.updated_at.isoformat() if m.updated_at else None}


def _deadline_out(d) -> dict:
    return {"id": d.id, "matter_id": d.matter_id, "kind": d.kind, "label": d.label,
            "section_ref": d.section_ref, "trigger_event": d.trigger_event,
            "trigger_date": d.trigger_date.isoformat() if d.trigger_date else None,
            "due_date": d.due_date.isoformat(), "is_auto": d.is_auto,
            "status": d.status, "notes": d.notes}


def _reminder_out(r) -> dict:
    return {"id": r.id, "matter_id": r.matter_id, "deadline_id": r.deadline_id,
            "title": r.title, "due_at": r.due_at.isoformat() if r.due_at else None,
            "channels": r.channels or [], "status": r.status, "notes": r.notes}


def _note_out(n) -> dict:
    return {"id": n.id, "matter_id": n.matter_id, "body": n.body, "color": n.color,
            "section_ref": n.section_ref, "source": n.source, "pinned": n.pinned,
            "created_at": n.created_at.isoformat() if n.created_at else None,
            "updated_at": n.updated_at.isoformat() if n.updated_at else None}


# ------------------------------------------------------------------ catalogue
@router.get("/limitation-rules")
def limitation_rules() -> dict:
    """The trigger + rule catalogue, so the UI can offer trigger options."""
    return limitation.rule_catalogue()


# ------------------------------------------------------------------ matters
@router.get("/matters")
def list_matters(p: Principal = Depends(get_principal), db: Session = Depends(get_db)) -> list[dict]:
    return [_matter_out(m) for m in svc.list_matters(db, p.user.id)]


@router.post("/matters", status_code=201)
def create_matter(body: MatterIn, p: Principal = Depends(get_principal),
                  db: Session = Depends(get_db)) -> dict:
    if not (body.title or "").strip():
        raise HTTPException(400, "title is required")
    m = svc.create_matter(db, p.user.id, **body.model_dump(exclude_none=True))
    return _matter_out(m)


@router.get("/matters/{matter_id}")
def get_matter(matter_id: int, p: Principal = Depends(get_principal),
               db: Session = Depends(get_db)) -> dict:
    m = svc.get_matter(db, matter_id, p.user.id)
    if not m:
        raise HTTPException(404, "Not found")
    out = _matter_out(m)
    out["deadlines"] = [_deadline_out(d) for d in svc.list_deadlines(db, matter_id, p.user.id)]
    return out


@router.patch("/matters/{matter_id}")
def update_matter(matter_id: int, body: MatterPatch,
                  p: Principal = Depends(get_principal), db: Session = Depends(get_db)) -> dict:
    m = svc.update_matter(db, matter_id, p.user.id, **body.model_dump(exclude_none=True))
    if not m:
        raise HTTPException(404, "Not found")
    return _matter_out(m)


@router.delete("/matters/{matter_id}", status_code=204)
def delete_matter(matter_id: int, p: Principal = Depends(get_principal),
                  db: Session = Depends(get_db)) -> None:
    if not svc.delete_matter(db, matter_id, p.user.id):
        raise HTTPException(404, "Not found")


# ------------------------------------------------------------------ deadlines
@router.post("/matters/{matter_id}/deadlines/compute")
def compute_deadlines(matter_id: int, body: ComputeIn,
                      p: Principal = Depends(get_principal), db: Session = Depends(get_db)) -> dict:
    if body.trigger_event not in limitation.TRIGGERS:
        raise HTTPException(400, f"unknown trigger_event '{body.trigger_event}'")
    if not svc.get_matter(db, matter_id, p.user.id):
        raise HTTPException(404, "Matter not found")
    created = svc.compute_and_store(db, matter_id, p.user.id,
                                    body.trigger_event, body.trigger_date)
    return {"created": [_deadline_out(d) for d in created]}


@router.post("/matters/{matter_id}/deadlines", status_code=201)
def add_deadline(matter_id: int, body: DeadlineIn,
                 p: Principal = Depends(get_principal), db: Session = Depends(get_db)) -> dict:
    dl = svc.add_manual_deadline(db, matter_id, p.user.id, label=body.label,
                                 due_date=body.due_date, section_ref=body.section_ref,
                                 notes=body.notes, remind=body.remind)
    if not dl:
        raise HTTPException(404, "Matter not found")
    return _deadline_out(dl)


@router.patch("/deadlines/{deadline_id}")
def update_deadline(deadline_id: int, body: DeadlinePatch,
                    p: Principal = Depends(get_principal), db: Session = Depends(get_db)) -> dict:
    dl = svc.update_deadline(db, deadline_id, p.user.id, **body.model_dump(exclude_none=True))
    if not dl:
        raise HTTPException(404, "Not found")
    return _deadline_out(dl)


@router.delete("/deadlines/{deadline_id}", status_code=204)
def delete_deadline(deadline_id: int, p: Principal = Depends(get_principal),
                    db: Session = Depends(get_db)) -> None:
    if not svc.delete_deadline(db, deadline_id, p.user.id):
        raise HTTPException(404, "Not found")


# ------------------------------------------------------------------ calendar
@router.get("/calendar")
def calendar(start: date, end: date, include_done: bool = False,
             p: Principal = Depends(get_principal), db: Session = Depends(get_db)) -> list[dict]:
    if end < start:
        raise HTTPException(400, "end must be on or after start")
    return [_deadline_out(d) for d in svc.calendar(db, p.user.id, start, end, include_done)]


# ------------------------------------------------------------------ reminders
@router.get("/reminders")
def list_reminders(pending_only: bool = True,
                   p: Principal = Depends(get_principal), db: Session = Depends(get_db)) -> list[dict]:
    return [_reminder_out(r) for r in svc.list_reminders(db, p.user.id, pending_only)]


@router.get("/reminders/due")
def due_reminders(p: Principal = Depends(get_principal), db: Session = Depends(get_db)) -> list[dict]:
    return [_reminder_out(r) for r in svc.due_reminders(db, p.user.id)]


@router.post("/reminders", status_code=201)
def create_reminder(body: ReminderIn, p: Principal = Depends(get_principal),
                    db: Session = Depends(get_db)) -> dict:
    if not (body.title or "").strip():
        raise HTTPException(400, "title is required")
    r = svc.create_reminder(db, p.user.id, title=body.title, due_at=body.due_at,
                            matter_id=body.matter_id, channels=body.channels, notes=body.notes)
    return _reminder_out(r)


@router.patch("/reminders/{reminder_id}")
def update_reminder(reminder_id: int, body: ReminderPatch,
                    p: Principal = Depends(get_principal), db: Session = Depends(get_db)) -> dict:
    r = svc.update_reminder(db, reminder_id, p.user.id, **body.model_dump(exclude_none=True))
    if not r:
        raise HTTPException(404, "Not found")
    return _reminder_out(r)


@router.delete("/reminders/{reminder_id}", status_code=204)
def delete_reminder(reminder_id: int, p: Principal = Depends(get_principal),
                    db: Session = Depends(get_db)) -> None:
    if not svc.delete_reminder(db, reminder_id, p.user.id):
        raise HTTPException(404, "Not found")


# ------------------------------------------------------------------ sticky notes
@router.get("/notes")
def list_notes(matter_id: int | None = None,
               p: Principal = Depends(get_principal), db: Session = Depends(get_db)) -> list[dict]:
    return [_note_out(n) for n in svc.list_notes(db, p.user.id, matter_id)]


@router.post("/notes", status_code=201)
def add_note(body: NoteIn, p: Principal = Depends(get_principal),
             db: Session = Depends(get_db)) -> dict:
    text = (body.body or "").strip()
    if not text:
        raise HTTPException(400, "body is required")
    n = svc.create_note(db, p.user.id, body=text, matter_id=body.matter_id,
                        color=body.color or "yellow", section_ref=body.section_ref,
                        source=body.source)
    return _note_out(n)


@router.patch("/notes/{note_id}")
def edit_note(note_id: int, body: NotePatch, p: Principal = Depends(get_principal),
              db: Session = Depends(get_db)) -> dict:
    n = svc.update_note(db, note_id, p.user.id, **body.model_dump(exclude_none=True))
    if not n:
        raise HTTPException(404, "Not found")
    return _note_out(n)


@router.delete("/notes/{note_id}", status_code=204)
def remove_note(note_id: int, p: Principal = Depends(get_principal),
                db: Session = Depends(get_db)) -> None:
    if not svc.delete_note(db, note_id, p.user.id):
        raise HTTPException(404, "Not found")
