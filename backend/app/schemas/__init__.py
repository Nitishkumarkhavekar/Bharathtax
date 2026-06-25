"""Pydantic v2 request/response models (no business logic)."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.core.enums import QueryScope, Role


# ---- auth ----
class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    role: Role
    wing_id: int
    username: str


class MeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    full_name: str | None
    role: Role
    wing_id: int


# ---- ask / answers ----
class AskRequest(BaseModel):
    question: str
    domain: str | None = None        # module filter (income_tax | gst | ...)
    style: str | None = "explanatory"


class ImprovePromptRequest(BaseModel):
    text: str
    context: str | None = "ask"   # "ask" (corpus) | "document"


class ImprovePromptResponse(BaseModel):
    original: str
    improved: str
    changed: bool


class CitationOut(BaseModel):
    n: int
    chunk_id: int
    breadcrumb: str
    source_url: str | None = None
    section_number: str | None = None


class AnswerResponse(BaseModel):
    query_id: int | None = None
    scope: QueryScope
    grounded: bool
    answer: str
    citations: list[CitationOut]
    meta: dict
    latency_ms: int | None = None


# ---- documents ----
class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    filename: str
    status: str
    created_at: datetime


class DocAskRequest(BaseModel):
    question: str


# ---- history ----
class HistoryItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    scope: QueryScope
    question: str
    answer: str | None
    created_at: datetime


# ---- admin ----
class WingCreate(BaseModel):
    department_id: int
    name: str
    code: str
    seat_limit: int


class WingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    code: str
    seat_limit: int


class SeatUsageOut(BaseModel):
    wing_id: int
    used: int
    limit: int
    available: int


class UserCreate(BaseModel):
    username: str
    password: str
    full_name: str | None = None
    email: str | None = None
    role: Role = Role.officer
    wing_id: int
    office_id: int | None = None


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    full_name: str | None
    role: Role
    wing_id: int
    is_active: bool
