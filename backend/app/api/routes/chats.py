"""Per-user chat conversations.

Every endpoint is scoped to the authenticated user. A chat (and its messages) is
only ever accessible to its owner — any other user gets a 404 (not 403, so chat
ids can't be probed for existence). This is the isolation foundation the per-chat
RAG memory will build on.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete as sql_delete, func, select
from sqlalchemy.orm import Session

from app.api.deps import Principal, get_principal
from app.core.db import get_db
from app.models.chat import Chat, ChatMessage

router = APIRouter(prefix="/chats", tags=["chats"])


class ChatCreate(BaseModel):
    title: str | None = None


class ChatPatch(BaseModel):
    title: str | None = None
    archived: bool | None = None
    pinned: bool | None = None


class MessageIn(BaseModel):
    role: str
    content: str
    citations: list | None = None
    meta: dict | None = None


def _owned_chat(db: Session, user_id: int, cid: int) -> Chat:
    """The chat with id `cid` IFF it belongs to `user_id`, else 404."""
    chat = db.get(Chat, cid)
    if not chat or chat.user_id != user_id:
        raise HTTPException(404, "Chat not found")
    return chat


def _chat_out(c: Chat, *, message_count: int | None = None) -> dict:
    return {
        "id": c.id,
        "title": c.title,
        "archived": c.archived,
        "pinned": bool(getattr(c, "pinned", False)),
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
        "message_count": message_count,
    }


def _msg_out(m: ChatMessage) -> dict:
    return {
        "id": m.id,
        "role": m.role,
        "content": m.content,
        "citations": m.citations or [],
        "meta": m.meta or {},
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


@router.get("")
def list_chats(archived: bool = False, p: Principal = Depends(get_principal),
               db: Session = Depends(get_db)) -> list[dict]:
    """List the caller's chats. `?archived=true` returns the archive instead of
    the active list. Active list is pinned-first, then most-recent."""
    rows = db.scalars(
        select(Chat)
        .where(Chat.user_id == p.user.id, Chat.archived.is_(bool(archived)))
        .order_by(Chat.pinned.desc(), Chat.updated_at.desc())
    ).all()
    counts = dict(
        db.execute(
            select(ChatMessage.chat_id, func.count(ChatMessage.id))
            .where(ChatMessage.user_id == p.user.id)
            .group_by(ChatMessage.chat_id)
        ).all()
    )
    return [_chat_out(c, message_count=int(counts.get(c.id, 0))) for c in rows]


@router.post("", status_code=201)
def create_chat(body: ChatCreate, p: Principal = Depends(get_principal),
                db: Session = Depends(get_db)) -> dict:
    title = (body.title or "New chat").strip()[:200] or "New chat"
    c = Chat(user_id=p.user.id, wing_id=getattr(p.user, "wing_id", None), title=title)
    db.add(c)
    db.commit()
    db.refresh(c)
    return _chat_out(c, message_count=0)


@router.get("/{cid}")
def get_chat(cid: int, p: Principal = Depends(get_principal),
             db: Session = Depends(get_db)) -> dict:
    c = _owned_chat(db, p.user.id, cid)
    msgs = db.scalars(
        select(ChatMessage)
        .where(ChatMessage.chat_id == cid, ChatMessage.user_id == p.user.id)
        .order_by(ChatMessage.created_at.asc(), ChatMessage.id.asc())
    ).all()
    out = _chat_out(c, message_count=len(msgs))
    out["messages"] = [_msg_out(m) for m in msgs]
    return out


@router.patch("/{cid}")
def patch_chat(cid: int, body: ChatPatch, p: Principal = Depends(get_principal),
               db: Session = Depends(get_db)) -> dict:
    c = _owned_chat(db, p.user.id, cid)
    if body.title is not None:
        c.title = (body.title.strip()[:200]) or c.title
    if body.archived is not None:
        c.archived = bool(body.archived)
    if body.pinned is not None:
        c.pinned = bool(body.pinned)
    db.commit()
    db.refresh(c)
    return _chat_out(c)


@router.delete("/{cid}", status_code=204)
def delete_chat(cid: int, p: Principal = Depends(get_principal),
                db: Session = Depends(get_db)) -> None:
    c = _owned_chat(db, p.user.id, cid)
    db.execute(sql_delete(ChatMessage).where(ChatMessage.chat_id == cid))
    db.delete(c)
    db.commit()


@router.post("/{cid}/messages", status_code=201)
def add_message(cid: int, body: MessageIn, p: Principal = Depends(get_principal),
                db: Session = Depends(get_db)) -> dict:
    chat = _owned_chat(db, p.user.id, cid)
    role = (body.role or "").strip().lower()
    if role not in ("user", "assistant"):
        raise HTTPException(400, "role must be 'user' or 'assistant'")
    if not (body.content or "").strip():
        raise HTTPException(400, "content required")
    m = ChatMessage(
        chat_id=cid,
        user_id=p.user.id,
        role=role,
        content=body.content,
        citations=body.citations or [],
        meta=body.meta or {},
    )
    db.add(m)
    # Auto-title a brand-new chat from its first user message.
    if chat.title == "New chat" and role == "user":
        chat.title = body.content.strip()[:60] or chat.title
    db.commit()
    db.refresh(m)
    return _msg_out(m)
