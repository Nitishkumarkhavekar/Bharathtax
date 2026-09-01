"""Per-user personalization API: profile, settings/custom-instructions, and the
manageable global memory. Everything is scoped to the authenticated user."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import Principal, get_principal
from app.core.db import get_db
from app.core import department as dept
from app.services import personalization as svc

router = APIRouter(prefix="/me", tags=["personalization"])


@router.get("/department-taxonomy")
def department_taxonomy(_p: Principal = Depends(get_principal)) -> dict:
    """The canonical department taxonomy — wings, designations (with tiers),
    and the statutory approval map. Static reference data the dashboard and
    onboarding read from. Authenticated but user-independent."""
    return dept.taxonomy()


class ProfileSettingsIn(BaseModel):
    # profile (on users)
    charge: str | None = None
    preferred_language: str | None = None
    # settings
    custom_instructions: str | None = None
    about_me: str | None = None
    style: dict | None = None
    memory_enabled: bool | None = None


class MemoryIn(BaseModel):
    content: str
    kind: str = "fact"
    pinned: bool = False


class MemoryPatch(BaseModel):
    content: str | None = None
    kind: str | None = None
    pinned: bool | None = None


def _settings_out(user, s) -> dict:
    return {
        "charge": user.charge,
        "preferred_language": user.preferred_language,
        "role": user.role.value if hasattr(user.role, "value") else str(user.role),
        "designation": user.designation,
        "custom_instructions": s.custom_instructions,
        "about_me": s.about_me,
        "style": s.style or {},
        "memory_enabled": s.memory_enabled,
    }


def _mem_out(m) -> dict:
    return {"id": m.id, "content": m.content, "kind": m.kind, "source": m.source,
            "pinned": m.pinned, "created_at": m.created_at.isoformat() if m.created_at else None}


@router.get("/personalization")
def get_personalization(p: Principal = Depends(get_principal), db: Session = Depends(get_db)) -> dict:
    s = svc.get_or_create_settings(db, p.user.id)
    return _settings_out(p.user, s)


@router.put("/personalization")
def update_personalization(body: ProfileSettingsIn, p: Principal = Depends(get_principal),
                           db: Session = Depends(get_db)) -> dict:
    # profile fields live on the user row
    if body.charge is not None:
        p.user.charge = body.charge.strip() or None
    if body.preferred_language is not None:
        p.user.preferred_language = body.preferred_language.strip() or "en"
    db.commit()
    s = svc.update_settings(
        db, p.user.id,
        custom_instructions=body.custom_instructions,
        about_me=body.about_me,
        style=body.style,
        memory_enabled=body.memory_enabled,
    )
    db.refresh(p.user)
    return _settings_out(p.user, s)


@router.get("/memory")
def list_memory(p: Principal = Depends(get_principal), db: Session = Depends(get_db)) -> list[dict]:
    return [_mem_out(m) for m in svc.list_memory(db, p.user.id)]


@router.post("/memory")
def add_memory(body: MemoryIn, p: Principal = Depends(get_principal),
               db: Session = Depends(get_db)) -> dict:
    content = (body.content or "").strip()
    if not content:
        raise HTTPException(400, "content is required")
    m = svc.add_memory(db, p.user.id, content, kind=body.kind, pinned=body.pinned)
    return _mem_out(m)


@router.patch("/memory/{mem_id}")
def update_memory(mem_id: int, body: MemoryPatch, p: Principal = Depends(get_principal),
                  db: Session = Depends(get_db)) -> dict:
    m = svc.update_memory(db, mem_id, p.user.id, content=body.content, kind=body.kind, pinned=body.pinned)
    if not m:
        raise HTTPException(404, "Not found")
    return _mem_out(m)


@router.delete("/memory/{mem_id}", status_code=204)
def delete_memory(mem_id: int, p: Principal = Depends(get_principal),
                  db: Session = Depends(get_db)) -> None:
    if not svc.delete_memory(db, mem_id, p.user.id):
        raise HTTPException(404, "Not found")
