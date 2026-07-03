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
        for q in rows:
            out.append({
                "id": f"q-{q.id}",
                "kind": "query",
                "action": "ask",
                "label": "Asked",
                "scope": (q.scope.value if hasattr(q.scope, "value") else str(q.scope)),
                "title": q.question,
                "detail": q.answer,
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
        # instead of "appeal_case #3" in the feed. Deleted cases fall back to
        # the title we stashed on the audit row's query_text (or a bare id).
        case_ids: set[int] = set()
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
                doc_ids.add(rid)
        case_titles: dict[int, str] = {}
        doc_names: dict[int, str] = {}
        if case_ids:
            for cid, title in db.execute(
                select(AppealCase.id, AppealCase.title).where(AppealCase.id.in_(case_ids))
            ).all():
                case_titles[cid] = title
        if doc_ids:
            for did, filename in db.execute(
                select(AppealDocument.id, AppealDocument.filename).where(AppealDocument.id.in_(doc_ids))
            ).all():
                doc_names[did] = filename

        for a in audit_rows:
            k = _kind_of(a.action)
            if k == "other":
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
            elif a.resource_type == "appeal_document":
                detail = "Document no longer available"
            else:
                detail = None

            out.append({
                "id": f"a-{a.id}",
                "kind": k,
                "action": a.action,
                "label": _label_of(a.action),
                "scope": None,
                "title": _label_of(a.action),
                "detail": detail,
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
        per_kind[_kind_of(action)] = per_kind.get(_kind_of(action), 0) + n
    per_kind["all"] = q_count + per_kind["appeal"] + per_kind["document"] + per_kind["session"]
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
