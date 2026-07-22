"""Appeal-order drafting routes (BharathTax "Draft Bot"). Officer-scoped; reuses
JWT/seat auth, MinIO storage, PDF extraction, Celery, and corpus-grounded drafting."""
from __future__ import annotations

import json
import logging
import mimetypes
from datetime import datetime, timezone

log = logging.getLogger("appeal")

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import func, select, desc
from sqlalchemy.orm import Session

from app.api.deps import Principal, client_meta, get_principal
from app.services.quota import require_quota
from app.core.db import get_db
from app.models.appeal import AppealCase, AppealDocument, AppealOutput, AppealRun
from app.models.enums import Role
from app.models.org import User
from app.services import audit
from app.services import appeal_draft as svc
from app.services.appeal_export import build_order_docx
from app.services.storage import put_bytes, get_bytes
from app.services import capture
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


def _get_case(db: Session, user: User, cid) -> AppealCase:
    """Look up a case by EITHER opaque slug OR numeric id.

    Every user-facing URL uses the slug — the numeric id path is kept only
    for admin tooling and legacy bookmarks. If the parameter looks like an
    integer (all digits, matches a real primary key) we treat it as an id;
    otherwise we resolve it as a slug.
    """
    case: AppealCase | None = None
    if isinstance(cid, int):
        case = db.get(AppealCase, cid)
    elif isinstance(cid, str):
        s = cid.strip()
        if s.isdigit():
            case = db.get(AppealCase, int(s))
        else:
            case = db.scalar(select(AppealCase).where(AppealCase.slug == s))
    if not case:
        raise HTTPException(404, "Case not found")
    if case.owner_user_id == user.id or user.role == Role.super_admin:
        return case
    if user.role == Role.wing_admin and case.wing_id == user.wing_id:
        return case
    raise HTTPException(status.HTTP_403_FORBIDDEN, "Not authorised for this case")


def _case_out(c: AppealCase) -> dict:
    # `slug` is the ONLY identifier the frontend should route on. `id` is
    # returned too because a few admin views and audit-log calls still need
    # the numeric key, but no user-facing URL should ever surface it.
    return {"id": c.id, "slug": c.slug, "title": c.title,
            "assessment_year": c.assessment_year, "pan": c.pan,
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
    import uuid as _uuid
    # 32-char hex slug (no dashes) — short enough to type / paste, long enough
    # (128 bits of entropy) to make enumeration hopeless.
    slug = _uuid.uuid4().hex
    c = AppealCase(owner_user_id=p.user.id, wing_id=p.user.wing_id, title=body.title,
                   assessment_year=body.assessment_year, pan=body.pan,
                   section=body.section, slug=slug)
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
def get_case(cid: str, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    case = _get_case(db, p.user, cid)
    return {**_case_out(case), "documents": [{"id": d.id, "filename": d.filename, "category": d.category, "pages": d.pages} for d in case.documents]}


@router.patch("/cases/{cid}")
def patch_case(cid: str, body: CasePatch,
               p: Principal = Depends(get_principal),
               db: Session = Depends(get_db), request: Request = None):
    """Update the case's identifying metadata — title / AY / PAN / section.
    Every field is optional; a value of empty-string is treated as "clear
    this field" (so the officer can wipe a wrongly-typed PAN)."""
    case = _get_case(db, p.user, cid)
    changed: list[str] = []
    if body.title is not None:
        title = (body.title or "").strip()
        if not title:
            raise HTTPException(400, "Title cannot be empty")
        if title != case.title:
            case.title = title
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
        if cleaned != getattr(case, attr):
            setattr(case, attr, cleaned)
            changed.append(attr)
    if changed:
        db.commit()
        audit.log_event(db, action="appeal.case.edit", user_id=p.user.id, wing_id=p.user.wing_id,
                        resource_type="appeal_case", resource_id=str(case.id),
                        query_text=",".join(changed), **client_meta(request))
    return {**_case_out(case),
            "documents": [{"id": d.id, "filename": d.filename, "category": d.category, "pages": d.pages}
                          for d in case.documents]}


@router.delete("/cases/{cid}", status_code=204)
def delete_case(cid: str, p: Principal = Depends(get_principal),
                db: Session = Depends(get_db), request: Request = None):
    """Permanently delete a case AND everything hanging off it — every
    uploaded PDF (with its MinIO object), every pipeline run and every
    module output. Owner-only for regular officers; wing admins can delete
    within their wing; super admin can delete anything.

    Any active run is cancelled first so the celery worker doesn't keep
    grinding on rows that are about to disappear.
    """
    case = _get_case(db, p.user, cid)
    case_id_int = case.id  # snapshot before any commit refreshes it away

    # Cancel the latest run if it's still active — otherwise the celery
    # worker could try to write outputs to a run whose parent case row is
    # about to be gone, and blow up mid-transaction.
    active = db.scalar(
        select(AppealRun).where(AppealRun.case_id == case.id)
        .order_by(desc(AppealRun.id)).limit(1)
    )
    if active and active.status in ("queued", "running"):
        _cancel_run(db, active, user_id=p.user.id)

    # Best-effort object-store cleanup for every uploaded PDF on this case.
    for d in list(case.documents):
        if not d.minio_key:
            continue
        try:
            from app.services.storage import remove_object
            remove_object(d.minio_key)
        except Exception as e:
            log.warning("storage delete failed for %s: %s", d.minio_key, e)

    # Re-fetch by numeric id after any intermediate commits from _cancel_run()
    # so the ORM doesn't complain about a stale instance during the cascade
    # delete. (Numeric because we already resolved the slug above.)
    case = db.get(AppealCase, case_id_int)
    if case is None:  # already gone somehow — treat as success
        return None
    # Snapshot the title BEFORE deletion so the audit row can still show a
    # human-readable name once the case is gone.
    case_title = case.title
    db.delete(case)
    db.commit()
    audit.log_event(db, action="appeal.case.delete", user_id=p.user.id, wing_id=p.user.wing_id,
                    resource_type="appeal_case", resource_id=str(case_id_int),
                    query_text=case_title, **client_meta(request))
    return None


# --- documents ---
@router.post("/cases/{cid}/documents")
async def upload_docs(cid: str, files: list[UploadFile] = File(...),
                      p: Principal = Depends(get_principal),
                      _quota: Principal = Depends(require_quota),
                      db: Session = Depends(get_db), request: Request = None):
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
        # SHA-256 the raw bytes BEFORE we upload / extract. This is the key
        # for the dedup lookup below.
        import hashlib as _hashlib
        sha256_hex = _hashlib.sha256(raw).hexdigest()
        key = f"appeal/case_{case.id}/{filename}"
        put_bytes(key, raw, content_type=content_type)
        try:
            text = extract_text(raw, content_type, filename=filename)
        except Exception:
            text = ""
        # Dedup: if ANY prior AppealDocument already extracted this exact
        # PDF (same sha256) and produced usable text, reuse it. Saves the
        # Gemini OCR call for scanned/image PDFs entirely.
        if not text.strip():
            prior = db.scalar(
                select(AppealDocument)
                .where(
                    AppealDocument.sha256 == sha256_hex,
                    func.length(AppealDocument.text) > 100,
                )
                .order_by(desc(AppealDocument.id))
                .limit(1)
            )
            if prior is not None:
                text = prior.text
        pages = text.count("\f") + 1 if ext == ".pdf" and text else 0
        doc = AppealDocument(case_id=case.id, filename=filename,
                             category=svc.classify(filename, text),
                             minio_key=key, text=text, pages=pages,
                             sha256=sha256_hex)
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
def get_doc_file(cid: str, did: int, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    case = _get_case(db, p.user, cid)
    doc = db.get(AppealDocument, did)
    if not doc or doc.case_id != case.id:
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
def update_doc_category(cid: str, did: int, body: _DocCategoryUpdate,
                       p: Principal = Depends(get_principal),
                       db: Session = Depends(get_db)):
    case = _get_case(db, p.user, cid)
    doc = db.get(AppealDocument, did)
    if not doc or doc.case_id != case.id:
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
def delete_doc(cid: str, did: int,
               p: Principal = Depends(get_principal),
               db: Session = Depends(get_db), request: Request = None):
    """Delete a single uploaded PDF from a case, plus its MinIO object.

    Returns the recomputed `missing` category list so the UI can update its
    "missing expected" banner in place without a full case reload.
    """
    case = _get_case(db, p.user, cid)
    doc = db.get(AppealDocument, did)
    if not doc or doc.case_id != case.id:
        raise HTTPException(404, "Not found")
    # Best-effort MinIO cleanup — the DB delete is the source of truth, so
    # a bucket blip must not block the row removal.
    if doc.minio_key:
        try:
            from app.services.storage import remove_object
            remove_object(doc.minio_key)
        except Exception as e:
            log.warning("storage delete failed for %s: %s", doc.minio_key, e)
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
def start_run(cid: str, p: Principal = Depends(get_principal),
              _quota: Principal = Depends(require_quota),
              db: Session = Depends(get_db), request: Request = None):
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
def stop_case(cid: str, p: Principal = Depends(get_principal),
              db: Session = Depends(get_db), request: Request = None):
    """Convenience: cancel whichever run is currently active on this case,
    without the caller needing to know the run id.

    Also RECONCILES a stranded `case.status = 'running'` when the latest run
    is already terminal (typical after a worker crash / broker outage) — the
    UI keeps showing "Running" with a Stop button until the case's own row is
    healed back to match the run.
    """
    from sqlalchemy import update as _sql_update
    case = _get_case(db, p.user, cid)
    run = _latest_run(db, case.id)
    if not run:
        # No runs at all — still heal the case badge if it's somehow stuck.
        db.execute(
            _sql_update(AppealCase)
            .where(AppealCase.id == case.id, AppealCase.status == "running")
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
            .where(AppealCase.id == case.id, AppealCase.status == "running")
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
def latest(cid: str, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    case = _get_case(db, p.user, cid)
    run = _latest_run(db, case.id)
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
    # Gold label: the officer's approved/edited text vs the AI original — the most
    # valuable supervised signal for training an in-house model.
    try:
        capture.log_event("gold_edit", task=f"appeal.edit.{o.kind}",
                          user_id=p.user.id, run_id=o.run_id,
                          context=o.content, response=body.content,
                          meta={"kind": o.kind, "seq": o.seq, "output_id": oid,
                                "new_output_id": nxt.id, "version": nxt.version})
    except Exception:  # noqa: BLE001
        pass
    return _out(nxt)


@router.post("/cases/{cid}/issues/{seq}/regenerate")
def regenerate(cid: str, seq: int, p: Principal = Depends(get_principal),
               _quota: Principal = Depends(require_quota),
               db: Session = Depends(get_db)):
    case = _get_case(db, p.user, cid)
    run = _latest_run(db, case.id)
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
def reassemble(cid: str, p: Principal = Depends(get_principal),
               _quota: Principal = Depends(require_quota),
               db: Session = Depends(get_db)):
    case = _get_case(db, p.user, cid)
    run = _latest_run(db, case.id)
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


class DraftInstruction(BaseModel):
    instruction: str
    # Optional exact excerpt the officer highlighted in the draft. When set
    # (and found in the draft) ONLY this excerpt is rewritten and spliced
    # back in place — a precise "modify selection with AI" edit.
    selection: str | None = None
    # Undo/redo: the draft version the edit should build ON (what the officer is
    # currently viewing). When omitted, we edit the latest version. This lets an
    # edit made after Undo branch from the viewed version rather than the newest.
    base_version: int | None = None


# System prompt used when we can identify the exact section the officer wants
# changed. Only that section (heading + body) is sent to the LLM; the rest of
# the order is untouched. Big latency + cost win vs. sending the whole draft.
_INSTRUCT_SYSTEM_SECTION = (
    "You are an expert AI editor for Indian income-tax appellate orders (CIT(A) / NFAC). "
    "You are given ONE SECTION of a draft order and a natural-language INSTRUCTION from "
    "the reviewing officer. Rewrite ONLY that section to satisfy the instruction.\n"
    "UNDERSTANDING THE INSTRUCTION:\n"
    "- The instruction may be casual, layman or imperfect English (e.g. 'in the next line "
    "put the direction of the AO', 'make this shorter', 'bold the result', 'explain it more', "
    "'fix the grammar', 'add a concluding line', 'simplify'). Work out the officer's INTENT "
    "and apply it. NEVER refuse and NEVER ask a clarifying question — always make your "
    "best-effort edit and output the revised section.\n"
    "- However the instruction is phrased, your OUTPUT must be formal, correct CIT(A) legal "
    "prose.\n"
    "STRICT RULES:\n"
    "- Return the FULL revised section INCLUDING its heading line, and nothing else — no "
    "commentary, acknowledgements or a 'Sure, here is…' preamble.\n"
    "- Preserve the heading text verbatim unless the instruction explicitly asks to rename "
    "it. Preserve numbering, citation markers and any [not on record] tags.\n"
    "- Do NOT fabricate specific FACTS — dates, amounts, party names, jurisdictions, section "
    "numbers or case citations — that are not already supported. You MAY add the structural "
    "or standard content the instruction asks for (e.g. a directions-to-AO line, a heading, "
    "a concluding sentence) phrased in general, non-fabricated terms.\n"
    "- Keep the formal CIT(A) register. Use plain markdown (no code fences); use **bold** "
    "ONLY as balanced pairs — never stray or unbalanced asterisks like ****.\n"
)

# Fallback system prompt when no section could be identified — same as before,
# whole-draft rewrite.
_INSTRUCT_SYSTEM_WHOLE = (
    "You are an expert AI editor for Indian income-tax appellate orders (CIT(A) / NFAC). "
    "You are given the CURRENT DRAFT of an order and a natural-language INSTRUCTION from the "
    "reviewing officer. Rewrite the draft to satisfy the instruction.\n"
    "UNDERSTANDING THE INSTRUCTION:\n"
    "- The instruction may be casual, layman or imperfect English (e.g. 'make it shorter', "
    "'add a line about the AO direction', 'simplify the discussion', 'fix grammar'). Work out "
    "the officer's INTENT and apply it. NEVER refuse and NEVER ask a clarifying question — "
    "always make your best-effort edit. Your OUTPUT must be formal, correct CIT(A) prose "
    "however the instruction was phrased.\n"
    "STRICT RULES:\n"
    "- Return the FULL revised order, not a diff and not a summary of changes. Do not "
    "prepend an acknowledgement (\"Sure, here is…\"). The very first line of your output "
    "must be the first line of the revised order.\n"
    "- Preserve every heading, numbering scheme and citation marker unless the instruction "
    "specifically asks you to change it. Do NOT fabricate specific FACTS (dates, amounts, "
    "party names, jurisdictions, section numbers, case citations) that are not already "
    "supported; you MAY add the structural/standard content the instruction requests, phrased "
    "in general terms.\n"
    "- Keep the formal CIT(A) register. Use plain markdown (##, ###, **bold**, numbered "
    "lists); use **bold** ONLY as balanced pairs — never stray/unbalanced asterisks. No code "
    "fences.\n"
    "- If the instruction is vague, apply the most reasonable interpretation and keep "
    "everything else intact.\n"
)

# Force Flash for interactive edits — the rewrite task doesn't need Pro-tier
# reasoning and Pro is 3-4× slower on typical draft sizes. Officer waits less.
_INSTRUCT_MODEL = "gemini-flash-latest"
# Fallback chain for interactive edits: if the primary flash model is rate-
# limited (429), fall through to another fast model rather than 503-ing the
# officer. Kept Pro-free so edits stay fast.
_INSTRUCT_MODELS = ["gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest"]


_MD_MARKERS = set("*_`#~")


def _normalize_with_map(raw: str):
    """Normalized text (markdown emphasis/heading markers removed, whitespace
    collapsed) + a map from each normalized-char index back to its raw index."""
    norm: list[str] = []
    imap: list[int] = []
    prev_space = False
    for i, ch in enumerate(raw):
        if ch in _MD_MARKERS:
            continue
        if ch.isspace():
            if prev_space:
                continue
            norm.append(" "); imap.append(i); prev_space = True
            continue
        norm.append(ch); imap.append(i); prev_space = False
    return "".join(norm), imap


def _locate_selection(current_text: str, selection: str):
    """Best-effort raw-char span (start, end) in current_text matching the user's
    RENDERED selection, tolerating markdown-formatting differences; None if absent.
    The officer selects rendered text (no ** __ # or list numbers), so an exact
    substring match against the raw markdown frequently misses — we retry on a
    marker-stripped, whitespace-collapsed view and map the hit back to the raw text."""
    sel = (selection or "").strip()
    if len(sel) < 3:
        return None
    i = current_text.find(sel)
    if i >= 0:
        return (i, i + len(sel))
    nraw, imap = _normalize_with_map(current_text)
    nsel = _normalize_with_map(sel)[0].strip()
    if len(nsel) < 3:
        return None
    j = nraw.find(nsel)
    if j < 0:
        return None
    return (imap[j], imap[j + len(nsel) - 1] + 1)


@router.post("/cases/{cid}/draft/instruct")
def instruct_draft(cid: str, body: DraftInstruction,
                   p: Principal = Depends(get_principal),
                   _quota: Principal = Depends(require_quota),
                   db: Session = Depends(get_db)) -> dict:
    """Rewrite the latest draft using Gemini per a user instruction, then
    persist as a new draft version. The next preview / download will render
    the revised text (docx_blob is cleared so it re-renders from markdown)."""
    from app.services import tokens as _tokens
    from app.api.routes.appeal_oo import _extract_text as _docx_to_text

    instruction = (body.instruction or "").strip()
    if not instruction:
        raise HTTPException(400, "instruction must not be empty")
    if len(instruction) > 4000:
        raise HTTPException(400, "instruction too long (max 4000 chars)")

    case = _get_case(db, p.user, cid)
    run = _latest_run(db, case.id)
    if not run:
        raise HTTPException(400, "Run the pipeline first — nothing to edit yet")
    # Undo/redo: build ON the version the officer is viewing (base_version) if given,
    # otherwise the latest. A new edit after Undo therefore branches from what they see.
    draft = None
    if body.base_version is not None:
        draft = db.scalar(select(AppealOutput).where(
            AppealOutput.run_id == run.id, AppealOutput.kind == "draft",
            AppealOutput.version == body.base_version))
    if draft is None:
        draft = _latest_draft_for_case(db, case.id)
    if not draft:
        raise HTTPException(404, "No draft yet — run the pipeline first")

    # Prefer whatever the officer last saved from OnlyOffice (docx_blob) over
    # the markdown snapshot, so edits made in the editor are respected as the
    # starting point for the Gemini rewrite. (When editing a specific base_version
    # we use its markdown content directly.)
    current_text = ""
    if body.base_version is None and draft.docx_blob:
        current_text = _docx_to_text(draft.docx_blob).strip()
    if not current_text:
        current_text = (draft.content or "").strip()
    if not current_text:
        raise HTTPException(422, "Draft is empty; cannot instruct an edit")

    # Try to route the instruction to a single section. If we can, we send
    # only that section to the LLM (much smaller prompt → 3–10× faster) and
    # splice the rewrite back into the full draft. If we can't identify a
    # target confidently, fall back to a whole-draft rewrite.
    from app.services import draft_sections as _sec
    selection = (body.selection or "").strip()
    sel_span = _locate_selection(current_text, selection) if selection else None
    sel_found = sel_span is not None
    sel_excerpt = current_text[sel_span[0]:sel_span[1]] if sel_span else selection
    sections = None
    target_idx = None
    if sel_found:
        user_prompt = (
            f"EXCERPT TO EDIT (verbatim):\n---\n{sel_excerpt}\n---\n\n"
            f"USER INSTRUCTION:\n{instruction}\n\n"
            f"OUTPUT: the revised excerpt only — same coverage, no preamble, no "
            f"surrounding text. Keep it drop-in for where it was taken from."
        )
        system_prompt = _INSTRUCT_SYSTEM_SECTION
        scope = "selection"
    else:
        sections = _sec.split_sections(current_text)
        target_idx = _sec.find_target_section(instruction, sections)

    if sel_found:
        pass
    elif target_idx is not None:
        target = sections[target_idx]
        user_prompt = (
            f"SECTION TO EDIT (verbatim, includes heading line):\n---\n"
            f"{target['body'].strip()}\n---\n\n"
            f"USER INSTRUCTION:\n{instruction}\n\n"
            f"OUTPUT: the full revised section (heading + body)."
        )
        system_prompt = _INSTRUCT_SYSTEM_SECTION
        scope = f"section:{target['title'] or '(preamble)'}"
    else:
        user_prompt = (
            f"CURRENT DRAFT (verbatim):\n---\n{current_text}\n---\n\n"
            f"USER INSTRUCTION:\n{instruction}\n\n"
            f"OUTPUT: the full revised order."
        )
        system_prompt = _INSTRUCT_SYSTEM_WHOLE
        scope = "whole_draft"

    try:
        if getattr(svc, "_GEMINI_KEY", ""):
            primary = svc.GeminiLLM(svc._GEMINI_KEY, _INSTRUCT_MODELS)
            local = svc._local_llm()
            client = svc.FallbackLLM(primary, local) if local else primary
            revised_piece = client.complete(system_prompt, user_prompt)
        else:
            client = svc._appeal_llm()
            revised_piece = client.complete(system_prompt, user_prompt,
                                            model=_INSTRUCT_MODEL)
    except Exception as e:  # noqa: BLE001
        log.warning("draft.instruct upstream failure: %s", e)
        raise HTTPException(
            status_code=503,
            detail={
                "code": "llm_unavailable",
                "message": (
                    "The AI editor is temporarily unavailable. Please try again in "
                    "a minute — if this keeps happening, contact your administrator."
                ),
            },
        ) from e

    revised_piece = (revised_piece or "").strip()
    if not revised_piece:
        raise HTTPException(502, "The AI returned an empty draft — please try rephrasing the instruction")

    # Splice the rewritten section back in, or use it whole if we did a full
    # rewrite. Either way, ``revised`` is the new complete draft.
    if sel_found and sel_span:
        # Splice the rewrite back into the EXACT raw span the selection maps to
        # (tolerant of markdown formatting the officer didn't see when selecting).
        revised = current_text[:sel_span[0]] + revised_piece + current_text[sel_span[1]:]
    elif target_idx is not None:
        revised = _sec.splice(sections, target_idx, revised_piece)
    else:
        revised = revised_piece

    # Character span of the changed region in the NEW draft, so the UI can flash-
    # highlight exactly what the AI touched. revised_piece is inserted verbatim, so
    # we locate it. For a whole-draft rewrite the whole thing changed (span = None).
    change_start = change_end = None
    if scope != "whole_draft":
        pos = revised.find(revised_piece)
        if pos >= 0:
            change_start, change_end = pos, pos + len(revised_piece)

    # New version = max existing + 1 (NOT base+1 — base may be an older version).
    ver = (db.scalar(select(func.max(AppealOutput.version)).where(
        AppealOutput.run_id == run.id, AppealOutput.kind == "draft")) or 0) + 1
    new_row = AppealOutput(
        run_id=run.id,
        kind="draft",
        content=revised,
        version=ver,
        edited=True,
        # Clear docx_blob so the next preview renders freshly from the new
        # markdown. OnlyOffice will re-save its own docx_blob on next open+edit.
        docx_blob=None,
    )
    db.add(new_row)
    db.commit()
    db.refresh(new_row)

    # Book LLM token spend against this officer.
    usage = getattr(client, "last_usage", None)
    _tokens.record(
        db,
        user_id=p.user.id,
        action="appeal.instruct",
        model=getattr(client, "last_model", None),
        usage=usage,
        latency_ms=getattr(client, "last_latency_ms", None),
    )
    audit.log_event(
        db, action="appeal.instruct", user_id=p.user.id, wing_id=p.user.wing_id,
        resource_type="appeal_output", resource_id=str(new_row.id),
        query_text=instruction[:500],
    )
    return {
        "id": new_row.id,
        "version": new_row.version,
        "edited": True,
        "instruction": instruction,
        "scope": scope,
        "chars": len(revised),
        "content": revised,          # the new full draft (UI sets it without a refetch)
        "change_start": change_start,  # char offsets of the AI-touched region, for
        "change_end": change_end,      # flash-highlight; null on a whole-draft rewrite
    }


@router.get("/cases/{cid}/draft-versions")
def draft_versions(cid: str, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    case = _get_case(db, p.user, cid)
    run = _latest_run(db, case.id)
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


@router.post("/cases/{cid}/draft/upload")
async def upload_edited_draft(
    cid: str,
    docx: UploadFile = File(...),
    p: Principal = Depends(get_principal),
    _quota: Principal = Depends(require_quota),
    db: Session = Depends(get_db),
) -> dict:
    """Accept an edited .docx and persist it as the new current draft version.

    Used by the desktop app's "Open in Word" flow: officer opens the draft
    locally, edits it in Word, and the desktop app POSTs the saved file back
    here on every save.  We keep the raw docx blob (so subsequent Downloads
    hand back the officer's formatting verbatim) and also extract a plain-
    text snapshot into `content` for the markdown-based flows (instruct
    edits, PDF preview from markdown when no blob).
    """
    from app.api.routes.appeal_oo import _extract_text as _docx_to_text

    case = _get_case(db, p.user, cid)
    run = _latest_run(db, case.id)
    if not run:
        raise HTTPException(400, "Run the pipeline first — no draft to replace")

    raw = await docx.read()
    if not raw:
        raise HTTPException(400, "Empty upload")
    # Cheap sanity check — .docx files are always zip archives ("PK\x03\x04").
    if raw[:2] != b"PK":
        raise HTTPException(400, "Uploaded file is not a valid .docx")

    text = _docx_to_text(raw) or ""

    prev = db.scalar(
        select(AppealOutput)
        .where(AppealOutput.run_id == run.id, AppealOutput.kind == "draft")
        .order_by(desc(AppealOutput.version))
        .limit(1)
    )
    ver = (prev.version if prev else 0) + 1

    new_row = AppealOutput(
        run_id=run.id,
        kind="draft",
        content=text,
        docx_blob=raw,
        version=ver,
        edited=True,
    )
    db.add(new_row); db.commit(); db.refresh(new_row)

    audit.log_event(
        db, action="appeal.draft.upload",
        user_id=p.user.id, wing_id=p.user.wing_id,
        resource_type="appeal_output", resource_id=str(new_row.id),
    )
    return {
        "id": new_row.id,
        "version": new_row.version,
        "size": len(raw),
        "edited": True,
    }


@router.get("/cases/{cid}/preview.pdf")
async def preview_pdf(cid: str, p: Principal = Depends(get_principal),
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
        await flush_and_wait(db, case.id, timeout_s=6.0)
    except Exception:
        pass
    # `flush_and_wait` may have committed a new draft row via the callback.
    # Refresh the SQLAlchemy view before we read the "latest" draft.
    db.expire_all()
    draft = _latest_draft_for_case(db, case.id)
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
def export_docx(cid: str, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    case = _get_case(db, p.user, cid)
    run = _latest_run(db, case.id)
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
