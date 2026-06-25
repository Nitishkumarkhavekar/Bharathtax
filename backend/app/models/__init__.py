"""Import all models so Base.metadata is complete (Alembic, create_all)."""
from app.models.activity import AuditLog, Query
from app.models.appeal import AppealCase, AppealDocument, AppealOutput, AppealRun
from app.models.corpus import CorpusChunk, CorpusDocument, CorpusSource
from app.models.documents import Document, DocumentChunk
from app.models.enums import (
    ChunkLevel, CorpusDocStatus, Domain, DocumentStatus, QueryScope, Role, SourceType,
)
from app.models.org import Department, Office, SeatLease, User, Wing

__all__ = [
    "AuditLog", "Query",
    "AppealCase", "AppealDocument", "AppealOutput", "AppealRun",
    "CorpusChunk", "CorpusDocument", "CorpusSource",
    "Document", "DocumentChunk",
    "ChunkLevel", "CorpusDocStatus", "Domain", "DocumentStatus", "QueryScope", "Role", "SourceType",
    "Department", "Office", "SeatLease", "User", "Wing",
]
