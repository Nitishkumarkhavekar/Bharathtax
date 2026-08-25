"""Daily-workspace API: matters (docket), statutory limitation calendar,
reminders. Everything is scoped to the authenticated user.

The limitation calendar is the hero: enter one trigger date on a matter and
:mod:`app.services.limitation` computes every downstream statutory deadline
(section-cited) and seeds reminders.
"""
from __future__ import annotations

from datetime import date, datetime

import re
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

# Constrained enums — invalid values are rejected with a 422 rather than stored.
MatterCategory = Literal["officer", "cita", "drp", "investigation", "ici", "tds", "ca", "other"]
MatterStatus = Literal["open", "in_progress", "awaiting_order", "closed"]
DeadlineStatus = Literal["open", "done", "dismissed"]
NoteColor = Literal["yellow", "blue", "green", "pink", "slate"]
WatchKind = Literal["section", "topic", "assessee"]
ReminderStatus = Literal["pending", "sent", "done", "dismissed"]

_PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")
_AY_RE = re.compile(r"^20\d{2}-\d{2}$")


def _validate_pan(v: str | None) -> str | None:
    if v is None or not v.strip():
        return v
    v = v.strip().upper()
    if not _PAN_RE.match(v):
        raise ValueError("PAN must be like ABCDE1234E")
    return v


def _validate_ay(v: str | None) -> str | None:
    if v is None or not v.strip():
        return v
    v = v.strip()
    if not _AY_RE.match(v):
        raise ValueError("Assessment year must be like 2023-24")
    return v

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
    category: MatterCategory | None = None
    status: MatterStatus | None = None
    notes: str | None = None

    _v_pan = field_validator("pan")(classmethod(lambda cls, v: _validate_pan(v)))
    _v_ay = field_validator("assessment_year")(classmethod(lambda cls, v: _validate_ay(v)))


class MatterPatch(BaseModel):
    title: str | None = None
    pan: str | None = None
    assessment_year: str | None = None
    appeal_no: str | None = None
    category: MatterCategory | None = None
    status: MatterStatus | None = None
    notes: str | None = None

    _v_pan = field_validator("pan")(classmethod(lambda cls, v: _validate_pan(v)))
    _v_ay = field_validator("assessment_year")(classmethod(lambda cls, v: _validate_ay(v)))


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
    status: DeadlineStatus | None = None  # open | done | dismissed
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
    status: ReminderStatus | None = None  # pending | sent | done | dismissed
    notes: str | None = None


class NoteIn(BaseModel):
    body: str
    matter_id: int | None = None
    color: NoteColor | None = None        # yellow | blue | green | pink | slate
    section_ref: str | None = None
    source: str | None = None


class NotePatch(BaseModel):
    body: str | None = None
    color: NoteColor | None = None
    pinned: bool | None = None
    section_ref: str | None = None


class InterestIn(BaseModel):
    section: str = "234A"                 # 234A | 234B | 220(2)
    principal: float
    from_date: date
    to_date: date


class TaxBBEIn(BaseModel):
    income: float


class TemplateIn(BaseModel):
    name: str
    body: str
    category: str | None = None


class TemplatePatch(BaseModel):
    name: str | None = None
    body: str | None = None
    category: str | None = None


class WatchlistIn(BaseModel):
    label: str
    query: str
    kind: WatchKind | None = None


class WatchlistPatch(BaseModel):
    label: str | None = None
    query: str | None = None
    kind: WatchKind | None = None


class ShareIn(BaseModel):
    email: str
    permission: str | None = None


class ReconRow(BaseModel):
    key: str
    name: str | None = None
    amount: float = 0


class ReconcileIn(BaseModel):
    rows_a: list[ReconRow]
    rows_b: list[ReconRow]
    tolerance: float | None = None


class Interest234CIn(BaseModel):
    tax_liability: float
    cum_paid: list[float]


class SlabTaxIn(BaseModel):
    income: float
    regime: str | None = None


class CapitalGainsIn(BaseModel):
    amount: float
    kind: str | None = None


class PenaltyIn(BaseModel):
    kind: Literal["270a_under", "270a_mis", "271aac", "271_1c"]
    base_tax: float
    pct: float | None = None


class TdsIn(BaseModel):
    amount: float
    rate_pct: float
    deduction_due: date            # date the tax was deductible (payment/credit)
    deducted_on: date | None = None
    deposited_on: date | None = None
    statement_due: date | None = None   # TDS-statement filing due date (for 234E)


# ------------------------------------------------------------------ serializers
def _matter_out(m, owned: bool = True) -> dict:
    return {"id": m.id, "title": m.title, "pan": m.pan,
            "assessment_year": m.assessment_year, "appeal_no": m.appeal_no,
            "category": m.category, "status": m.status, "notes": m.notes,
            "owned": owned, "shared": not owned,
            "created_at": m.created_at.isoformat() if m.created_at else None,
            "updated_at": m.updated_at.isoformat() if m.updated_at else None}


def _template_out(t) -> dict:
    return {"id": t.id, "name": t.name, "category": t.category, "body": t.body,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "updated_at": t.updated_at.isoformat() if t.updated_at else None}


def _watchlist_out(w) -> dict:
    return {"id": w.id, "label": w.label, "query": w.query, "kind": w.kind,
            "created_at": w.created_at.isoformat() if w.created_at else None}


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
    uid = p.user.id
    return [_matter_out(m, owned=(m.user_id == uid)) for m in svc.list_matters(db, uid)]


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
    m = svc.readable_matter(db, matter_id, p.user.id)
    if not m:
        raise HTTPException(404, "Not found")
    out = _matter_out(m, owned=(m.user_id == p.user.id))
    out["deadlines"] = [_deadline_out(d) for d in svc.list_deadlines(db, matter_id)]
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


@router.get("/workload")
def workload(p: Principal = Depends(get_principal), db: Session = Depends(get_db)) -> dict:
    """Portfolio dashboard: matters enriched with next deadline + caseload totals."""
    return svc.workload(db, p.user.id)


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
    if body.matter_id is not None and not svc.readable_matter(db, body.matter_id, p.user.id):
        raise HTTPException(404, "Matter not found")
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


# ------------------------------------------------------------------ calculators
@router.post("/calc/interest")
def calc_interest(body: InterestIn, p: Principal = Depends(get_principal)) -> dict:
    """1%-per-month statutory interest (Sec. 234A / 234B / 220(2))."""
    from app.services import calculators
    if body.to_date < body.from_date:
        raise HTTPException(400, "to_date must be on or after from_date")
    return calculators.simple_interest(body.section, body.principal, body.from_date, body.to_date)


@router.post("/calc/115bbe")
def calc_115bbe(body: TaxBBEIn, p: Principal = Depends(get_principal)) -> dict:
    """Tax on unexplained income u/s 115BBE (60% + 25% surcharge + 4% cess)."""
    from app.services import calculators
    return calculators.tax_115bbe(body.income)


# ------------------------------------------------------------------ templates
@router.get("/templates/library")
def template_library(p: Principal = Depends(get_principal)) -> list[dict]:
    """Built-in starter templates (notice responses, applications) users can copy."""
    from app.services import template_library as lib
    return lib.library()


@router.get("/templates")
def list_templates(p: Principal = Depends(get_principal), db: Session = Depends(get_db)) -> list[dict]:
    return [_template_out(t) for t in svc.list_templates(db, p.user.id)]


@router.post("/templates", status_code=201)
def add_template(body: TemplateIn, p: Principal = Depends(get_principal),
                 db: Session = Depends(get_db)) -> dict:
    if not (body.name or "").strip() or not (body.body or "").strip():
        raise HTTPException(400, "name and body are required")
    t = svc.create_template(db, p.user.id, name=body.name.strip(), body=body.body,
                            category=body.category or "other")
    return _template_out(t)


@router.patch("/templates/{template_id}")
def edit_template(template_id: int, body: TemplatePatch,
                  p: Principal = Depends(get_principal), db: Session = Depends(get_db)) -> dict:
    t = svc.update_template(db, template_id, p.user.id, **body.model_dump(exclude_none=True))
    if not t:
        raise HTTPException(404, "Not found")
    return _template_out(t)


@router.delete("/templates/{template_id}", status_code=204)
def remove_template(template_id: int, p: Principal = Depends(get_principal),
                    db: Session = Depends(get_db)) -> None:
    if not svc.delete_template(db, template_id, p.user.id):
        raise HTTPException(404, "Not found")


# ------------------------------------------------------------------ watchlists
@router.get("/watchlists")
def list_watchlists(p: Principal = Depends(get_principal), db: Session = Depends(get_db)) -> list[dict]:
    return [_watchlist_out(w) for w in svc.list_watchlists(db, p.user.id)]


@router.post("/watchlists", status_code=201)
def add_watchlist(body: WatchlistIn, p: Principal = Depends(get_principal),
                  db: Session = Depends(get_db)) -> dict:
    if not (body.label or "").strip() or not (body.query or "").strip():
        raise HTTPException(400, "label and query are required")
    w = svc.create_watchlist(db, p.user.id, label=body.label.strip(),
                             query=body.query.strip(), kind=body.kind or "topic")
    return _watchlist_out(w)


@router.patch("/watchlists/{wl_id}")
def edit_watchlist(wl_id: int, body: WatchlistPatch,
                   p: Principal = Depends(get_principal), db: Session = Depends(get_db)) -> dict:
    w = svc.update_watchlist(db, wl_id, p.user.id, **body.model_dump(exclude_none=True))
    if not w:
        raise HTTPException(404, "Not found")
    return _watchlist_out(w)


@router.delete("/watchlists/{wl_id}", status_code=204)
def remove_watchlist(wl_id: int, p: Principal = Depends(get_principal),
                     db: Session = Depends(get_db)) -> None:
    if not svc.delete_watchlist(db, wl_id, p.user.id):
        raise HTTPException(404, "Not found")


# ------------------------------------------------------------------ collaboration
@router.get("/matters/{matter_id}/shares")
def list_shares(matter_id: int, p: Principal = Depends(get_principal),
                db: Session = Depends(get_db)) -> list[dict]:
    rows = svc.list_shares(db, matter_id, p.user.id)
    if rows is None:
        raise HTTPException(404, "Matter not found")
    return rows


@router.post("/matters/{matter_id}/shares", status_code=201)
def add_share(matter_id: int, body: ShareIn, p: Principal = Depends(get_principal),
              db: Session = Depends(get_db)) -> dict:
    if not (body.email or "").strip():
        raise HTTPException(400, "email is required")
    status_, share = svc.share_matter(db, matter_id, p.user.id, body.email,
                                       permission=body.permission or "view")
    if status_ == "no_matter":
        raise HTTPException(404, "Matter not found")
    if status_ == "no_user":
        raise HTTPException(404, "No BharatTax user with that email")
    if status_ == "self":
        raise HTTPException(400, "You already own this matter")
    if status_ == "exists":
        raise HTTPException(409, "Already shared with that user")
    return share


@router.delete("/shares/{share_id}", status_code=204)
def remove_share(share_id: int, p: Principal = Depends(get_principal),
                 db: Session = Depends(get_db)) -> None:
    if not svc.unshare(db, share_id, p.user.id):
        raise HTTPException(404, "Not found")


# ------------------------------------------------------------------ reconciliation
@router.post("/reconcile")
def do_reconcile(body: ReconcileIn, p: Principal = Depends(get_principal)) -> dict:
    """AIS / 26AS-style reconciliation of two entry sets."""
    from app.services import reconcile as rec
    rows_a = [r.model_dump() for r in body.rows_a]
    rows_b = [r.model_dump() for r in body.rows_b]
    tol = body.tolerance if body.tolerance is not None else 1.0
    return rec.reconcile(rows_a, rows_b, tolerance=tol)


# ------------------------------------------------------------------ more calculators
@router.post("/calc/234c")
def calc_234c(body: Interest234CIn, p: Principal = Depends(get_principal)) -> dict:
    from app.services import calculators
    return calculators.interest_234c(body.tax_liability, body.cum_paid)


@router.post("/calc/slab")
def calc_slab(body: SlabTaxIn, p: Principal = Depends(get_principal)) -> dict:
    from app.services import calculators
    return calculators.slab_tax(body.income, regime=body.regime or "new")


@router.post("/calc/capital-gains")
def calc_capital_gains(body: CapitalGainsIn, p: Principal = Depends(get_principal)) -> dict:
    from app.services import calculators
    return calculators.capital_gains(body.amount, kind=body.kind or "ltcg_equity")


@router.post("/calc/penalty")
def calc_penalty(body: PenaltyIn, p: Principal = Depends(get_principal)) -> dict:
    from app.services import calculators
    return calculators.penalty(body.kind, body.base_tax, body.pct)


@router.post("/calc/tds")
def calc_tds(body: TdsIn, p: Principal = Depends(get_principal)) -> dict:
    """TDS default: the tax, interest u/s 201(1A) and late-filing fee u/s 234E."""
    from app.services import calculators
    return calculators.tds_default(
        body.amount, body.rate_pct, body.deduction_due,
        body.deducted_on, body.deposited_on, body.statement_due,
    )


@router.get("/tds-sections")
def tds_sections(p: Principal = Depends(get_principal)) -> list[dict]:
    """Reference table of common TDS sections, nature of payment and rates."""
    from app.services import calculators
    return [dict(s) for s in calculators.TDS_SECTIONS]
