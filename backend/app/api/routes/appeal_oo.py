"""OnlyOffice Document Server integration for the Module 6 Word-style editor.

Flow:
  1. Frontend asks `GET /appeal/cases/{cid}/oo/config` (auth-required). We mint
     a short-lived BharatTax JWT bound to (cid, user, draft.id) and return the
     OnlyOffice editor config — including a `documentUrl` that points at our
     own `/appeal/oo/doc/{token}` and a `callbackUrl` that points at
     `/appeal/oo/save/{token}`. The config blob is *itself* signed with the
     shared OO_JWT_SECRET so DocumentServer trusts it.
  2. Browser hands the config to `DocsAPI.DocEditor` (loaded from /oo/web-apps/
     apps/api/documents/api.js).
  3. DocumentServer fetches the docx from documentUrl. We verify the BharatTax
     token, stream the latest blob (or freshly-rendered docx if none yet).
  4. When the editor decides to save (user-close, force-save), DocumentServer
     POSTs to callbackUrl with `{status, url, ...}`. We download the new docx
     from `url` (DocumentServer's internal store) and persist it as a new
     AppealOutput row.

DocumentServer's container talks to our api over the docker network at
`http://api:8000/...` so we don't need public DNS for callbacks.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

log = logging.getLogger("appeal.oo")
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.api.deps import Principal, get_principal
from app.core.db import get_db
from app.models.appeal import AppealCase, AppealOutput, AppealRun
from app.models.org import User
from app.services.appeal_export import build_order_docx

router = APIRouter(prefix="/appeal", tags=["appeal-oo"])

_OO_SECRET = os.getenv("OO_JWT_SECRET", "")
# Public base URL the BROWSER uses to load the editor JS / open the editing
# session. nginx forwards /oo/ → documentserver container.
_OO_PUBLIC_BASE = os.getenv("OO_PUBLIC_BASE", "https://bharattax.wenvia.global/oo")
# Internal URL DOCUMENTSERVER uses to call back to our api over the docker
# network.
_API_INTERNAL_BASE = os.getenv("API_INTERNAL_BASE", "http://api:8000")
_DOC_TOKEN_EXP_MIN = 60  # how long the per-session token is valid for

# Session-scoped document-key cache: {cid -> key}. OnlyOffice ties an editing
# session to the key we hand it in oo_config; every callback (save,
# force-save, close) references THAT key. When the callback creates a new
# draft version, the editor's session key must NOT change — otherwise a
# subsequent forcesave/CommandService call targeting the new version's key
# would hit no active session and silently no-op.
#
# We therefore mint the key ONCE at oo_config time (per (cid, latest_version))
# and stash it here, so /oo/forcesave finds the same key.  In-memory is fine
# for a single-container deploy; if we ever scale api horizontally, swap this
# for Redis.
_SESSION_DOC_KEY: dict[int, str] = {}


# -------------------------------------------------------- helpers
def _mint_doc_token(*, cid: int, user_id: int, output_id: int | None) -> str:
    """Short-lived BharatTax JWT used to authorise DocumentServer's fetch /
    callback requests for one editing session."""
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {
            "cid": cid,
            "uid": user_id,
            "oid": output_id,
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(minutes=_DOC_TOKEN_EXP_MIN)).timestamp()),
            "purpose": "oo_doc_access",
        },
        _OO_SECRET or "_unset_",
        algorithm="HS256",
    )


def _decode_doc_token(tok: str) -> dict[str, Any]:
    if not _OO_SECRET:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "OO_JWT_SECRET not configured")
    try:
        claims = jwt.decode(tok, _OO_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"bad token: {e}")
    if claims.get("purpose") != "oo_doc_access":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "bad token purpose")
    return claims


def _get_case_for_user(db: Session, user: User, cid) -> AppealCase:
    """Slug-or-id lookup, mirroring appeal.py::_get_case but without the
    wing-admin / super-admin bypass — OnlyOffice callbacks are strictly
    per-officer."""
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
    if case.owner_user_id != user.id:
        raise HTTPException(403, "Not authorised for this case")
    return case


def _latest_draft(db: Session, cid: int) -> AppealOutput | None:
    run = db.scalar(
        select(AppealRun).where(AppealRun.case_id == cid).order_by(desc(AppealRun.id))
    )
    if not run:
        return None
    return db.scalar(
        select(AppealOutput)
        .where(AppealOutput.run_id == run.id, AppealOutput.kind == "draft")
        .order_by(desc(AppealOutput.version))
        .limit(1)
    )


def _build_docx_for_draft(case: AppealCase, draft: AppealOutput | None) -> bytes:
    """Either return the user's previously-saved docx blob, or render a fresh
    one from the markdown content using the existing builder."""
    if draft and draft.docx_blob:
        return draft.docx_blob
    if not draft:
        # Render an empty title so the editor still opens.
        return build_order_docx(case.title, "", pan=case.pan,
                                assessment_year=case.assessment_year,
                                section=case.section)
    return build_order_docx(case.title, draft.content,
                            pan=case.pan, assessment_year=case.assessment_year,
                            section=case.section)


# -------------------------------------------------------- frontend-facing
class OOConfigOut(BaseModel):
    editor_url: str
    config: dict[str, Any]


class OOForceSaveOut(BaseModel):
    ok: bool
    detail: str | None = None


@router.get("/cases/{cid}/oo/config", response_model=OOConfigOut)
def oo_config(cid: str, p: Principal = Depends(get_principal),
              db: Session = Depends(get_db)) -> OOConfigOut:
    """Hand the frontend the editor's `<script src>` URL + the DocsAPI config
    JSON, with both the BharatTax doc-token and the OnlyOffice JWT already
    embedded."""
    if not _OO_SECRET:
        raise HTTPException(503, "Editor not configured: OO_JWT_SECRET is missing")
    case = _get_case_for_user(db, p.user, cid)
    draft = _latest_draft(db, case.id)
    output_id = draft.id if draft else None

    doc_token = _mint_doc_token(cid=case.id, user_id=p.user.id, output_id=output_id)
    # OnlyOffice cache key — held STABLE for the whole editing session.
    #
    # A brand-new document key forces DocumentServer to drop its cache and
    # refetch the docx (needed the first time we open, or after another user
    # has externally saved). WITHIN a session we must keep the same key
    # across autosaves, otherwise force-save calls hit no active session.
    version = draft.version if draft else 0
    document_key = _document_key(case.id, version)
    prev_key = _SESSION_DOC_KEY.get(case.id)
    if prev_key and prev_key.startswith(f"bt-case-{case.id}-v{version}"):
        # Existing session on the same draft version — reuse its key so any
        # in-flight edits keep landing under the same coauthoring session.
        document_key = prev_key
    else:
        # New session (fresh open or the underlying draft version has moved
        # since the last open) — mint a fresh, unique key.
        import uuid as _uuid
        document_key = f"{document_key}-{_uuid.uuid4().hex[:8]}"
        _SESSION_DOC_KEY[case.id] = document_key
    document_title = f"Draft order — {case.title}.docx"

    # DocumentServer is on the same docker network as `api`; it talks back to
    # api via `http://api:8000`. The browser only needs `editor_url` and the
    # token-wrapped config.
    document_url = f"{_API_INTERNAL_BASE}/appeal/oo/doc/{doc_token}"
    callback_url = f"{_API_INTERNAL_BASE}/appeal/oo/save/{doc_token}"

    editor_config: dict[str, Any] = {
        "document": {
            "fileType": "docx",
            "key": document_key,
            "title": document_title,
            "url": document_url,
            "permissions": {
                "edit": True,
                "download": True,
                "print": True,
                "review": True,
                "comment": True,
            },
        },
        "documentType": "word",
        "editorConfig": {
            "callbackUrl": callback_url,
            "lang": "en",
            "mode": "edit",
            "user": {
                "id": str(p.user.id),
                "name": p.user.full_name or p.user.username,
            },
            "customization": {
                "autosave": True,
                "forcesave": True,
                "compactToolbar": False,
                "feedback": {"visible": False},
                "goback": {"requestClose": True},
            },
        },
        "height": "100%",
        "width": "100%",
    }
    # Sign the whole config so DocumentServer accepts it.
    signed = jwt.encode(editor_config, _OO_SECRET, algorithm="HS256")
    editor_config["token"] = signed

    return OOConfigOut(
        editor_url=f"{_OO_PUBLIC_BASE}/web-apps/apps/api/documents/api.js",
        config=editor_config,
    )


# -------------------------------------------------------- DocumentServer-facing
# -------------------------------------------------------- force-save
_OO_INTERNAL_BASE = os.getenv("OO_INTERNAL_BASE", "http://documentserver")


async def flush_and_wait(db: Session, cid: int, *, timeout_s: float = 6.0) -> bool:
    """Ask DocumentServer to force-save the current editor session for `cid`,
    then wait (up to `timeout_s`) for our own save-callback to land a fresh
    AppealOutput row. Returns True if a new draft version arrived, False if
    we timed out or there was no active editor session to flush.

    Callable from other route handlers (e.g. preview.pdf) that need the very
    latest edits reflected server-side before rendering.
    """
    if not _OO_SECRET:
        return False
    key = _SESSION_DOC_KEY.get(cid)
    if not key:
        return False  # no live editor session — nothing to flush
    # Snapshot the current latest draft id so we can detect the callback
    # writing a new row.
    before = db.scalar(
        select(AppealOutput.id)
        .join(AppealRun, AppealRun.id == AppealOutput.run_id)
        .where(AppealRun.case_id == cid, AppealOutput.kind == "draft")
        .order_by(desc(AppealOutput.id))
        .limit(1)
    ) or 0
    payload = {"c": "forcesave", "key": key}
    signed = jwt.encode({"payload": payload}, _OO_SECRET, algorithm="HS256")
    try:
        async with httpx.AsyncClient(timeout=15.0) as c:
            r = await c.post(
                f"{_OO_INTERNAL_BASE}/coauthoring/CommandService.ashx",
                json={**payload, "token": signed},
                headers={"AuthorizationJwt": f"Bearer {signed}"},
            )
    except httpx.HTTPError:
        return False
    if r.status_code != 200:
        return False
    body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    err = body.get("error")
    # error 0 == queued for save; anything else (4 = no changes, 3 = error…)
    # means no new row will land — return immediately.
    if err != 0:
        return False
    # Poll DB for the callback-created row.
    import asyncio
    deadline = timeout_s
    step = 0.2
    waited = 0.0
    while waited < deadline:
        await asyncio.sleep(step)
        waited += step
        # Fresh transaction view — SQLAlchemy sessions cache reads, so we need
        # to expire between polls.
        db.expire_all()
        cur = db.scalar(
            select(AppealOutput.id)
            .join(AppealRun, AppealRun.id == AppealOutput.run_id)
            .where(AppealRun.case_id == cid, AppealOutput.kind == "draft")
            .order_by(desc(AppealOutput.id))
            .limit(1)
        ) or 0
        if cur > before:
            return True
    return False


@router.post("/cases/{cid}/oo/forcesave", response_model=OOForceSaveOut)
async def oo_forcesave(cid: str, p: Principal = Depends(get_principal),
                       db: Session = Depends(get_db)) -> OOForceSaveOut:
    """Ask DocumentServer to flush any in-flight edits for this case right now.

    DocumentServer's `/coauthoring/CommandService.ashx` (command `forcesave`)
    triggers an immediate save-callback to us — after which the latest docx
    is in the DB and the /preview.pdf endpoint returns the fresh render.

    We wait synchronously for that callback to land (bounded) so the caller
    can render preview immediately after — no client-side race.
    """
    if not _OO_SECRET:
        return OOForceSaveOut(ok=False, detail="OO_JWT_SECRET not set")
    case = _get_case_for_user(db, p.user, cid)
    draft = _latest_draft(db, case.id)
    if not draft:
        return OOForceSaveOut(ok=False, detail="no draft to save")
    if not _SESSION_DOC_KEY.get(case.id):
        return OOForceSaveOut(ok=False, detail="no active editor session")
    landed = await flush_and_wait(db, case.id, timeout_s=6.0)
    return OOForceSaveOut(ok=landed, detail="saved" if landed else "no changes or timed out")


def _document_key(cid: int, version: int) -> str:
    """Deterministic OnlyOffice document key so oo/config and oo/forcesave
    reference the same editing session."""
    return f"bt-case-{cid}-v{version}"


def _rewrite_ds_url(url: str) -> str:
    """Map a DocumentServer-advertised public URL back to its internal docker
    host so the api container can actually reach it.

    DS builds cache URLs like `https://<public-host>/cache/files/data/...`.
    The api container has no egress to the public internet, so we swap the
    scheme+host for `http://documentserver` (the compose service name).
    """
    from urllib.parse import urlparse, urlunparse
    try:
        parsed = urlparse(url)
    except ValueError:
        return url
    if not parsed.netloc:
        # Already relative — nothing to rewrite.
        return url
    internal = urlparse(_OO_INTERNAL_BASE)
    return urlunparse((
        internal.scheme or "http",
        internal.netloc or "documentserver",
        parsed.path,
        parsed.params,
        parsed.query,
        parsed.fragment,
    ))


@router.get("/oo/doc/{token}")
def oo_get_doc(token: str, db: Session = Depends(get_db)) -> Response:
    """Called by DocumentServer to fetch the original docx for editing."""
    claims = _decode_doc_token(token)
    cid = int(claims["cid"])
    case = db.get(AppealCase, cid)
    if not case:
        raise HTTPException(404, "case missing")
    # Defense-in-depth: even with a valid (leaked) token, only serve the draft
    # if the token's user still owns this case.
    if claims.get("uid") is not None and case.owner_user_id != claims.get("uid"):
        raise HTTPException(403, "not authorised for this case")
    draft = _latest_draft(db, case.id)
    data = _build_docx_for_draft(case, draft)
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": 'attachment; filename="draft.docx"'},
    )


class _OOCallbackBody(BaseModel):
    """OnlyOffice's callback payload (subset of fields we actually use).
    Other fields like `actions`, `users`, `history` get ignored.

    `token` is present when DocumentServer signs the callback inline (JWT_IN_BODY
    mode). Keep it here so pydantic doesn't drop it and we can verify."""
    key: str | None = None
    status: int | None = None
    url: str | None = None
    forcesavetype: int | None = None
    token: str | None = None


@router.post("/oo/save/{token}")
async def oo_save(token: str, body: _OOCallbackBody, request: Request,
                  db: Session = Depends(get_db)) -> dict[str, int]:
    """DocumentServer's status-callback. Statuses we care about:

      1 — editing (just a "ping", we ack with {error: 0})
      2 — ready for saving (user closed the doc): download `body.url`, persist
      6 — forcesave triggered (Save button / autosave): same as 2 but doc stays
          open in the editor.
    Anything else (3 = save error, 4 = closed with no changes, 7 = forcesave
    error) just acks.
    """
    if not _OO_SECRET:
        log.error("oo_save: OO_JWT_SECRET is not set")
        return {"error": 1}
    claims = _decode_doc_token(token)
    cid = int(claims["cid"])

    # OnlyOffice signs its callback body when JWT is enabled. Depending on the
    # DocumentServer config it puts the signature into the AuthorizationJwt
    # header (JWT_HEADER) or inline in the JSON body (JWT_IN_BODY). When the
    # header is set the ENTIRE inner claim set is under a `payload` key, so we
    # need to accept both.
    inline_token = body.token
    auth_header = request.headers.get("authorizationjwt") or request.headers.get("Authorization")
    if auth_header and auth_header.lower().startswith("bearer "):
        auth_header = auth_header.split(" ", 1)[1]
    candidate = inline_token or auth_header
    if candidate:
        try:
            jwt.decode(candidate, _OO_SECRET, algorithms=["HS256"])
        except jwt.PyJWTError as e:
            log.warning("oo_save: JWT verify failed for cid=%s: %s", cid, e)
            return {"error": 1}

    log.info(
        "oo_save: cid=%s status=%s url=%s key=%s forcesavetype=%s",
        cid, body.status, bool(body.url), body.key, body.forcesavetype,
    )

    if body.status not in (2, 6):
        # Editing / closed without change / error — nothing to persist.
        return {"error": 0}

    if not body.url:
        log.warning("oo_save: cid=%s status=%s missing body.url", cid, body.status)
        return {"error": 1}

    # DocumentServer advertises its cache URLs using the public host it was
    # told about in oo_config (https://bharattax.wenvia.global/...) — but the
    # api container has no route to the public internet. Rewrite the host to
    # DS's internal docker-network name so we can fetch the saved docx.
    fetch_url = _rewrite_ds_url(body.url)

    # Download the edited docx from DocumentServer's internal store.
    try:
        async with httpx.AsyncClient(timeout=60.0) as c:
            r = await c.get(fetch_url)
            r.raise_for_status()
            new_bytes = r.content
    except httpx.HTTPError as e:
        log.exception("oo_save: cid=%s failed to fetch edited docx from %s: %s",
                      cid, fetch_url, e)
        return {"error": 1}

    case = db.get(AppealCase, cid)
    if not case:
        log.warning("oo_save: cid=%s no such case", cid)
        return {"error": 1}
    # Defense-in-depth: a leaked token must not let anyone overwrite the draft
    # of a case its user no longer owns.
    if claims.get("uid") is not None and case.owner_user_id != claims.get("uid"):
        log.warning("oo_save: cid=%s uid mismatch", cid)
        return {"error": 1}
    draft = _latest_draft(db, case.id)
    if not draft:
        log.warning("oo_save: cid=%s no draft to attach edit to", cid)
        return {"error": 1}

    # Extract a plain-text snapshot from the new docx so the existing
    # markdown-based code paths (preview, download, history) still work.
    text_snapshot = _extract_text(new_bytes) or draft.content

    new = AppealOutput(
        run_id=draft.run_id,
        kind="draft",
        seq=0,
        label=draft.label,
        content=text_snapshot,
        citations=draft.citations,
        edited=True,
        version=(draft.version or 0) + 1,
        docx_blob=new_bytes,
    )
    db.add(new)
    db.commit()
    return {"error": 0}


def _extract_text(docx_bytes: bytes) -> str:
    """Plain-text snapshot of the docx for storage in the existing `content`
    column. Used only for preview / history; the canonical edited document is
    the binary blob."""
    try:
        import io
        from docx import Document as _Doc
        d = _Doc(io.BytesIO(docx_bytes))
        return "\n\n".join(p.text for p in d.paragraphs if p.text.strip())
    except Exception:
        return ""
