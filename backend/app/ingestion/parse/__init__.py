"""Parser registry: map the `parser` name from sources.yaml -> a parse callable.

Adding a parser profile (e.g. gst_act) = add a module + one entry here.
"""
from __future__ import annotations

from collections.abc import Callable, Iterator
from functools import partial

from app.ingestion.contracts import ParsedUnit
from app.ingestion.parse import act_sections, cbdt, it_act, it_rules

Parser = Callable[[str], Iterator[ParsedUnit]]

_REGISTRY: dict[str, Parser] = {
    "it_act": it_act.parse,
    "it_rules": it_rules.parse,
    "act_sections": act_sections.parse,
    "cbdt_circular": partial(cbdt.parse, doc_type_label="Circular"),
    "cbdt_notification": partial(cbdt.parse, doc_type_label="Notification"),
}


def get_parser(name: str) -> Parser:
    try:
        return _REGISTRY[name]
    except KeyError as e:
        raise ValueError(f"Unknown parser profile: {name!r}. Known: {sorted(_REGISTRY)}") from e
