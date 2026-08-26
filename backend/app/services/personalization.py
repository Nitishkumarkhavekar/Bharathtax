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


# ------------------------------------------------------------- explicit remember
_REMEMBER_RE = re.compile(
    r"^\s*(?:hey\s+|please\s+|can you\s+|could you\s+)*"
    r"(?:remember|note|keep in mind|don'?t forget|make a note)\b"
    r"\s*(?:that|this|:)?\s+(.+)$",
    re.I,
)


def parse_remember(text: str) -> str | None:
    """Return the fact from an explicit 'remember that …' message, else None."""
    m = _REMEMBER_RE.match(text or "")
    if not m:
        return None
    fact = m.group(1).strip().rstrip(".").strip()
    return fact if len(fact) >= 3 else None


def _is_duplicate(db: Session, user_id: int, content: str) -> bool:
    c = content.lower().strip()
    for m in list_memory(db, user_id):
        e = m.content.lower().strip()
        if c == e or c in e or e in c:
            return True
    return False


def remember_if_requested(db: Session, user: User, question: str) -> UserMemory | None:
    """If the message is an explicit 'remember …' request and memory is on, store
    the fact (deduped) and return it. Reliable + LLM-free."""
    if user is None:
        return None
    fact = parse_remember(question)
    if not fact:
        return None
    s = db.get(UserSettings, user.id)
    if s is not None and not s.memory_enabled:
        return None
    if _is_duplicate(db, user.id, fact):
        return None
    return add_memory(db, user.id, fact, source="chat:explicit")


def drafting_persona(db: Session, user: User) -> str:
    """Compact officer-context preamble for the DRAFTING engines (assessment /
    appeal / CASS questionnaire).

    Deliberately NARROWER than build_context: it carries only the officer's
    designation/jurisdiction, their drafting instructions and house style — and
    NO cross-matter memory or caseload. A statutory order must rest solely on
    the record of THIS case; the officer's other matters must never leak into
    it. The preamble also tells the model the context is letterhead/tone only,
    never evidence, so a stated charge can't invent a jurisdiction that isn't in
    the documents. Empty string when there's nothing worth adding."""
    if user is None:
        return ""
    s = db.get(UserSettings, user.id)
    lines: list[str] = []

    who = (user.designation or (user.role.value if hasattr(user.role, "value") else str(user.role))).strip()
    posting = (user.charge or "").strip()
    if (user.designation or "").strip() or posting:
        lines.append(f"Drafting officer: {who}" + (f", {posting}" if posting else "") + ".")
    if s and (s.custom_instructions or "").strip():
        lines.append(f"Their drafting instructions: {s.custom_instructions.strip()}")
    # House style, minus the officer-standpoint hint — the drafters are already
    # written in the AO's voice, so that hint would be redundant noise here.
    hints = [h for h in _style_hints(s.style if s else {})
             if "standpoint" not in h and "authority" not in h]
    if hints:
        lines.append("House style: " + "; ".join(hints) + ".")

    if not lines:
        return ""
    return ("Officer context for this DRAFT — use it ONLY to set the letterhead "
            "authority, tone and house style. It is NOT evidence: never treat it "
            "as a fact on record, and rely solely on the case documents for every "
            "figure, date, name, jurisdiction and finding:\n"
            + "\n".join(f"- {ln}" for ln in lines))


def build_context(db: Session, user: User, query: str, *, max_items: int = 8) -> str:
    """Compact personalization preamble for the self-hosted model. Empty string
    when there's nothing to add or the user turned memory off."""
    if user is None:
        return ""
    s = db.get(UserSettings, user.id)
    memory_on = True if s is None else bool(s.memory_enabled)

    lines: list[str] = []

    # Profile — prefer the officer's own designation; fall back to their chosen
    # function's label so a wing-only user still gets a meaningful role line.
    from app.core import profiles as _profiles
    wing = getattr(user, "workspace_profile", None)
    wings = getattr(user, "workspace_wings", None)
    wlabel = _profiles.wing_label(wing, wings)
    role_val = user.role.value if hasattr(user.role, "value") else str(user.role)
    who = (user.designation or wlabel or role_val).strip()
    posting = (user.charge or "").strip()
    prof = f"Role: {who}" + (f", posted at {posting}" if posting else "")
    lines.append(prof + ".")

    # Wing standpoint — so the answer is reasoned from the officer's perspective
    # (AO frames the assessment; a CA argues for the assessee) even absent a
    # free-text designation.
    stand = _profiles.wing_standpoint(wing, wings)
    if stand:
        lines.append(f"They work as {stand}; answer from that standpoint where it applies.")

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
