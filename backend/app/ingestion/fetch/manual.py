"""Manual-drop fetcher: ingest files placed under MANUAL_DROP_DIR.

Used when a source can't be fetched automatically (the govt site blocks bots).
Each file may have an optional `<file>.meta.json` sidecar carrying provenance
(source_url, title, published_date) so citations still link to the original.
"""
from __future__ import annotations

import hashlib
import json
from collections.abc import Iterator
from datetime import date
from pathlib import Path

from app.core.config import settings
from app.core.enums import SourceType
from app.core.logging import get_logger
from app.ingestion.contracts import FetchedItem

log = get_logger(__name__)

_CONTENT_TYPES = {".pdf": "application/pdf", ".html": "text/html", ".htm": "text/html",
                  ".txt": "text/plain"}


def _content_type(path: Path) -> str:
    return _CONTENT_TYPES.get(path.suffix.lower(), "application/octet-stream")


def _read_sidecar(path: Path) -> dict:
    side = path.with_suffix(path.suffix + ".meta.json")
    if side.exists():
        try:
            return json.loads(side.read_text(encoding="utf-8"))
        except Exception as e:  # pragma: no cover
            log.warning("bad sidecar %s: %s", side, e)
    return {}


def fetch(source: dict) -> Iterator[FetchedItem]:
    glob = source.get("manual_glob")
    if not glob:
        log.warning("source %s has no manual_glob; skipping", source.get("key"))
        return
    root = Path(settings.manual_drop_dir)
    doc_type = SourceType(source["source_type"])
    found = 0
    for path in sorted(root.glob(glob)):
        if not path.is_file() or path.name.endswith(".meta.json") or path.name.startswith("."):
            continue  # skip sidecars and dotfiles (e.g. .gitkeep)
        raw = path.read_bytes()
        if not raw:
            continue  # skip empty placeholders
        meta = _read_sidecar(path)
        pub = meta.get("published_date")
        yield FetchedItem(
            source_key=source["key"],
            title=meta.get("title") or path.stem,
            doc_type=doc_type,
            raw_bytes=raw,
            content_type=meta.get("content_type") or _content_type(path),
            source_url=meta.get("source_url") or source.get("base_url"),
            published_date=date.fromisoformat(pub) if pub else None,
            checksum=hashlib.sha256(raw).hexdigest(),
            origin_path=str(path),
        )
        found += 1
    log.info("manual fetch: %s matched %d file(s) for %s", glob, found, source.get("key"))
