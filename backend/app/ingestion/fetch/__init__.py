"""Fetcher dispatch: map the `fetcher` name from sources.yaml -> a fetch callable.
manual | http_html | http_pdf  (the http variants share one polite client)."""
from __future__ import annotations

from collections.abc import Callable, Iterator

from app.ingestion.contracts import FetchedItem
from app.ingestion.fetch import http, manual

Fetcher = Callable[[dict], Iterator[FetchedItem]]

_REGISTRY: dict[str, Fetcher] = {
    "manual": manual.fetch,
    "http_html": http.fetch,
    "http_pdf": http.fetch,
}


def get_fetcher(name: str) -> Fetcher:
    try:
        return _REGISTRY[name]
    except KeyError as e:
        raise ValueError(f"Unknown fetcher: {name!r}. Known: {sorted(_REGISTRY)}") from e
