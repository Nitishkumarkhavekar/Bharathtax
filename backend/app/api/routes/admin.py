"""Admin console: manage wings/seats/users and watch live seat-pool usage.
super_admin manages everything; wing_admin is scoped to its own wing."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.db import get_db
from app.core.security import hash_password
from app.models.enums import Role
from app.models.org import User, Wing
from app.schemas import SeatUsageOut, UserCreate, UserOut, WingCreate, WingOut
from app.services import licensing

router = APIRouter(prefix="/admin", tags=["admin"])


def _admin(user: User = Depends(get_current_user)) -> User:
    if user.role not in (Role.super_admin, Role.wing_admin):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="admin only")
    return user


def _scope_wing(admin: User, wing_id: int) -> None:
    if admin.role == Role.wing_admin and admin.wing_id != wing_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="not your wing")


@router.get("/wings", response_model=list[WingOut])
def list_wings(admin: User = Depends(_admin), db: Session = Depends(get_db)) -> list[Wing]:
    stmt = select(Wing)
    if admin.role == Role.wing_admin:
        stmt = stmt.where(Wing.id == admin.wing_id)
    return list(db.scalars(stmt))


@router.post("/wings", response_model=WingOut)
def create_wing(body: WingCreate, db: Session = Depends(get_db),
                admin: User = Depends(get_current_user)) -> Wing:
    if admin.role != Role.super_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="super_admin only")
    wing = Wing(department_id=body.department_id, name=body.name, code=body.code,
                seat_limit=body.seat_limit)
    db.add(wing)
    db.commit()
    return wing


@router.get("/wings/{wing_id}/seats", response_model=SeatUsageOut)
def seat_usage(wing_id: int, admin: User = Depends(_admin), db: Session = Depends(get_db)) -> dict:
    _scope_wing(admin, wing_id)
    return licensing.usage(db, wing_id)


@router.get("/users", response_model=list[UserOut])
def list_users(wing_id: int | None = None, admin: User = Depends(_admin),
               db: Session = Depends(get_db)) -> list[User]:
    target = admin.wing_id if admin.role == Role.wing_admin else wing_id
    stmt = select(User)
    if target is not None:
        stmt = stmt.where(User.wing_id == target)
    return list(db.scalars(stmt))


@router.post("/users", response_model=UserOut)
def create_user(body: UserCreate, admin: User = Depends(_admin),
                db: Session = Depends(get_db)) -> User:
    _scope_wing(admin, body.wing_id)
    if db.scalar(select(User).where(User.username == body.username)):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="username exists")
    user = User(
        username=body.username, password_hash=hash_password(body.password),
        full_name=body.full_name, email=body.email, role=body.role,
        wing_id=body.wing_id, office_id=body.office_id,
    )
    db.add(user)
    db.commit()
    return user
