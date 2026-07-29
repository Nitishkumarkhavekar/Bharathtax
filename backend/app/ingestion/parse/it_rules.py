"""Income Tax Rules, 1962 parser. Same inner structure as the Act, but the
top-level unit is a Rule and sub-units are sub-rules."""
from __future__ import annotations

from collections.abc import Iterator

from app.ingestion.contracts import ParsedUnit
from app.ingestion.parse.base import parse_sections

RULES_NAME = "Income Tax Rules, 1962"


def parse(text: str, act_name: str = RULES_NAME) -> Iterator[ParsedUnit]:
    # No reliable TOC in the partial dept PDFs -> accept all plausible headers.
    yield from parse_sections(
        text,
        act_name=act_name,
        top_label="Rule",
        number_field="rule_number",
        valid_numbers=None,
    )
