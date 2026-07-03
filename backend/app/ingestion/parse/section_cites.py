"""Extract the Income-tax Act section numbers a legal text CITES.

Powers the "every case on Section 68 / 14A / 271" feature: we regex judgment and
circular text for section-citation forms ("section 68", "u/s 143(3)", "under
section 271(1)(c)", "r.w.s. 10(23C)", "sections 234A, 234B and 234C") and store the
normalised set of TOP-LEVEL section tokens on the document (`sections_cited`).

Normalisation keeps the section number + any trailing letter suffix but DROPS the
parenthetical sub-structure, so every "271(1)(c)"/"271(1)(b)" collapses to "271"
and "14A"/"115JB"/"92CA" are preserved:  271(1)(c) -> 271 ; 14A -> 14A ; 40(a)(ia) -> 40.
"""
from __future__ import annotations

import re

# citation triggers: "section(s)", "sec.", "u/s", "under section", "r.w.s." (read with section)
_TRIG = re.compile(r"(?:\bu/s\.?|\br\.?\s?w\.?\s?s\.?|\bunder\s+section|\bsections?\b|\bsec\.)", re.I)
# a section token = 1-3 digits + optional hyphen + up to 3 trailing letters
# (14A, 115JB, 92CA, 80-IB); NOT a year (4 digits). The hyphen keeps 80-IA/80-IB distinct.
_TOKPAT = r"\d{1,3}-?[A-Za-z]{0,3}"
_CHAIN = re.compile(rf"\s*(?:,|/|&|and|to|read\s+with|r/w)\s*({_TOKPAT})", re.I)
_LEAD = re.compile(rf"\s*(?:nos?\.?\s*)?({_TOKPAT})")


def _norm(tok: str) -> str | None:
    m = re.match(r"(\d{1,3})-?([A-Za-z]{0,3})", tok)
    if not m:
        return None
    num = int(m.group(1))
    if num < 1 or num > 300:          # income-tax sections run ~1..298 (+ new Act) — reject noise
        return None
    return f"{num}{m.group(2).upper()}"    # 80-IB -> 80IB, 14a -> 14A, 271 -> 271


def extract_sections(text: str, *, limit: int = 400) -> list[str]:
    """Return a sorted, de-duplicated list of top-level section tokens cited in `text`."""
    if not text:
        return []
    found: set[str] = set()
    for m in _TRIG.finditer(text):
        tail = text[m.end(): m.end() + 60]
        lead = _LEAD.match(tail)
        if not lead:
            continue
        n = _norm(lead.group(1))
        if n:
            found.add(n)
        # follow a chained list ("sections 234A, 234B and 234C") from just after the first token
        rest = tail[lead.end():]
        pos = 0
        while True:
            cm = _CHAIN.match(rest, pos)
            if not cm:
                break
            cn = _norm(cm.group(1))
            if cn:
                found.add(cn)
            pos = cm.end()
        if len(found) >= limit:
            break
    # stable order: numeric part then suffix
    return sorted(found, key=lambda s: (int(re.match(r"\d+", s).group()), s))
