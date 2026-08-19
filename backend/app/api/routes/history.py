"""Per-user activity feed.

Merges Query rows (ask-bot / document ask) with AuditLog rows (appeal
lifecycle, document lifecycle, login) into a single reverse-chronological
list, scoped strictly to the calling user. Filterable by `kind` so the UI can
show "just my queries" or "just appeal activity".
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query as QueryParam
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.deps import Principal, get_principal
from app.core.db import get_db
from app.models.activity import AuditLog, Query
from app.models.appeal import AppealCase, AppealDocument
from app.models.chat import ChatMessage
from app.models.documents import Document

router = APIRouter(prefix="/history", tags=["history"])


# Which AuditLog `action` values map to which UI-facing kind. Anything not
# listed here is grouped as `"other"` and shown only when the "All" filter
# is active.
_APPEAL_ACTIONS = {
    "appeal.upload": "Uploaded documents",
    "appeal.run": "Started pipeline run",
    "appeal.run.cancel": "Cancelled pipeline run",
    "appeal.case.stop": "Stopped case pipeline",
    "appeal.case.edit": "Edited case metadata",
    "appeal.case.delete": "Deleted appeal case",
    "appeal.doc.delete": "Deleted appeal document",
}
_DOC_ACTIONS = {
    # NOTE: keep both punctuation styles — the audit-log service writes
    # `doc_upload` (underscore, from documents.py), but older entries in
    # the DB may have `doc.upload` (dot). Both should count as "document".
    "doc_upload": "Uploaded a document",
    "doc_delete": "Deleted a document",
    "doc_access": "Opened a document",
    "doc.upload": "Uploaded a document",
    "doc.delete": "Deleted a document",
    "doc.access": "Opened a document",
}
_LOGIN_ACTIONS = {"login": "Signed in", "logout": "Signed out"}


def _kind_of(action: str) -> str:
    if action in _APPEAL_ACTIONS:
        return "appeal"
    if action in _DOC_ACTIONS:
        return "document"
    if action in _LOGIN_ACTIONS:
        return "session"
    return "other"


def _label_of(action: str) -> str:
    return (
        _APPEAL_ACTIONS.get(action)
        or _DOC_ACTIONS.get(action)
        or _LOGIN_ACTIONS.get(action)
        or action.replace(".", " ").replace("_", " ").title()
    )


# Document rows are intentionally omitted from the History surface:
# every chat-attached upload is already visible in the chat message it
# was attached to (via UserAttachmentChip), so surfacing a second copy
# in the activity feed is duplicative. The `document` literal stays in
# the type for backwards compatibility with older clients, but the
# response excludes those rows and /counts reports 0.
HistoryKind = Literal["all", "query", "appeal", "document", "session"]


@router.get("")
def my_history(
    limit: int = QueryParam(100, ge=1, le=500),
    kind: HistoryKind = "all",
    p: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
) -> list[dict]:
    """Unified feed of the current user's activity — reverse-chronological.

    Kinds returned:
      * `query`     — Ask-bot / document-ask questions (with answer + citations)
      * `appeal`    — appeal-case lifecycle (upload, run, cancel, edit, delete)
      * `document`  — corpus-document uploads / opens / deletes
      * `session`   — login / logout
    """
    out: list[dict] = []

    # ---- Queries ----
    if kind in ("all", "query"):
        rows = db.scalars(
            select(Query)
            .where(Query.user_id == p.user.id)
            .order_by(Query.created_at.desc())
            .limit(limit)
        ).all()
        # Batch-resolve each Query to the ChatMessage where it was asked,
        # so the History row can (a) deep-link back to the exact chat
        # thread and (b) surface the attachments that were sent with the
        # turn (stored in ChatMessage.meta.attachments). `Query` has no
        # chat_id column, so we match on (user_id, role='user',
        # content == question) and pick the message closest in time.
        question_texts = {q.question for q in rows if q.question}
        # (chat_id, attachments) per (question, ts) match.
        chat_lookup: dict[tuple[str, datetime | None], tuple[int, list[dict]]] = {}
        if question_texts:
            msg_rows = db.execute(
                select(ChatMessage.content, ChatMessage.chat_id, ChatMessage.created_at, ChatMessage.meta)
                .where(ChatMessage.user_id == p.user.id)
                .where(ChatMessage.role == "user")
                .where(ChatMessage.content.in_(question_texts))
            ).all()
            by_content: dict[str, list[tuple[int, datetime | None, dict]]] = {}
            for content, chat_id, ts, meta in msg_rows:
                by_content.setdefault(content, []).append((chat_id, ts, meta or {}))
            for q in rows:
                cands = by_content.get(q.question or "", [])
                if not cands:
                    continue
                if q.created_at:
                    def _delta(pair: tuple[int, datetime | None, dict]) -> float:
                        ts = pair[1]
                        return abs((ts - q.created_at).total_seconds()) if ts else 1e18
                    cid, _, meta = min(cands, key=_delta)
                else:
                    cid, _, meta = cands[0]
                atts_raw = (meta or {}).get("attachments") or []
                # Slim the payload to what the History chip actually needs.
                atts = [
                    {
                        "docId": a.get("docId"),
                        "filename": a.get("filename"),
                        "contentType": a.get("contentType"),
                        "size": a.get("size"),
                    }
                    for a in atts_raw
                    if isinstance(a, dict) and a.get("docId") is not None
                ]
                chat_lookup[(q.question, q.created_at)] = (cid, atts)
        for q in rows:
            match = chat_lookup.get((q.question, q.created_at))
            chat_id = match[0] if match else None
            attachments = match[1] if match else []
            out.append({
                "id": f"q-{q.id}",
                "kind": "query",
                "action": "ask",
                "label": "Asked",
                "scope": (q.scope.value if hasattr(q.scope, "value") else str(q.scope)),
                "title": q.question,
                "detail": q.answer,
                # When set, the frontend opens THIS chat thread instead of
                # dropping the user on a blank composer. NULL means the
                # underlying chat has been deleted or the query was made
                # in a non-persistent context (rare).
                "chat_id": chat_id,
                # Attachments sent with this turn (each with docId + name)
                # — the row renders a Preview/Download chip per attachment.
                "attachments": attachments,
                "created_at": (q.created_at.isoformat() if isinstance(q.created_at, datetime) else q.created_at),
            })

    # ---- Audit events ----
    if kind in ("all", "appeal", "document", "session"):
        audit_rows = db.scalars(
            select(AuditLog)
            .where(AuditLog.user_id == p.user.id)
            .order_by(AuditLog.created_at.desc())
            .limit(limit * 3)  # over-fetch a bit; kind-filter may narrow this
        ).all()

        # Batch-resolve resource_id → display name so we can show "Raju case"
        # or "invoice.pdf" instead of "#3" in the feed. Deleted rows fall
        # back to the snapshot we stashed on the audit row's query_text.
        case_ids: set[int] = set()
        appeal_doc_ids: set[int] = set()
        doc_ids: set[int] = set()
        for a in audit_rows:
            if not a.resource_id:
                continue
            try:
                rid = int(a.resource_id)
            except ValueError:
                continue
            if a.resource_type == "appeal_case":
                case_ids.add(rid)
            elif a.resource_type == "appeal_document":
                appeal_doc_ids.add(rid)
            elif a.resource_type == "document":
                doc_ids.add(rid)
        case_titles: dict[int, str] = {}
        appeal_doc_names: dict[int, str] = {}
        doc_names: dict[int, str] = {}
        if case_ids:
            for cid, title in db.execute(
                select(AppealCase.id, AppealCase.title).where(AppealCase.id.in_(case_ids))
            ).all():
                case_titles[cid] = title
        if appeal_doc_ids:
            for did, filename in db.execute(
                select(AppealDocument.id, AppealDocument.filename).where(AppealDocument.id.in_(appeal_doc_ids))
            ).all():
                appeal_doc_names[did] = filename
        if doc_ids:
            # Chat-attached uploads (Document table) — filename here is
            # what the History row's Preview / Download buttons need.
            for did, filename in db.execute(
                select(Document.id, Document.filename).where(Document.id.in_(doc_ids))
            ).all():
                doc_names[did] = filename

        for a in audit_rows:
            k = _kind_of(a.action)
            if k == "other":
                continue
            # Skip document upload/access/delete rows — they're already
            # visible on the chat message they're attached to. See the
            # HistoryKind docstring above for the rationale.
            if k == "document":
                continue
            if kind != "all" and k != kind:
                continue

            display_name: str | None = None
            if a.resource_id:
                try:
                    rid = int(a.resource_id)
                except ValueError:
                    rid = None
                if rid is not None:
                    if a.resource_type == "appeal_case":
                        display_name = case_titles.get(rid) or (a.query_text or None)
                    elif a.resource_type == "appeal_document":
                        display_name = appeal_doc_names.get(rid) or (a.query_text or None)
                    elif a.resource_type == "document":
                        display_name = doc_names.get(rid) or (a.query_text or None)

            # Prefer the human-readable name; NEVER surface the numeric id.
            # If the underlying case/doc is gone AND we don't have a title
            # snapshot, say so with plain English instead of "#3" — the raw
            # id is an implementation detail.
            detail: str | None
            if display_name:
                detail = display_name
            elif a.query_text:
                detail = a.query_text
            elif a.resource_type == "appeal_case":
                detail = "Case no longer available"
            elif a.resource_type in ("appeal_document", "document"):
                detail = "Document no longer available"
            else:
                detail = None

            # Prefer the resolved name as the visible title (e.g. the
            # actual filename) so the row reads "invoice.pdf" instead of
            # "Uploaded a document". The action label moves to `detail`.
            if display_name:
                row_title = display_name
                row_detail = _label_of(a.action)
            else:
                row_title = _label_of(a.action)
                row_detail = detail
            out.append({
                "id": f"a-{a.id}",
                "kind": k,
                "action": a.action,
                "label": _label_of(a.action),
                "scope": None,
                "title": row_title,
                "detail": row_detail,
                "resource_type": a.resource_type,
                "resource_id": a.resource_id,
                "created_at": (a.created_at.isoformat() if isinstance(a.created_at, datetime) else a.created_at),
            })

    # Reverse-chronological merge, then trim to the requested limit.
    out.sort(key=lambda r: r["created_at"] or "", reverse=True)
    return out[:limit]


@router.get("/counts")
def counts(p: Principal = Depends(get_principal),
           db: Session = Depends(get_db)) -> dict[str, int]:
    """Per-kind row counts for the current user — powers the filter-chip badges."""
    from sqlalchemy import func
    q_count = db.scalar(
        select(func.count(Query.id)).where(Query.user_id == p.user.id)
    ) or 0
    a_rows = db.execute(
        select(AuditLog.action, func.count(AuditLog.id))
        .where(AuditLog.user_id == p.user.id)
        .group_by(AuditLog.action)
    ).all()
    per_kind = {"query": q_count, "appeal": 0, "document": 0, "session": 0}
    for action, n in a_rows:
        k = _kind_of(action)
        # Documents are shown inline in the chat, not on History — see the
        # HistoryKind comment. Report 0 so the (now-removed) chip stays
        # accurate on older clients that still render it.
        if k == "document":
            continue
        per_kind[k] = per_kind.get(k, 0) + n
    per_kind["all"] = q_count + per_kind["appeal"] + per_kind["session"]
    return per_kind


@router.delete("/{item_id}", status_code=204)
def delete_one(item_id: str, p: Principal = Depends(get_principal),
               db: Session = Depends(get_db)) -> None:
    """Delete one row from the current user's history.

    The composite id is `q-<n>` for a Query row and `a-<n>` for an audit row.
    """
    prefix, _, raw = item_id.partition("-")
    try:
        rid = int(raw)
    except ValueError:
        raise HTTPException(404, "Not found")
    if prefix == "q":
        q = db.get(Query, rid)
        if not q or q.user_id != p.user.id:
            raise HTTPException(404, "Not found")
        db.delete(q)
        db.commit()
        return
    if prefix == "a":
        a = db.get(AuditLog, rid)
        if not a or a.user_id != p.user.id:
            raise HTTPException(404, "Not found")
        db.delete(a)
        db.commit()
        return
    raise HTTPException(404, "Not found")


@router.delete("", status_code=204)
def clear_all(
    kind: HistoryKind = "all",
    p: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
) -> None:
    """Wipe the current user's history. Optionally scope by kind so the user
    can e.g. clear queries but keep appeal audit trail."""
    if kind in ("all", "query"):
        db.execute(delete(Query).where(Query.user_id == p.user.id))
    if kind == "all":
        db.execute(delete(AuditLog).where(AuditLog.user_id == p.user.id))
    elif kind in ("appeal", "document", "session"):
        target_actions = {
            "appeal": list(_APPEAL_ACTIONS),
            "document": list(_DOC_ACTIONS),
            "session": list(_LOGIN_ACTIONS),
        }[kind]
        db.execute(
            delete(AuditLog).where(
                AuditLog.user_id == p.user.id,
                AuditLog.action.in_(target_actions),
            )
        )
    db.commit()
