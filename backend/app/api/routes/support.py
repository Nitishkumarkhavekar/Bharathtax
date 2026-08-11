"""Support conversations — officer side.

Officers open Report-Issue tickets from the desktop app, admins reply
through the web admin panel.  All endpoints here are scoped to the caller;
they can only see tickets they created.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from app.api.deps import Principal, get_principal
from app.core.db import get_db
from app.models.enums import Role
from app.models.org import User
from app.models.support import SupportAttachment, SupportMessage, SupportTicket
from app.services import storage

router = APIRouter(prefix="/support", tags=["support"])
log = logging.getLogger(__name__)

# Screenshots and short screen recordings are supported. Images cap at 10 MB,
# videos at 100 MB -- above that officers should file a call rather than a
# ticket. Everything else (archives, executables, PDFs) is rejected.
_ALLOWED_IMAGE_MIME = {"image/png", "image/jpeg", "image/gif", "image/webp", "image/heic", "image/bmp"}
_ALLOWED_VIDEO_MIME = {"video/mp4", "video/webm", "video/quicktime", "video/x-matroska"}
_ALLOWED_MIME = _ALLOWED_IMAGE_MIME | _ALLOWED_VIDEO_MIME
_MAX_IMAGE_BYTES = 10 * 1024 * 1024
_MAX_VIDEO_BYTES = 100 * 1024 * 1024
_MAX_ATTACHMENTS_PER_MESSAGE = 6


def _human_mb(n: int) -> str:
    return f"{n / (1024*1024):.0f} MB"


def _safe_filename(name: str) -> str:
    n = re.sub(r"[^\w.\-() ]", "_", (name or "attachment"))[:200]
    return n or "attachment"


def _att_out(a: SupportAttachment) -> dict:
    return {
        "id": a.id,
        "filename": a.filename,
        "mime_type": a.mime_type,
        "size_bytes": a.size_bytes,
        "download_url": f"/support/attachments/{a.id}",
    }


# ---------- schemas ----------
class TicketCreate(BaseModel):
    subject: str = Field(min_length=3, max_length=200)
    body: str = Field(min_length=1, max_length=8000)
    client_version: str | None = Field(default=None, max_length=20)


class MessageCreate(BaseModel):
    body: str = Field(min_length=1, max_length=8000)


def _msg_out(m: SupportMessage) -> dict:
    return {
        "id": m.id,
        "sender_role": m.sender_role,
        "sender_user_id": m.sender_user_id,
        "body": m.body,
        "created_at": m.created_at.isoformat() if m.created_at else None,
        "attachments": [_att_out(a) for a in (m.attachments or [])],
    }


def _store_attachments(m: SupportMessage, files: list[UploadFile] | None,
                       db: Session) -> None:
    """Validate + upload attached files to R2 and persist rows."""
    if not files: return
    if len(files) > _MAX_ATTACHMENTS_PER_MESSAGE:
        raise HTTPException(400, f"Attach at most {_MAX_ATTACHMENTS_PER_MESSAGE} files per message.")
    for f in files:
        # Some multipart clients send an empty "file" part when the officer
        # picked no files — skip silently.
        if not f or not f.filename: continue
        mt = (f.content_type or "").lower()
        if mt not in _ALLOWED_MIME:
            raise HTTPException(
                400,
                f"Unsupported file type: {mt or 'unknown'}. "
                "Attach screenshots (PNG/JPEG/GIF/WEBP/HEIC/BMP) or short "
                "screen recordings (MP4/WEBM/MOV/MKV).",
            )
        raw = f.file.read()
        if not raw: continue
        cap = _MAX_VIDEO_BYTES if mt in _ALLOWED_VIDEO_MIME else _MAX_IMAGE_BYTES
        if len(raw) > cap:
            raise HTTPException(
                400,
                f"'{f.filename}' is larger than {_human_mb(cap)}. Please "
                "shrink it (or trim the recording) and try again.",
            )
        safe = _safe_filename(f.filename)
        r2_key = f"support/{m.ticket_id}/{m.id}/{safe}"
        try:
            storage.put_bytes(r2_key, raw, content_type=mt)
        except Exception as exc:  # noqa: BLE001
            log.warning("R2 support upload failed for msg=%s: %s", m.id, exc)
            raise HTTPException(502, "Could not store the attachment. Please try again.")
        att = SupportAttachment(
            message_id=m.id, filename=safe, mime_type=mt,
            size_bytes=len(raw), r2_key=r2_key,
        )
        db.add(att)


def _ticket_out(t: SupportTicket, viewer_role: str, unread: int = 0) -> dict:
    return {
        "id": t.id,
        "officer_user_id": t.officer_user_id,
        "subject": t.subject,
        "status": t.status,
        "client_version": t.client_version,
        "last_message_at": t.last_message_at.isoformat() if t.last_message_at else None,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "unread": unread,
        "viewer_role": viewer_role,
    }


def _unread_for(db: Session, t: SupportTicket, viewer: str) -> int:
    """Count messages the viewer hasn't yet read.

    Messages from the viewer themselves never count as unread.
    """
    last = t.officer_last_read_at if viewer == "officer" else t.admin_last_read_at
    q = select(func.count(SupportMessage.id)).where(SupportMessage.ticket_id == t.id)
    if last is not None:
        q = q.where(SupportMessage.created_at > last)
    # Only messages from the OTHER party
    q = q.where(SupportMessage.sender_role != viewer)
    return int(db.execute(q).scalar() or 0)


# ---------- endpoints ----------
@router.get("/tickets")
def list_my_tickets(p: Principal = Depends(get_principal),
                    db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(
        select(SupportTicket)
        .where(SupportTicket.officer_user_id == p.user.id)
        .order_by(desc(SupportTicket.last_message_at))
    ).all()
    return [_ticket_out(t, "officer", _unread_for(db, t, "officer")) for t in rows]


@router.post("/tickets", status_code=201)
async def create_ticket(
    subject: str = Form(...),
    body: str = Form(...),
    client_version: str | None = Form(None),
    files: list[UploadFile] = File(default=[]),
    p: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
) -> dict:
    subject = (subject or "").strip()
    if len(subject) < 3:
        raise HTTPException(400, "Subject must be at least 3 characters.")
    body = (body or "").strip()
    if not body and not files:
        raise HTTPException(400, "Either a message body or an attachment is required.")
    t = SupportTicket(
        officer_user_id=p.user.id,
        subject=subject[:200],
        client_version=client_version,
        status="open",
        officer_last_read_at=datetime.now(timezone.utc),
    )
    db.add(t); db.flush()
    m = SupportMessage(
        ticket_id=t.id, sender_user_id=p.user.id, sender_role="officer",
        body=body,
    )
    db.add(m); db.flush()
    _store_attachments(m, files, db)
    t.last_message_at = m.created_at
    db.commit(); db.refresh(t)
    return {**_ticket_out(t, "officer"), "messages": [_msg_out(x) for x in t.messages]}


@router.get("/tickets/{ticket_id}")
def get_ticket(ticket_id: int, p: Principal = Depends(get_principal),
               db: Session = Depends(get_db)) -> dict:
    t = db.get(SupportTicket, ticket_id)
    if not t or t.officer_user_id != p.user.id:
        raise HTTPException(404, "Ticket not found")
    # Mark all messages as read for the officer.
    t.officer_last_read_at = datetime.now(timezone.utc)
    db.commit()
    msgs = db.scalars(
        select(SupportMessage).where(SupportMessage.ticket_id == t.id)
        .order_by(SupportMessage.id)
    ).all()
    return {**_ticket_out(t, "officer"), "messages": [_msg_out(m) for m in msgs]}


@router.post("/tickets/{ticket_id}/messages")
async def add_message(
    ticket_id: int,
    body: str = Form(""),
    files: list[UploadFile] = File(default=[]),
    p: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
) -> dict:
    t = db.get(SupportTicket, ticket_id)
    if not t or t.officer_user_id != p.user.id:
        raise HTTPException(404, "Ticket not found")
    if t.status == "closed":
        raise HTTPException(409, "This ticket is closed. Open a new one to continue.")
    body = (body or "").strip()
    if not body and not files:
        raise HTTPException(400, "Either a message body or an attachment is required.")
    m = SupportMessage(
        ticket_id=t.id, sender_user_id=p.user.id, sender_role="officer",
        body=body,
    )
    db.add(m); db.flush()
    _store_attachments(m, files, db)
    t.last_message_at = m.created_at
    t.officer_last_read_at = m.created_at
    db.commit(); db.refresh(m)
    return _msg_out(m)


@router.get("/attachments/{attachment_id}")
def get_attachment(attachment_id: int,
                   p: Principal = Depends(get_principal),
                   db: Session = Depends(get_db)) -> Response:
    """Stream an attachment back to the caller if they own the ticket or are
    an admin.  Kept behind auth to avoid handing R2 credentials to the
    browser."""
    a = db.get(SupportAttachment, attachment_id)
    if not a:
        raise HTTPException(404, "Attachment not found")
    m = db.get(SupportMessage, a.message_id)
    t = db.get(SupportTicket, m.ticket_id) if m else None
    if not t:
        raise HTTPException(404, "Attachment orphaned")
    is_admin = p.user.role in (Role.super_admin, Role.wing_admin)
    if not is_admin and t.officer_user_id != p.user.id:
        raise HTTPException(403, "Not authorised for this attachment")
    try:
        data = storage.get_bytes(a.r2_key)
    except Exception as exc:  # noqa: BLE001
        log.warning("R2 fetch failed for %s: %s", a.r2_key, exc)
        raise HTTPException(502, "Could not fetch the attachment")
    # inline disposition lets the browser <img> / <video> tags render it;
    # the filename hint helps the Save-As dialog if the user chooses to
    # download it explicitly.
    return Response(
        content=data,
        media_type=a.mime_type,
        headers={
            "Cache-Control": "private, max-age=3600",
            "Content-Disposition": f'inline; filename="{a.filename}"',
            "Accept-Ranges": "bytes",
        },
    )


@router.get("/unread-count")
def unread_count(p: Principal = Depends(get_principal),
                 db: Session = Depends(get_db)) -> dict:
    """How many admin messages the officer hasn't read across all tickets."""
    rows = db.scalars(
        select(SupportTicket).where(SupportTicket.officer_user_id == p.user.id)
    ).all()
    total = 0
    for t in rows:
        total += _unread_for(db, t, "officer")
    return {"unread": total}


# =============== Admin side ================
admin_router = APIRouter(prefix="/admin/support", tags=["admin", "support"])


def _admin(user: User = Depends(lambda p=Depends(get_principal): p.user)) -> User:
    if user.role not in (Role.super_admin, Role.wing_admin):
        raise HTTPException(403, "Admin access required")
    return user


@admin_router.get("/tickets")
def admin_list_tickets(status: str | None = None,
                       admin: User = Depends(_admin),
                       db: Session = Depends(get_db)) -> list[dict]:
    q = select(SupportTicket).order_by(desc(SupportTicket.last_message_at))
    if status in ("open", "closed"):
        q = q.where(SupportTicket.status == status)
    # Wing-admin only sees officers in their wing.
    if admin.role == Role.wing_admin:
        q = q.join(User, User.id == SupportTicket.officer_user_id).where(User.wing_id == admin.wing_id)
    out = []
    for t in db.scalars(q).all():
        officer = db.get(User, t.officer_user_id)
        out.append({
            **_ticket_out(t, "admin", _unread_for(db, t, "admin")),
            "officer": {
                "id": officer.id if officer else None,
                "username": officer.username if officer else None,
                "full_name": officer.full_name if officer else None,
                "email": officer.email if officer else None,
            } if officer else None,
        })
    return out


@admin_router.get("/tickets/{ticket_id}")
def admin_get_ticket(ticket_id: int,
                     admin: User = Depends(_admin),
                     db: Session = Depends(get_db)) -> dict:
    t = db.get(SupportTicket, ticket_id)
    if not t:
        raise HTTPException(404, "Ticket not found")
    officer = db.get(User, t.officer_user_id)
    if admin.role == Role.wing_admin and officer and officer.wing_id != admin.wing_id:
        raise HTTPException(403, "Not in your wing")
    t.admin_last_read_at = datetime.now(timezone.utc)
    db.commit()
    msgs = db.scalars(
        select(SupportMessage).where(SupportMessage.ticket_id == t.id)
        .order_by(SupportMessage.id)
    ).all()
    return {
        **_ticket_out(t, "admin"),
        "officer": {
            "id": officer.id if officer else None,
            "username": officer.username if officer else None,
            "full_name": officer.full_name if officer else None,
            "email": officer.email if officer else None,
        } if officer else None,
        "messages": [_msg_out(m) for m in msgs],
    }


@admin_router.post("/tickets/{ticket_id}/messages")
async def admin_add_message(
    ticket_id: int,
    body: str = Form(""),
    files: list[UploadFile] = File(default=[]),
    admin: User = Depends(_admin),
    db: Session = Depends(get_db),
) -> dict:
    t = db.get(SupportTicket, ticket_id)
    if not t:
        raise HTTPException(404, "Ticket not found")
    officer = db.get(User, t.officer_user_id)
    if admin.role == Role.wing_admin and officer and officer.wing_id != admin.wing_id:
        raise HTTPException(403, "Not in your wing")
    if t.status == "closed":
        raise HTTPException(409, "This ticket is closed. Reopen it first.")
    body = (body or "").strip()
    if not body and not files:
        raise HTTPException(400, "Either a message body or an attachment is required.")
    m = SupportMessage(
        ticket_id=t.id, sender_user_id=admin.id, sender_role="admin",
        body=body,
    )
    db.add(m); db.flush()
    _store_attachments(m, files, db)
    t.last_message_at = m.created_at
    t.admin_last_read_at = m.created_at
    db.commit(); db.refresh(m)
    return _msg_out(m)


class TicketPatch(BaseModel):
    status: str | None = None  # "open" | "closed"


@admin_router.patch("/tickets/{ticket_id}")
def admin_patch_ticket(ticket_id: int, body: TicketPatch,
                       admin: User = Depends(_admin),
                       db: Session = Depends(get_db)) -> dict:
    t = db.get(SupportTicket, ticket_id)
    if not t:
        raise HTTPException(404, "Ticket not found")
    # Wing scoping — a wing_admin may only act on their own wing's tickets
    # (mirrors admin_get_ticket / admin_add_message).
    if admin.role == Role.wing_admin:
        officer = db.get(User, t.officer_user_id)
        if officer and officer.wing_id != admin.wing_id:
            raise HTTPException(403, "Not in your wing")
    if body.status in ("open", "closed"):
        t.status = body.status
    db.commit(); db.refresh(t)
    return _ticket_out(t, "admin")


@admin_router.get("/unread-count")
def admin_unread_count(admin: User = Depends(_admin),
                       db: Session = Depends(get_db)) -> dict:
    q = select(SupportTicket)
    if admin.role == Role.wing_admin:
        q = q.join(User, User.id == SupportTicket.officer_user_id).where(User.wing_id == admin.wing_id)
    total = 0
    for t in db.scalars(q).all():
        total += _unread_for(db, t, "admin")
    return {"unread": total}
