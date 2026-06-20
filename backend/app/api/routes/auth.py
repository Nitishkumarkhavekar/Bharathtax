"""Auth routes: login (acquires a seat), logout (frees it), me, heartbeat."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.api.deps import Principal, client_meta, get_current_user, get_principal
from app.core.db import get_db
from app.models.org import User
from app.schemas import LoginRequest, MeResponse, TokenResponse
from app.services import audit
from app.services import auth as auth_svc
from app.services import licensing

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, request: Request, db: Session = Depends(get_db)) -> TokenResponse:
    try:
        user = auth_svc.authenticate(db, body.username, body.password)
    except auth_svc.AuthError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="invalid credentials")
    try:
        token, expire, _sid = auth_svc.login(db, user)
    except licensing.SeatPoolExhausted as e:
        # this is the seat-pool block the brief calls for
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=f"All {e.limit} seats for your wing are in use. Try again later.",
        )
    cm = client_meta(request)
    audit.log_event(db, action="login", user_id=user.id, wing_id=user.wing_id, **cm)
    return TokenResponse(
        access_token=token, expires_at=expire, role=user.role,
        wing_id=user.wing_id, username=user.username,
    )


@router.post("/logout")
def logout(p: Principal = Depends(get_principal), db: Session = Depends(get_db)) -> dict:
    auth_svc.logout(db, p.session_id)
    audit.log_event(db, action="logout", user_id=p.user.id, wing_id=p.user.wing_id)
    return {"ok": True}


@router.post("/heartbeat")
def heartbeat(p: Principal = Depends(get_principal), db: Session = Depends(get_db)) -> dict:
    alive = licensing.touch_seat(db, p.session_id)
    return {"alive": alive}


@router.get("/me", response_model=MeResponse)
def me(user: User = Depends(get_current_user)) -> User:
    return user
