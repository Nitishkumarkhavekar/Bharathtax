"""Import all models so Base.metadata is complete (Alembic, create_all)."""
from app.models.activity import AuditLog, Query
from app.models.admin import LicenseKey, RevenueEntry
from app.models.appeal import AppealCase, AppealDocument, AppealOutput, AppealRun
from app.models.assessment import (
    AssessmentCase, AssessmentDocument, AssessmentOutput, AssessmentRun,
)
from app.models.chat import Chat, ChatMessage, ChatMemory, ChatSummary
from app.models.billing import SubscriptionPlan, TokenPrice, UserSubscription
from app.models.desktop import DesktopRelease
from app.models.support import SupportAttachment, SupportMessage, SupportTicket
from app.models.desktop_session import DesktopSession
from app.models.password_reset import PasswordResetToken
from app.models.drafting import DraftDocument
from app.models.contact import ContactMessage
from app.models.corpus import CorpusChunk, CorpusDocument, CorpusSource
from app.models.documents import Document, DocumentChunk
from app.models.enums import (
    ChunkLevel, CorpusDocStatus, Domain, DocumentStatus, QueryScope, Role, SourceType,
)
from app.models.org import Department, Office, SeatLease, User, Wing
from app.models.personalization import UserMemory, UserSettings
from app.models.token_usage import TokenUsage
from app.models.workspace import (
    Deadline, Matter, MatterShare, Reminder, StickyNote, Watchlist, WorkspaceTemplate,
)

__all__ = [
    "AuditLog", "Query",
    "LicenseKey", "RevenueEntry",
    "AppealCase", "AppealDocument", "AppealOutput", "AppealRun",
    "AssessmentCase", "AssessmentDocument", "AssessmentOutput", "AssessmentRun",
    "CorpusChunk", "CorpusDocument", "CorpusSource",
    "Document", "DocumentChunk",
    "ChunkLevel", "CorpusDocStatus", "Domain", "DocumentStatus", "QueryScope", "Role", "SourceType",
    "Department", "Office", "SeatLease", "User", "Wing",
    "UserMemory", "UserSettings",
    "TokenUsage",
    "Matter", "Deadline", "Reminder", "StickyNote",
    "WorkspaceTemplate", "Watchlist", "MatterShare",
    "SubscriptionPlan", "TokenPrice", "UserSubscription",
    "DesktopRelease",
    "SupportAttachment", "SupportMessage", "SupportTicket",
    "DesktopSession",
    "PasswordResetToken",
    "DraftDocument",
    "ContactMessage",
]
