"""Appeal-order drafting routes (BharathTax "Draft Bot"). Officer-scoped; reuses
JWT/seat auth, MinIO storage, PDF extraction, Celery, and corpus-grounded drafting."""
from __future__ import annotations

import json
import mimetypes

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


# --- run / outputs ---
@router.post("/cases/{cid}/run")
def start_run(cid: int, p: Principal = Depends(get_principal), db: Session = Depends(get_db), request: Request = None):
    case = _get_case(db, p.user, cid)
    if not case.documents:
        raise HTTPException(400, "Upload documents before running")
    run = AppealRun(case_id=case.id, created_by=p.user.id, status="queued")
    db.add(run); db.commit(); db.refresh(run)
    from app.ingestion.tasks import run_appeal_case
    run_appeal_case.delay(run.id)
    audit.log_event(db, action="appeal.run", user_id=p.user.id, wing_id=p.user.wing_id,
                    resource_type="appeal_case", resource_id=str(case.id), **client_meta(request))
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


@router.get("/cases/{cid}/export.docx")
def export_docx(cid: int, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    case = _get_case(db, p.user, cid)
    run = _latest_run(db, cid)
    draft = db.scalar(select(AppealOutput).where(AppealOutput.run_id == run.id, AppealOutput.kind == "draft").order_by(desc(AppealOutput.version)).limit(1)) if run else None
    if not draft:
        raise HTTPException(404, "No draft yet — run the pipeline first")
    data = build_order_docx(case.title, draft.content)
    return Response(content=data,
                    media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    headers={"Content-Disposition": f'attachment; filename="draft_order_case_{cid}.docx"'})
