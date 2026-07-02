"""Appeal-order drafting routes (BharathTax "Draft Bot"). Officer-scoped; reuses
JWT/seat auth, MinIO storage, PDF extraction, Celery, and corpus-grounded drafting."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

log = logging.getLogger("appeal")

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select, desc
from sqlalchemy.orm import Session

from app.api.deps import Principal, client_meta, get_principal
from app.core.db import get_db
from app.models.appeal import AppealCase, AppealDocument, AppealOutput, AppealRun
from app.models.enums import Role
from app.models.org import User
from app.services import audit
from app.services import appeal_draft as svc
from app.services.appeal_export import build_order_docx
from app.services.storage import put_bytes, get_bytes
from app.ingestion.extract import extract_text

router = APIRouter(prefix="/appeal", tags=["appeal"])

ALLOWED_UPLOAD_EXTENSIONS = {".pdf", ".docx", ".txt", ".html", ".htm"}


class CaseCreate(BaseModel):
    title: str
    assessment_year: str | None = None
    pan: str | None = None
    section: str | None = None


class CasePatch(BaseModel):
    """PATCH body — every field optional so partial edits from the UI
    inline-edit dialog don't need to resend the whole case."""
    title: str | None = None
    assessment_year: str | None = None
    pan: str | None = None
    section: str | None = None


class OutputEdit(BaseModel):
    content: str


def _get_case(db: Session, user: User, cid: int) -> AppealCase:
    case = db.get(AppealCase, cid)
    if not case:
        raise HTTPException(404, "Case not found")
    if case.owner_user_id == user.id or user.role == Role.super_admin:
        return case
    if user.role == Role.wing_admin and case.wing_id == user.wing_id:
        return case
    raise HTTPException(status.HTTP_403_FORBIDDEN, "Not authorised for this case")


def _case_out(c: AppealCase) -> dict:
    return {"id": c.id, "title": c.title, "assessment_year": c.assessment_year, "pan": c.pan,
            "section": c.section, "status": c.status, "owner_user_id": c.owner_user_id,
            "created_at": c.created_at.isoformat() if c.created_at else None}


def _latest_run(db: Session, cid: int) -> AppealRun | None:
    return db.scalar(select(AppealRun).where(AppealRun.case_id == cid).order_by(desc(AppealRun.id)).limit(1))


def _run_out(r: AppealRun) -> dict:
    return {"id": r.id, "case_id": r.case_id, "status": r.status, "progress": r.progress,
            "provider": r.provider, "model": r.model, "error": r.error}


def _out(o: AppealOutput) -> dict:
    return {"id": o.id, "kind": o.kind, "seq": o.seq, "label": o.label, "content": o.content,
            "citations": o.citations or [], "edited": o.edited, "version": o.version}


def _latest_outputs(db: Session, run_id: int) -> list[AppealOutput]:
    best: dict[tuple, AppealOutput] = {}
    for o in db.scalars(select(AppealOutput).where(AppealOutput.run_id == run_id)):
        key = (o.kind, o.seq)
        if key not in best or o.version > best[key].version:
            best[key] = o
    return list(best.values())


# --- cases ---
@router.post("/cases")
def create_case(body: CaseCreate, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    c = AppealCase(owner_user_id=p.user.id, wing_id=p.user.wing_id, title=body.title,
                   assessment_year=body.assessment_year, pan=body.pan, section=body.section)
    db.add(c); db.commit(); db.refresh(c)
    return _case_out(c)


@router.get("/cases")
def list_cases(p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    # Heal any cases whose `status = 'running'` badge outlived their actual
    # run — happens when the celery worker dies mid-pipeline before it can
    # flip case.status. This runs on every list load, keyed by the current
    # user's own cases, so the UI never shows a phantom "Running / Stop"
    # button for a case whose latest run is already done or errored.
    from sqlalchemy import text as _sql_text
    try:
        db.execute(_sql_text("""
            UPDATE appeal_cases c
               SET status = CASE
                              WHEN r.status = 'done'  THEN 'ready'
                              WHEN r.status = 'error' THEN 'error'
                              ELSE c.status
                            END
              FROM (
                SELECT DISTINCT ON (case_id) case_id, status
                  FROM appeal_runs
                  ORDER BY case_id, id DESC
              ) r
             WHERE r.case_id = c.id
               AND c.status = 'running'
               AND r.status IN ('done', 'error')
        """))
        db.commit()
    except Exception:
        db.rollback()

    q = select(AppealCase).order_by(desc(AppealCase.updated_at))
    if p.user.role == Role.super_admin:
        pass
    elif p.user.role == Role.wing_admin:
        q = q.where(AppealCase.wing_id == p.user.wing_id)
    else:
        q = q.where(AppealCase.owner_user_id == p.user.id)
    return [_case_out(c) for c in db.scalars(q)]


@router.get("/cases/{cid}")
def get_case(cid: int, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    c = _get_case(db, p.user, cid)
    return {**_case_out(c), "documents": [{"id": d.id, "filename": d.filename, "category": d.category, "pages": d.pages} for d in c.documents]}


@router.patch("/cases/{cid}")
def patch_case(cid: int, body: CasePatch,
               p: Principal = Depends(get_principal),
               db: Session = Depends(get_db), request: Request = None):
    """Update the case's identifying metadata — title / AY / PAN / section.
    Every field is optional; a value of empty-string is treated as "clear
    this field" (so the officer can wipe a wrongly-typed PAN)."""
    c = _get_case(db, p.user, cid)
    changed: list[str] = []
    if body.title is not None:
        title = (body.title or "").strip()
        if not title:
            raise HTTPException(400, "Title cannot be empty")
        if title != c.title:
            c.title = title
            changed.append("title")
    for attr, val in (
        ("assessment_year", body.assessment_year),
        ("pan", body.pan),
        ("section", body.section),
    ):
        if val is None:
            continue
        cleaned = val.strip() or None
        # PAN is always stored uppercase for downstream comparison / audit.
        if attr == "pan" and cleaned:
            cleaned = cleaned.upper()
        if cleaned != getattr(c, attr):
            setattr(c, attr, cleaned)
            changed.append(attr)
    if changed:
        db.commit()
        audit.log_event(db, action="appeal.case.edit", user_id=p.user.id, wing_id=p.user.wing_id,
                        resource_type="appeal_case", resource_id=str(cid),
                        details=",".join(changed), **client_meta(request))
    return {**_case_out(c),
            "documents": [{"id": d.id, "filename": d.filename, "category": d.category, "pages": d.pages}
                          for d in c.documents]}


@router.delete("/cases/{cid}", status_code=204)
def delete_case(cid: int, p: Principal = Depends(get_principal),
                db: Session = Depends(get_db), request: Request = None):
    """Permanently delete a case AND everything hanging off it — every
    uploaded PDF (with its MinIO object), every pipeline run and every
    module output. Owner-only for regular officers; wing admins can delete
    within their wing; super admin can delete anything.

    Any active run is cancelled first so the celery worker doesn't keep
    grinding on rows that are about to disappear.
    """
    c = _get_case(db, p.user, cid)

    # Cancel the latest run if it's still active — otherwise the celery
    # worker could try to write outputs to a run whose parent case row is
    # about to be gone, and blow up mid-transaction.
    active = db.scalar(
        select(AppealRun).where(AppealRun.case_id == cid)
        .order_by(desc(AppealRun.id)).limit(1)
    )
    if active and active.status in ("queued", "running"):
        _cancel_run(db, active, user_id=p.user.id)

    # Best-effort MinIO cleanup for every uploaded PDF on this case.
    for d in list(c.documents):
        if not d.minio_key:
            continue
        try:
            from app.core.config import settings as _settings
            from app.services.storage import get_client
            get_client().remove_object(_settings.minio_bucket_raw, d.minio_key)
        except Exception as e:
            log.warning("MinIO delete failed for %s: %s", d.minio_key, e)

    # Re-fetch after any intermediate commits from _cancel_run() so the ORM
    # doesn't complain about a stale instance during the cascade delete.
    c = db.get(AppealCase, cid)
    if c is None:  # already gone somehow — treat as success
        return None
    # Snapshot the title BEFORE deletion so the audit row can still show a
    # human-readable name once the case is gone.
    case_title = c.title
    db.delete(c)
    db.commit()
    audit.log_event(db, action="appeal.case.delete", user_id=p.user.id, wing_id=p.user.wing_id,
                    resource_type="appeal_case", resource_id=str(cid),
                    query_text=case_title, **client_meta(request))
    return None


# --- documents ---
@router.post("/cases/{cid}/documents")
async def upload_docs(cid: int, files: list[UploadFile] = File(...),
                      p: Principal = Depends(get_principal), db: Session = Depends(get_db), request: Request = None):
    case = _get_case(db, p.user, cid)
    added = []
    skipped = []
    for f in files:
        filename = f.filename or ""
        guessed_type, _ = mimetypes.guess_type(filename)
        ext = ""
        if "." in filename:
            ext = f".{filename.rsplit('.', 1)[1].lower()}"
        if not filename or ext not in ALLOWED_UPLOAD_EXTENSIONS:
            skipped.append(filename or "(unnamed file)")
            continue
        raw = await f.read()
        content_type = f.content_type or guessed_type or "application/octet-stream"
        key = f"appeal/case_{case.id}/{filename}"
        put_bytes(key, raw, content_type=content_type)
        try:
            text = extract_text(raw, content_type, filename=filename)
        except Exception:
            text = ""
        pages = text.count("\f") + 1 if ext == ".pdf" and text else 0
        doc = AppealDocument(case_id=case.id, filename=filename, category=svc.classify(filename, text),
                             minio_key=key, text=text, pages=pages)
        db.add(doc); added.append(doc)
    db.commit()
    present = {d.category for d in case.documents}
    audit.log_event(db, action="appeal.upload", user_id=p.user.id, wing_id=p.user.wing_id,
                    resource_type="appeal_case", resource_id=str(case.id), **client_meta(request))
    return {"documents": [{"id": d.id, "filename": d.filename, "category": d.category, "pages": d.pages} for d in case.documents],
            "missing": [c for c in svc.EXPECTED if c not in present],
            "accepted_types": sorted(ALLOWED_UPLOAD_EXTENSIONS),
            "skipped": skipped}


@router.get("/cases/{cid}/documents/{did}/file")
def get_doc_file(cid: int, did: int, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    _get_case(db, p.user, cid)
    doc = db.get(AppealDocument, did)
    if not doc or doc.case_id != cid:
        raise HTTPException(404, "Not found")
    media_type = mimetypes.guess_type(doc.filename)[0] or "application/octet-stream"
    disposition = "inline" if media_type == "application/pdf" else "attachment"
    return Response(get_bytes(doc.minio_key), media_type=media_type,
                    headers={"Content-Disposition": f'{disposition}; filename="{doc.filename}"'})


# The set of categories the automatic classifier can output. The editor
# dropdown restricts user input to this list (plus "unclassified" default).
DOC_CATEGORIES = [
    "unclassified",
    "form_35",
    "grounds_of_appeal",
    "statement_of_facts",
    "written_submission",
    "remand_report",
    "additional_evidence",
    "demand_notice",
    "penalty_order",
    "assessment_order",
]


class _DocCategoryUpdate(BaseModel):
    category: str


@router.put("/cases/{cid}/documents/{did}")
def update_doc_category(cid: int, did: int, body: _DocCategoryUpdate,
                       p: Principal = Depends(get_principal),
                       db: Session = Depends(get_db)):
    case = _get_case(db, p.user, cid)
    doc = db.get(AppealDocument, did)
    if not doc or doc.case_id != cid:
        raise HTTPException(404, "Not found")
    cat = (body.category or "").strip().lower()
    if cat not in DOC_CATEGORIES:
        raise HTTPException(400, f"Unknown category. Allowed: {', '.join(DOC_CATEGORIES)}")
    doc.category = cat
    db.commit()
    # Compliance recomputed on next fetch — return the fresh doc payload so the
    # UI can update in place without a full reload.
    present = {d.category for d in case.documents}
    return {"id": doc.id, "filename": doc.filename, "category": doc.category,
            "pages": doc.pages,
            "missing": [c for c in svc.EXPECTED if c not in present]}


@router.delete("/cases/{cid}/documents/{did}")
def delete_doc(cid: int, did: int,
               p: Principal = Depends(get_principal),
               db: Session = Depends(get_db), request: Request = None):
    """Delete a single uploaded PDF from a case, plus its MinIO object.

    Returns the recomputed `missing` category list so the UI can update its
    "missing expected" banner in place without a full case reload.
    """
    case = _get_case(db, p.user, cid)
    doc = db.get(AppealDocument, did)
    if not doc or doc.case_id != cid:
        raise HTTPException(404, "Not found")
    # Best-effort MinIO cleanup — the DB delete is the source of truth, so
    # a bucket blip must not block the row removal.
    if doc.minio_key:
        try:
            from app.core.config import settings as _settings
            from app.services.storage import get_client
            get_client().remove_object(_settings.minio_bucket_raw, doc.minio_key)
        except Exception as e:
            log.warning("MinIO delete failed for %s: %s", doc.minio_key, e)
    filename = doc.filename
    db.delete(doc)
    db.commit()
    db.refresh(case)
    audit.log_event(db, action="appeal.doc.delete", user_id=p.user.id, wing_id=p.user.wing_id,
                    resource_type="appeal_document", resource_id=str(did),
                    query_text=filename, **client_meta(request))
    present = {d.category for d in case.documents}
    return {"deleted_id": did, "filename": filename,
            "missing": [c for c in svc.EXPECTED if c not in present]}


# --- run / outputs ---
@router.post("/cases/{cid}/run")
def start_run(cid: int, p: Principal = Depends(get_principal), db: Session = Depends(get_db), request: Request = None):
    case = _get_case(db, p.user, cid)
    if not case.documents:
        raise HTTPException(400, "Upload documents before running")
    run = AppealRun(case_id=case.id, created_by=p.user.id, status="queued")
    db.add(run); db.commit(); db.refresh(run)
    from app.ingestion.tasks import run_appeal_case
    async_result = run_appeal_case.delay(run.id)
    # Persist the celery task id so a subsequent /cancel call can revoke it.
    run.task_id = async_result.id
    db.commit()
    audit.log_event(db, action="appeal.run", user_id=p.user.id, wing_id=p.user.wing_id,
                    resource_type="appeal_case", resource_id=str(case.id), **client_meta(request))
    return _run_out(run)


def _cancel_run(db: Session, run: AppealRun, *, user_id: int) -> None:
    """Mark `run` as cancelled and revoke its celery task if we still have
    the id. Safe to call on a run that's already finished — it just no-ops
    the state transition and skips the revoke.

    The pipeline's own progress() checkpoints re-read run.status from the DB
    on every module boundary, so a status flip to "error" here causes the
    running worker to bail out at the next checkpoint even if the celery
    revoke signal doesn't land.
    """
    if run.status not in ("queued", "running"):
        return  # already terminal
    if run.task_id:
        try:
            from app.ingestion.tasks import celery_app
            celery_app.control.revoke(run.task_id, terminate=True, signal="SIGTERM")
        except Exception:
            # Never let a broker glitch block the DB-side cancel.
            pass
    # Use targeted UPDATE so autoflush of any other stale attributes on the
    # in-memory `run` object can't clobber the flip. The pipeline worker uses
    # the mirror-image targeted UPDATE pattern for the same reason.
    from sqlalchemy import update as _sql_update
    db.execute(
        _sql_update(AppealRun)
        .where(AppealRun.id == run.id)
        .values(
            status="error",
            error=f"Cancelled by user (uid={user_id})",
            finished_at=datetime.now(timezone.utc),
        )
    )
    # Also drop the case's "running" badge back to something sane so the UI
    # doesn't stay stuck on "running" forever.
    db.execute(
        _sql_update(AppealCase)
        .where(AppealCase.id == run.case_id, AppealCase.status == "running")
        .values(status="error")
    )
    db.commit()
    # Keep the in-memory objects (used for the response body) in sync.
    db.expire_all()


@router.post("/runs/{rid}/cancel")
def cancel_run(rid: int, p: Principal = Depends(get_principal),
               db: Session = Depends(get_db), request: Request = None):
    run = db.get(AppealRun, rid)
    if not run:
        raise HTTPException(404, "Run not found")
    _get_case(db, p.user, run.case_id)
    _cancel_run(db, run, user_id=p.user.id)
    audit.log_event(db, action="appeal.run.cancel", user_id=p.user.id, wing_id=p.user.wing_id,
                    resource_type="appeal_run", resource_id=str(rid), **client_meta(request))
    return _run_out(run)


@router.post("/cases/{cid}/stop")
def stop_case(cid: int, p: Principal = Depends(get_principal),
              db: Session = Depends(get_db), request: Request = None):
    """Convenience: cancel whichever run is currently active on this case,
    without the caller needing to know the run id.

    Also RECONCILES a stranded `case.status = 'running'` when the latest run
    is already terminal (typical after a worker crash / broker outage) — the
    UI keeps showing "Running" with a Stop button until the case's own row is
    healed back to match the run.
    """
    from sqlalchemy import update as _sql_update
    _get_case(db, p.user, cid)
    run = _latest_run(db, cid)
    if not run:
        # No runs at all — still heal the case badge if it's somehow stuck.
        db.execute(
            _sql_update(AppealCase)
            .where(AppealCase.id == cid, AppealCase.status == "running")
            .values(status="new")
        )
        db.commit()
        raise HTTPException(404, "No run to stop")
    if run.status not in ("queued", "running"):
        # Latest run is already terminal — nothing to cancel, but the case
        # badge might be stale. Sync it to whatever the run reports so the
        # UI stops advertising a phantom "running" state.
        target = "ready" if run.status == "done" else "error"
        db.execute(
            _sql_update(AppealCase)
            .where(AppealCase.id == cid, AppealCase.status == "running")
            .values(status=target)
        )
        db.commit()
        db.expire_all()
        return _run_out(run)
    _cancel_run(db, run, user_id=p.user.id)
    audit.log_event(db, action="appeal.case.stop", user_id=p.user.id, wing_id=p.user.wing_id,
                    resource_type="appeal_case", resource_id=str(cid), **client_meta(request))
    return _run_out(run)


@router.get("/runs/{rid}")
def get_run(rid: int, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    run = db.get(AppealRun, rid)
    if not run:
        raise HTTPException(404, "Run not found")
    _get_case(db, p.user, run.case_id)
    return _run_out(run)


@router.get("/cases/{cid}/latest")
def latest(cid: int, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    _get_case(db, p.user, cid)
    run = _latest_run(db, cid)
    if not run:
        return {"run": None, "outputs": [], "findings": []}
    outs = _latest_outputs(db, run.id)
    findings = sorted([o for o in outs if o.kind == "finding"], key=lambda o: o.seq)
    return {"run": _run_out(run),
            "outputs": [_out(o) for o in outs if o.kind != "finding"],
            "findings": [_out(o) for o in findings]}


@router.put("/outputs/{oid}")
def edit_output(oid: int, body: OutputEdit, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    o = db.get(AppealOutput, oid)
    if not o:
        raise HTTPException(404, "Output not found")
    _get_case(db, p.user, db.get(AppealRun, o.run_id).case_id)
    nxt = AppealOutput(run_id=o.run_id, kind=o.kind, seq=o.seq, label=o.label,
                       content=body.content, citations=o.citations, edited=True, version=o.version + 1)
    db.add(nxt); db.commit(); db.refresh(nxt)
    return _out(nxt)


@router.post("/cases/{cid}/issues/{seq}/regenerate")
def regenerate(cid: int, seq: int, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    case = _get_case(db, p.user, cid)
    run = _latest_run(db, cid)
    if not run:
        raise HTTPException(400, "Run the pipeline first")
    im = next((o for o in _latest_outputs(db, run.id) if o.kind == "issue_matrix"), None)
    issues = (json.loads(im.content).get("issues") if im else None) or []
    if seq >= len(issues):
        raise HTTPException(404, "Issue not found")
    block, cites = svc.draft_issue(db, case, issues[seq])
    prev = list(db.scalars(select(AppealOutput).where(AppealOutput.run_id == run.id, AppealOutput.kind == "finding", AppealOutput.seq == seq)))
    ver = max([o.version for o in prev], default=0) + 1
    o = AppealOutput(run_id=run.id, kind="finding", seq=seq, label=issues[seq]["issue"], content=block, citations=cites, version=ver)
    db.add(o); db.commit(); db.refresh(o)
    return _out(o)


@router.post("/cases/{cid}/reassemble")
def reassemble(cid: int, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    case = _get_case(db, p.user, cid)
    run = _latest_run(db, cid)
    if not run:
        raise HTTPException(400, "Run the pipeline first")
    outs = _latest_outputs(db, run.id)
    im = next((o for o in outs if o.kind == "issue_matrix"), None)
    understanding = json.loads(im.content) if im else {}
    findings = sorted([o for o in outs if o.kind == "finding"], key=lambda o: o.seq)
    blocks = [f"### Issue: {o.label}\n\n{o.content}" for o in findings]
    draft = svc.assemble(understanding, blocks)
    cur = list(db.scalars(select(AppealOutput).where(AppealOutput.run_id == run.id, AppealOutput.kind == "draft")))
    ver = max([o.version for o in cur], default=0) + 1
    o = AppealOutput(run_id=run.id, kind="draft", content=draft, version=ver)
    db.add(o); db.commit(); db.refresh(o)
    return _out(o)


@router.get("/cases/{cid}/draft-versions")
def draft_versions(cid: int, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    _get_case(db, p.user, cid)
    run = _latest_run(db, cid)
    if not run:
        return []
    rows = db.scalars(select(AppealOutput).where(AppealOutput.run_id == run.id, AppealOutput.kind == "draft").order_by(desc(AppealOutput.version)))
    return [{"id": o.id, "version": o.version, "edited": o.edited, "content": o.content} for o in rows]


def _latest_draft_for_case(db: Session, cid: int) -> AppealOutput | None:
    run = _latest_run(db, cid)
    if not run:
        return None
    return db.scalar(
        select(AppealOutput)
        .where(AppealOutput.run_id == run.id, AppealOutput.kind == "draft")
        .order_by(desc(AppealOutput.version))
        .limit(1)
    )


@router.get("/cases/{cid}/preview.pdf")
async def preview_pdf(cid: int, p: Principal = Depends(get_principal),
                      db: Session = Depends(get_db)):
    """Render the latest draft as a PDF for in-page preview.

    Delegates the rendering to the `previewer` sidecar (LibreOffice headless),
    so the preview is pixel-faithful to what the user gets when they hit
    Download .docx and open it in Word.

    Before rendering, we ask OnlyOffice DocumentServer to flush any in-flight
    edits and we block on our own save-callback landing — so the preview
    reflects the user's very latest keystrokes, not the last autosave.
    """
    import os
    import httpx
    from app.api.routes.appeal_oo import flush_and_wait

    case = _get_case(db, p.user, cid)
    # Best-effort flush of the live editor session. If there is no editor
    # session (user hasn't opened it yet) or DocumentServer doesn't return
    # promptly, we render whatever's already persisted.
    try:
        await flush_and_wait(db, cid, timeout_s=6.0)
    except Exception:
        pass
    # `flush_and_wait` may have committed a new draft row via the callback.
    # Refresh the SQLAlchemy view before we read the "latest" draft.
    db.expire_all()
    draft = _latest_draft_for_case(db, cid)
    if not draft:
        raise HTTPException(404, "No draft yet — run the pipeline first")
    # Prefer the docx blob that the user last saved from OnlyOffice — that's
    # the canonical, edited document. Only fall back to re-rendering from the
    # markdown snapshot when there's no edited blob yet (i.e. first preview
    # right after a fresh pipeline run).
    if draft.docx_blob:
        docx_bytes = draft.docx_blob
    else:
        docx_bytes = build_order_docx(
            case.title,
            draft.content,
            pan=case.pan,
            assessment_year=case.assessment_year,
            section=case.section,
        )
    base = os.getenv("PREVIEWER_URL", "http://previewer:5151")
    try:
        r = httpx.post(f"{base}/convert", content=docx_bytes,
                       headers={"Content-Type": "application/octet-stream"},
                       timeout=120.0)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Preview service unreachable: {e}")
    if r.status_code != 200:
        raise HTTPException(502, f"Preview render failed: {r.text[:200]}")
    return Response(
        content=r.content,
        media_type="application/pdf",
        # Inline so the browser embeds it in the iframe instead of downloading.
        headers={"Content-Disposition": f'inline; filename="case_{cid}_preview.pdf"'},
    )


@router.get("/cases/{cid}/export.docx")
def export_docx(cid: int, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    case = _get_case(db, p.user, cid)
    run = _latest_run(db, cid)
    draft = db.scalar(select(AppealOutput).where(AppealOutput.run_id == run.id, AppealOutput.kind == "draft").order_by(desc(AppealOutput.version)).limit(1)) if run else None
    if not draft:
        raise HTTPException(404, "No draft yet — run the pipeline first")
    # Same rule as preview: hand back the OnlyOffice-edited docx if we have
    # one; otherwise render freshly from the markdown snapshot.
    if draft.docx_blob:
        data = draft.docx_blob
    else:
        data = build_order_docx(
            case.title,
            draft.content,
            pan=case.pan,
            assessment_year=case.assessment_year,
            section=case.section,
        )
    return Response(content=data,
                    media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    headers={"Content-Disposition": f'attachment; filename="draft_order_case_{cid}.docx"'})
