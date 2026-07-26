"""User memory & personalization service.

Assembles a compact personalization preamble (profile + custom instructions +
the most relevant durable memories) that gets fed to the SELF-HOSTED model only,
and provides CRUD for settings + memory used by the Settings page and the
"remember that…" flow.

Complements app.models.chat (per-conversation memory) with cross-conversation,
user-managed global memory.
"""
from __future__ import annotations

import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.org import User
from app.models.personalization import UserMemory, UserSettings

_STOP = {"the", "a", "an", "of", "for", "and", "or", "to", "in", "on", "is", "are",
         "what", "how", "when", "which", "u/s", "under", "section", "please", "tell"}


# ---------------------------------------------------------------- settings CRUD
def get_or_create_settings(db: Session, user_id: int) -> UserSettings:
    s = db.get(UserSettings, user_id)
    if s is None:
        s = UserSettings(user_id=user_id)
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


def update_settings(db: Session, user_id: int, **fields) -> UserSettings:
    s = get_or_create_settings(db, user_id)
    for k in ("custom_instructions", "about_me", "style", "memory_enabled"):
        if k in fields and fields[k] is not None:
            setattr(s, k, fields[k])
    db.commit()
    db.refresh(s)
    return s


# ------------------------------------------------------------------ memory CRUD
def list_memory(db: Session, user_id: int) -> list[UserMemory]:
    return list(db.scalars(
        select(UserMemory).where(UserMemory.user_id == user_id)
        .order_by(UserMemory.pinned.desc(), UserMemory.created_at.desc())
    ))


def add_memory(db: Session, user_id: int, content: str, *, kind: str = "fact",
               source: str = "manual", pinned: bool = False,
               confidence: float = 1.0) -> UserMemory:
    m = UserMemory(user_id=user_id, content=content.strip(), kind=kind,
                   source=source, pinned=pinned, confidence=confidence)
    db.add(m)
    db.commit()
    db.refresh(m)
    return m


def update_memory(db: Session, mem_id: int, user_id: int, **fields) -> UserMemory | None:
    m = db.get(UserMemory, mem_id)
    if not m or m.user_id != user_id:
        return None
    for k in ("content", "kind", "pinned"):
        if k in fields and fields[k] is not None:
            setattr(m, k, fields[k])
    db.commit()
    db.refresh(m)
    return m


def delete_memory(db: Session, mem_id: int, user_id: int) -> bool:
    m = db.get(UserMemory, mem_id)
    if not m or m.user_id != user_id:
        return False
    db.delete(m)
    db.commit()
    return True


# ----------------------------------------------------------- context assembler
def _relevant_memory(mems: list[UserMemory], query: str, limit: int) -> list[UserMemory]:
    """Pinned first, then the memories that best overlap the query, then recent."""
    if not mems:
        return []
    qtokens = {w for w in re.findall(r"[a-z0-9()]+", (query or "").lower()) if w not in _STOP and len(w) > 2}
    pinned = [m for m in mems if m.pinned]
    rest = [m for m in mems if not m.pinned]

    def overlap(m: UserMemory) -> int:
        toks = {w for w in re.findall(r"[a-z0-9()]+", m.content.lower())}
        return len(qtokens & toks)

    rest.sort(key=lambda m: (overlap(m), m.created_at), reverse=True)
    out = pinned + [m for m in rest if m not in pinned]
    return out[:limit]


def _style_hints(style: dict) -> list[str]:
    hints = []
    if not isinstance(style, dict):
        return hints
    if style.get("concise"):
        hints.append("keep answers concise")
    if style.get("tables"):
        hints.append("use tables where they help")
    if style.get("citation_density") == "high":
        hints.append("cite the exact provisions generously")
    if style.get("standpoint") == "officer":
        hints.append("answer from the tax authority's standpoint")
    return hints


def build_context(db: Session, user: User, query: str, *, max_items: int = 8) -> str:
    """Compact personalization preamble for the self-hosted model. Empty string
    when there's nothing to add or the user turned memory off."""
    if user is None:
        return ""
    s = db.get(UserSettings, user.id)
    memory_on = True if s is None else bool(s.memory_enabled)

    lines: list[str] = []

    # Profile
    who = (user.designation or (user.role.value if hasattr(user.role, "value") else str(user.role))).strip()
    posting = (user.charge or "").strip()
    prof = f"Role: {who}" + (f", posted at {posting}" if posting else "")
    lines.append(prof + ".")

    if s and (s.about_me or "").strip():
        lines.append(f"About their work: {s.about_me.strip()}")
    if s and (s.custom_instructions or "").strip():
        lines.append(f"Their instructions: {s.custom_instructions.strip()}")
    hints = _style_hints(s.style if s else {})
    if hints:
        lines.append("How they like answers: " + "; ".join(hints) + ".")

    if memory_on:
        mems = _relevant_memory(list_memory(db, user.id), query, max_items)
        if mems:
            lines.append("Remember about them: " + " · ".join(m.content.strip() for m in mems))

    if len(lines) <= 1 and not posting and not (s and (s.custom_instructions or s.about_me)):
        # only a bare role line and nothing else — not worth injecting
        return ""

    body = "\n".join(f"- {ln}" for ln in lines)
    return ("Context about the person asking — use it to tailor tone, standpoint and "
            "format. Do NOT treat it as part of their question and do NOT search for it:\n" + body)
