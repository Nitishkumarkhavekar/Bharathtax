"""Section-level splitting + targeting for appeal-draft edits.

Appeal orders have a stereotyped structure — Introduction, Grounds of Appeal,
Facts, Discussion, Conclusion.  When the officer says "change the discussion
part" or "fix the grounds", we should rewrite ONLY that section instead of
sending the whole 10k-token draft through Gemini.

Two heading dialects are recognised so this works both on a fresh markdown
draft (``## Discussion``) and on the plain-text output that OnlyOffice
round-trips through python-docx (``2. DISCUSSION``, ``**3. CONCLUSION**``).

Fallback contract: if we cannot confidently identify a target section, the
caller drops back to a whole-draft rewrite.  Guessing wrong is worse than
being slow.
"""
from __future__ import annotations

import re


# ---------------------------------------------------------------- splitting

# Matches either a markdown heading (``## X``, ``### X``) OR a numbered
# ALL-CAPS heading (``1. INTRODUCTION``, ``**2. GROUNDS OF APPEAL**``).  The
# numbered form is what OnlyOffice → docx → plain-text extraction leaves us
# with, because paragraph-level heading styles are stripped by ``_extract_text``.
_HEADING_RE = re.compile(
    r"""^
        (?:
          \s*(?:\*\*)?(?:\#{1,4})\s+(?P<md>.+?)(?:\*\*)?     # markdown heading
          |
          \s*(?:\*\*)?                                        # optional bold
          (?P<num>\d{1,2})\.\s+                              # "1. "
          (?P<caps>[A-Z][A-Z0-9 &/()\-–—.,]{3,})              # ALL-CAPS title
          (?:\*\*)?
        )
        \s*$
    """,
    re.MULTILINE | re.VERBOSE,
)


def _heading_text(match: re.Match) -> str:
    """Return just the readable heading text, without # marks or numbering."""
    md = match.group("md")
    if md:
        return md.strip()
    caps = (match.group("caps") or "").strip()
    return caps


def split_sections(md: str) -> list[dict]:
    """Break the draft into ordered sections.

    Returns a list of ``{title, body, span}`` dicts.  ``body`` includes the
    heading line itself, so re-joining ``s["body"]`` for every entry
    reconstructs the original text byte-for-byte.  The first entry may be a
    "preamble" (with empty title) covering any text that appears BEFORE the
    first heading — usually a title / party header block.
    """
    matches = list(_HEADING_RE.finditer(md))
    if not matches:
        return [{"title": "", "body": md, "span": (0, len(md))}]

    sections: list[dict] = []
    if matches[0].start() > 0:
        sections.append({
            "title": "",
            "body": md[: matches[0].start()],
            "span": (0, matches[0].start()),
        })

    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(md)
        sections.append({
            "title": _heading_text(m),
            "body": md[m.start(): end],
            "span": (m.start(), end),
        })
    return sections


# ---------------------------------------------------------------- targeting

# Officer-speak → canonical section concepts we can match against heading text.
_KEYWORDS: dict[str, tuple[str, ...]] = {
    "introduction": ("introduction", "intro", "preamble", "prelim"),
    "grounds":     ("ground", "grounds"),
    "facts":       ("facts", "background", "brief facts"),
    "discussion":  ("discussion", "analysis", "reasoning", "finding", "findings",
                    "consideration", "observations"),
    "submissions": ("submission", "submissions", "argument", "arguments",
                    "written submission"),
    "law":         ("law", "statutory", "provision", "provisions"),
    "conclusion":  ("conclusion", "decision", "operative", "order", "verdict",
                    "outcome", "held"),
    "prayer":      ("prayer", "relief"),
    "cost":        ("cost", "costs"),
}


def _tokens(text: str) -> set[str]:
    text = re.sub(r"[^a-z]+", " ", text.lower())
    return {w for w in text.split() if len(w) >= 4}


def find_target_section(instruction: str, sections: list[dict]) -> int | None:
    """Return the index in ``sections`` the instruction most likely targets.

    Priority order:
      1. Direct heading-word match — instruction mentions a word that appears
         verbatim (>=4 chars) in a section's title.
      2. Concept match via ``_KEYWORDS`` — instruction says "discussion", we
         look for headings that mean "discussion".
    Returns None on no confident match so the caller can fall back to
    whole-draft rewrite.
    """
    ins_tok = _tokens(instruction)
    if not ins_tok or not sections:
        return None

    # Pass 1: literal word overlap.
    best_i, best_hits = None, 0
    for i, s in enumerate(sections):
        if not s["title"]:
            continue
        overlap = len(ins_tok & _tokens(s["title"]))
        if overlap > best_hits:
            best_hits, best_i = overlap, i
    if best_i is not None and best_hits >= 1:
        return best_i

    # Pass 2: concept match — "discussion" in instruction → any heading whose
    # words match the "discussion" concept keywords.
    for concept, kws in _KEYWORDS.items():
        if not any(k in instruction.lower() for k in kws):
            continue
        for i, s in enumerate(sections):
            if not s["title"]:
                continue
            title_lc = s["title"].lower()
            if any(k in title_lc for k in kws):
                return i

    return None


def splice(sections: list[dict], target_index: int, new_body: str) -> str:
    """Rebuild the full draft with ``sections[target_index]`` replaced.

    ``new_body`` is expected to already contain the heading line — that's the
    contract we set with the LLM prompt.  Trailing whitespace is normalised
    so we don't accumulate blank lines across successive edits.
    """
    parts = []
    for i, s in enumerate(sections):
        parts.append(new_body.rstrip() if i == target_index else s["body"].rstrip())
    return "\n\n".join(p for p in parts if p) + "\n"
