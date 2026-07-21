"""Per-chat semantic memory.

Embed each turn, recall the relevant ones by similarity (STRICTLY scoped to
user_id + chat_id), and roll up old turns into a rolling summary so long chats
stay coherent without ballooning the prompt. Every function is best-effort — a
memory failure must never break the chat response.
"""
from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.chat import ChatMemory, ChatMessage, ChatSummary
from app.services import embeddings as _emb

log = logging.getLogger("chat_memory")


def remember(db: Session, *, chat_id: int, user_id: int, message_id: int | None,
             role: str, content: str) -> None:
    text = (content or "").strip()
    if not text:
        return
    try:
        vec = _emb.embed_one(f"{role}: {text}"[:2000])
        db.add(ChatMemory(chat_id=chat_id, user_id=user_id, message_id=message_id,
                          kind="turn", text=text[:4000], embedding=vec))
        db.commit()
    except Exception as e:  # noqa: BLE001
        db.rollback()
        log.warning("remember failed: %s", e)


def recall(db: Session, *, user_id: int, chat_id: int, query: str, k: int = 4) -> list[dict]:
    """Top-k relevant prior turns from THIS user's THIS chat, above a relevance
    threshold. Returns [] on failure or nothing relevant."""
    q = (query or "").strip()
    if not q:
        return []
    try:
        qvec = _emb.embed_one(q)
        rows = db.execute(
            select(
                ChatMemory.text,
                ChatMemory.embedding.cosine_distance(qvec).label("dist"),
            )
            .where(ChatMemory.user_id == user_id, ChatMemory.chat_id == chat_id)
            .order_by("dist")
            .limit(k * 2)
        ).all()
        out = [
            {"text": r.text, "score": round(1.0 - float(r.dist), 3)}
            for r in rows
            if float(r.dist) < 0.75
        ][:k]
        return out
    except Exception as e:  # noqa: BLE001
        log.warning("recall failed: %s", e)
        return []


def get_summary(db: Session, *, user_id: int, chat_id: int) -> str:
    try:
        summ = db.scalar(
            select(ChatSummary).where(
                ChatSummary.chat_id == chat_id, ChatSummary.user_id == user_id
            )
        )
        return summ.summary if summ else ""
    except Exception:  # noqa: BLE001
        return ""


def maybe_summarize(db: Session, *, chat_id: int, user_id: int, keep_recent: int = 8) -> None:
    """If the chat has grown beyond keep_recent*2 messages, summarise the older
    ones into a rolling ChatSummary and advance the watermark. Best-effort."""
    try:
        msgs = db.scalars(
            select(ChatMessage)
            .where(ChatMessage.chat_id == chat_id, ChatMessage.user_id == user_id)
            .order_by(ChatMessage.id.asc())
        ).all()
        if len(msgs) <= keep_recent * 2:
            return
        summ = db.scalar(select(ChatSummary).where(ChatSummary.chat_id == chat_id))
        watermark = (summ.upto_message_id if summ else 0) or 0
        old = [m for m in msgs[:-keep_recent] if m.id > watermark]
        if not old:
            return
        convo = "\n".join(f"{m.role}: {m.content[:500]}" for m in old)
        prior = (summ.summary + "\n\n") if (summ and summ.summary) else ""
        from app.services import llm as _llm
        client = _llm.get_llm()
        prompt = (
            prior
            + "New turns to fold in:\n"
            + convo
            + "\n\nWrite a concise running summary of this Indian income-tax assistant "
            "conversation — the facts established, the user's situation, and any decisions. "
            "4-6 sentences, no preamble."
        )
        text = client.complete(
            "You summarise a conversation faithfully and concisely.", prompt
        )[:2000]
        if summ:
            summ.summary = text
            summ.upto_message_id = old[-1].id
        else:
            db.add(ChatSummary(chat_id=chat_id, user_id=user_id, summary=text,
                               upto_message_id=old[-1].id))
        db.commit()
    except Exception as e:  # noqa: BLE001
        db.rollback()
        log.warning("summarize failed: %s", e)
