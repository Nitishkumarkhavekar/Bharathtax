"""Source registry loader: read config/sources.yaml, merge defaults, and upsert
each entry into corpus_sources. Adding a source = editing the YAML, never code."""
from __future__ import annotations

import yaml
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.enums import Domain, SourceType
from app.core.logging import get_logger
from app.models.corpus import CorpusSource

log = get_logger(__name__)


def load_sources(path: str | None = None) -> list[dict]:
    """Return the list of source dicts with `defaults` merged in."""
    path = path or settings.sources_config
    with open(path, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    defaults = data.get("defaults", {}) or {}
    sources: list[dict] = []
    for src in data.get("sources", []):
        merged = {**defaults, **src}
        sources.append(merged)
    return sources


def sync_sources(db: Session, path: str | None = None) -> list[tuple[dict, CorpusSource]]:
    """Upsert corpus_sources from YAML. Returns [(source_dict, row)] for enabled ones."""
    out: list[tuple[dict, CorpusSource]] = []
    for src in load_sources(path):
        row = db.scalar(select(CorpusSource).where(CorpusSource.key == src["key"]))
        if row is None:
            row = CorpusSource(key=src["key"])
            db.add(row)
        row.domain = Domain(src["domain"])
        row.name = src["name"]
        row.source_type = SourceType(src["source_type"])
        row.base_url = src.get("base_url")
        row.config = src
        row.enabled = bool(src.get("enabled", True))
        db.flush()
        if row.enabled:
            out.append((src, row))
    db.commit()
    log.info("synced %d source(s) from %s", len(out), path or settings.sources_config)
    return out
