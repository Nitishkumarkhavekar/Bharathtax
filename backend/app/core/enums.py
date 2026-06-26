"""Enumerated types used across the schema."""
from __future__ import annotations

import enum


class Role(str, enum.Enum):
    super_admin = "super_admin"
    wing_admin = "wing_admin"
    officer = "officer"
    auditor = "auditor"


class SourceType(str, enum.Enum):
    act = "act"
    rule = "rule"
    circular = "circular"
    notification = "notification"
    judgment = "judgment"          # case law (ITAT / HC / SC orders)


class Domain(str, enum.Enum):
    """The taxmann.ai 'Module' axis. MVP ships income_tax; rest are reserved."""
    income_tax = "income_tax"
    case_law = "case_law"          # income-tax judgments (ITAT / HC / SC)
    gst = "gst"
    customs = "customs"
    company_law = "company_law"


class ChunkLevel(str, enum.Enum):
    section = "section"      # parent (full section/rule) — given to the LLM for context
    subsection = "subsection"
    para = "para"            # child — what we match on


class CorpusDocStatus(str, enum.Enum):
    fetched = "fetched"
    extracted = "extracted"
    parsed = "parsed"
    indexed = "indexed"
    failed = "failed"


class DocumentStatus(str, enum.Enum):
    uploaded = "uploaded"
    processing = "processing"
    indexed = "indexed"
    failed = "failed"


class QueryScope(str, enum.Enum):
    corpus = "corpus"        # ask against primary tax law
    document = "document"    # ask against an uploaded document
