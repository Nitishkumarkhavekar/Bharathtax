"""Document routes — chat file-attachment support only.

The standalone Documents page (list + Q&A) was removed. What remains is
the minimum surface the chat composer needs:
  * POST /documents         — upload a file to attach it to a chat turn
  * GET  /documents/{id}/file — fetch owned bytes for inline preview / download

All access is owner-scoped and audit-logged.
"""
from __future__ import annotations

import logging
import threading

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status

from sqlalchemy.orm import Session

from app.api.deps import Principal, client_meta, get_principal
from app.core.db import SessionLocal, get_db
from app.models.documents import Document
from app.schemas import DocumentOut
from app.services import audit, documents
from app.services.quota import require_quota

router = APIRouter(prefix="/documents", tags=["documents"])
log = logging.getLogger(__name__)

# Mirror the appeal-upload guardrails: bound the accepted types and file size so
# an authenticated user can't OOM a worker or drive unbounded extract/embed cost.
_ALLOWED_EXTENSIONS = {
    ".pdf", ".docx", ".txt", ".html", ".htm",
    # Image screenshots / photos — routed through Gemini vision OCR in
    # extract/__init__.py. Covers phone photos of notices, TDS forms,
    # screenshots of portal pages, etc.
    ".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif", ".bmp", ".gif",
}
_MAX_UPLOAD_BYTES = 30 * 1024 * 1024  # 30 MB (frontend caps per file at 25 MB)


def _owned(db: Session, doc_id: int, user_id: int) -> Document:
    doc = db.get(Document, doc_id)
    if not doc or doc.owner_user_id != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="document not found")
    return doc


def _index_in_background(doc_id: int, raw: bytes) -> None:
    """Run text extraction + chunking + embedding off the request path so
    the /documents POST returns in ~200 ms instead of 5-15 s. The chat
    composer only needs the doc's `id` to attach it; the extract-and-embed
    step completes moments later while the user is still typing their
    question. `_build_attached_context` in ask.py will briefly wait for
    chunks to appear before giving up, so the send flow just works."""
    db = SessionLocal()
    try:
        doc = db.get(Document, doc_id)
        if doc is None:
            return
        documents.index_document(db, doc, raw)
    except Exception:  # noqa: BLE001
        log.exception("background indexing failed for document %s", doc_id)
    finally:
        db.close()


@router.post("", response_model=DocumentOut)
async def upload(request: Request, file: UploadFile = File(...),
                 p: Principal = Depends(get_principal),
                 _quota: Principal = Depends(require_quota),
                 db: Session = Depends(get_db)) -> Document:
    import os as _os
    filename = file.filename or "upload"
    ext = _os.path.splitext(filename)[1].lower()
    if ext not in _ALLOWED_EXTENSIONS:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported file type '{ext or filename}'. "
                   f"Accepted: {', '.join(sorted(_ALLOWED_EXTENSIONS))}")
    raw = await file.read()
    if len(raw) > _MAX_UPLOAD_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File too large ({len(raw) // (1024 * 1024)} MB). "
                   f"Maximum is {_MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")
    doc = documents.create_document(
        db, owner_user_id=p.user.id, wing_id=p.user.wing_id,
        filename=file.filename or "upload", content_type=file.content_type or "", raw=raw,
    )
    # Fire-and-forget indexing so the caller sees the doc row (and its id)
    # immediately. Runs on a daemon thread — safe here because it does its
    # own DB session, doesn't share state with the request, and is bounded
    # by the ML server / MinIO round-trips (i.e. not a runaway loop).
    threading.Thread(
        target=_index_in_background,
        args=(doc.id, raw),
        name=f"doc-index-{doc.id}",
        daemon=True,
    ).start()
    audit.log_event(db, action="doc_upload", user_id=p.user.id, wing_id=p.user.wing_id,
                    resource_type="document", resource_id=str(doc.id), **client_meta(request))
    return doc


@router.get("/{doc_id}/file")
def download_document(doc_id: int, inline: bool = False,
                      p: Principal = Depends(get_principal),
                      db: Session = Depends(get_db)):
    """Serve an owned document's raw bytes back to the caller — used by
    the composer's attachment chip for preview (browser-inline for images
    and PDFs) and download (forced Content-Disposition: attachment for
    everything else). Owner-scoped: any other user gets a 404.

    - `?inline=1` — Content-Disposition: inline (preview in browser tab)
    - default    — Content-Disposition: attachment (Save As dialog)
    """
    from fastapi.responses import Response
    from urllib.parse import quote
    from app.services import storage
    doc = _owned(db, doc_id, p.user.id)
    try:
        data = storage.get_bytes(doc.minio_key)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, detail=f"could not fetch document bytes: {e}") from e
    media = doc.content_type or "application/octet-stream"
    # Force download for anything the browser can't safely inline (e.g.
    # office docs) — even when the client asked for inline. Images and
    # PDFs are the only safe inline targets from an XSS perspective.
    inline_safe = inline and (media.startswith("image/") or media == "application/pdf")
    disp = "inline" if inline_safe else "attachment"
    # RFC 5987 filename* handles Unicode filenames (Kannada / Devanagari).
    ascii_fallback = "".join(c if 32 <= ord(c) < 127 and c not in '"\\' else "_"
                             for c in (doc.filename or "download"))
    fname_star = quote((doc.filename or "download").encode("utf-8"))
    headers = {
        "Content-Disposition":
            f'{disp}; filename="{ascii_fallback}"; filename*=UTF-8\'\'{fname_star}',
        "Cache-Control": "private, no-store",
    }
    return Response(content=data, media_type=media, headers=headers)
