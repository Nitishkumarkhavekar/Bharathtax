"""Pydantic v2 request/response models (no business logic)."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.core.enums import QueryScope, Role


# ---- auth ----
class LoginRequest(BaseModel):
    """Email + password is the only supported sign-in method."""
    email: str
    password: str


class RegisterRequest(BaseModel):
    email: str
    password: str
    full_name: str | None = None
    organisation: str | None = None


class RegisterResponse(BaseModel):
    id: int
    email: str
    full_name: str | None = None
    approval_status: str
    message: str
    license_key: str | None = None
    trial_tokens: int | None = None


class PublicWingOut(BaseModel):
    """Wings exposed unauthenticated for the registration form."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    code: str


class ProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    email: str | None = None
    full_name: str | None = None
    organisation: str | None = None
    role: Role
    designation: str | None = None
    workspace_profile: str | None = None
    workspace_wings: list[str] | None = None
    wing_id: int
    is_active: bool
    approval_status: str
    created_at: datetime | None = None


class ProfileUpdate(BaseModel):
    full_name: str | None = None
    organisation: str | None = None
    designation: str | None = None
    workspace_profile: str | None = None   # "" clears it; validated server-side
    workspace_wings: list[str] | None = None
    # Optional password change (only applied when both are sent and match).
    current_password: str | None = None
    new_password: str | None = None


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
    email: str | None = None
    full_name: str | None
    organisation: str | None = None
    role: Role
    designation: str | None = None
    wing_id: int
    workspace_profile: str | None = None   # primary function; drives the tailored home
    workspace_wings: list[str] | None = None
    features: list[str] | None = None   # allowed modules; null = all


# ---- ask / answers ----
class AskRequest(BaseModel):
    question: str
    domain: str | None = None        # module filter (income_tax | gst | ...)
    style: str | None = "explanatory"
    chat_id: int | None = None       # persist this turn into a server-owned chat
    # Documents attached to THIS turn (uploaded inline via the composer's +
    # button, paste, or drag-drop). Each id points to a Document row the
    # caller owns. The agent is instructed to analyze these files together
    # with the question — their extracted text is prepended to the prompt
    # so the model doesn't have to guess which docs are in scope.
    attached_document_ids: list[int] | None = None
    # Client-side attachment metadata (filename, size, thumbnail data-URL)
    # for this turn. Persisted onto the user chat message's `meta` so the
    # attachment chip re-renders after a reload / chat switch. Purely
    # cosmetic — the model uses `attached_document_ids` to actually see
    # the file content.
    attachments_meta: list[dict] | None = None


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
    digest: str | None = None                    # judgment headnote ("what it held")
    sections_cited: list[str] | None = None      # IT-Act sections the judgment cites


class AnswerResponse(BaseModel):
    query_id: int | None = None
    scope: QueryScope
    grounded: bool
    answer: str
    citations: list[CitationOut]
    meta: dict
    latency_ms: int | None = None


# ---- documents (chat attachments only — standalone Documents page removed) ----
class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    filename: str
    status: str
    created_at: datetime


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
    department_id: int | None = None   # defaults to the first/only department
    name: str
    code: str | None = None            # auto-derived from name when omitted
    seat_limit: int = 0                # 0 = unlimited


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
    designation: str | None = None      # free-text job title
    workspace_profile: str | None = None
    workspace_wings: list[str] | None = None
    wing_id: int
    office_id: int | None = None
    features: list[str] | None = None   # allowed modules; null = all


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    full_name: str | None
    email: str | None = None
    organisation: str | None = None
    role: Role
    designation: str | None = None
    workspace_profile: str | None = None
    workspace_wings: list[str] | None = None
    wing_id: int
    office_id: int | None = None
    is_active: bool
    approval_status: str = "approved"
    approved_at: datetime | None = None
    created_at: datetime | None = None
    features: list[str] | None = None   # allowed modules; null = all


class UserUpdate(BaseModel):
    full_name: str | None = None
    email: str | None = None
    role: Role | None = None
    designation: str | None = None
    workspace_profile: str | None = None
    workspace_wings: list[str] | None = None
    wing_id: int | None = None
    office_id: int | None = None
    is_active: bool | None = None
    password: str | None = None    # optional reset
    features: list[str] | None = None   # allowed modules; null = all (only applied when key present)


# ---- licenses ----
class LicenseCreate(BaseModel):
    valid_until: datetime
    assigned_to: str | None = None
    notes: str | None = None
    valid_from: datetime | None = None


class LicenseUpdate(BaseModel):
    valid_until: datetime | None = None
    assigned_to: str | None = None
    notes: str | None = None
    status: str | None = None      # active | expired | deactivated


class LicenseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    key: str
    status: str
    valid_from: datetime
    valid_until: datetime
    assigned_to: str | None = None
    notes: str | None = None
    created_at: datetime
    updated_at: datetime


# ---- revenue ----
class RevenueCreate(BaseModel):
    entry_date: datetime | None = None
    source: str
    description: str | None = None
    amount: float
    currency: str = "INR"
    license_key_id: int | None = None


class RevenueUpdate(BaseModel):
    entry_date: datetime | None = None
    source: str | None = None
    description: str | None = None
    amount: float | None = None
    currency: str | None = None
    license_key_id: int | None = None


class RevenueOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    entry_date: datetime
    source: str
    description: str | None = None
    amount: float
    currency: str
    license_key_id: int | None = None
    created_at: datetime
    updated_at: datetime


# ---- dashboard / model / server ----
class DashboardOut(BaseModel):
    users_total: int
    users_active: int
    pending_approvals: int = 0
    admins: int
    queries_24h: int
    queries_7d: int
    queries_total: int
    avg_latency_ms: float | None = None
    revenue_month: float
    revenue_total: float
    licenses_active: int
    licenses_expired: int
    licenses_deactivated: int
    seats_used: int
    seats_total: int
    queries_per_day: list[dict]      # [{day: 'YYYY-MM-DD', count: int}]
    top_questions: list[dict]        # [{question: str, count: int}]


class ModelInfoOut(BaseModel):
    id: str
    queries_total: int
    queries_24h: int
    queries_7d: int
    avg_latency_ms: float | None
    success_rate: float              # 0..100
    is_primary: bool
    is_fallback: bool


class ModelManagementOut(BaseModel):
    backend: str
    base_url: str
    primary_model: str
    fallback_model: str | None
    models: list[ModelInfoOut]
    queries_per_day: list[dict]
    latency_per_day: list[dict]
    last_error: str | None = None
    healthy: bool


class ServerStatsOut(BaseModel):
    healthy: bool
    cpu_percent: float
    cpu_count: int
    load_avg: list[float]            # [1m, 5m, 15m]
    mem_total_mb: float
    mem_used_mb: float
    mem_percent: float
    swap_used_mb: float
    swap_percent: float
    disk_total_gb: float
    disk_used_gb: float
    disk_percent: float
    uptime_seconds: int
    process_count: int
    network_bytes_sent: int
    network_bytes_recv: int
    containers: list[dict]           # [{name, status, image}]
    llm_endpoint_healthy: bool
    llm_endpoint_latency_ms: float | None
