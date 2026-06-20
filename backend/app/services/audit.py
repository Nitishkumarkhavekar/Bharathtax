"""Audit logging. Every query and document access is recorded (hard requirement)."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.activity import AuditLog


def log_event(
    db: Session,
    *,
    action: str,
    user_id: int | None = None,
    wing_id: int | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    query_text: str | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
    commit: bool = True,
) -> AuditLog:
    entry = AuditLog(
        action=action,
        user_id=user_id,
        wing_id=wing_id,
        resource_type=resource_type,
        resource_id=resource_id,
        query_text=query_text,
        ip=ip,
        user_agent=user_agent,
    )
    db.add(entry)
    if commit:
        db.commit()
    return entry
