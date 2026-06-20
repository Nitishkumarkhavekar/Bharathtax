"""Tests for the structure-aware chunker + Act parser (brief requirement).

These run on pure-stdlib code (no DB/torch), so they're fast and CI-friendly.
The guarantee under test: chunking happens on legal-structure boundaries — a
proviso or Explanation is never split mid-unit — and every chunk carries a
correct location breadcrumb with working parent-child links.
"""
from __future__ import annotations

from app.ingestion.chunk import build_breadcrumb, chunk_units
from app.ingestion.parse import it_act
from app.core.enums import ChunkLevel

# Minimal India-Code-shaped document: an arrangement-of-sections (TOC) followed
# by the body repeating from 'CHAPTER I'. 80C carries sub-sections + a proviso +
# an Explanation so we can assert they survive as discrete units.
SAMPLE = """\
THE INCOME-TAX ACT, 1961
ARRANGEMENT OF SECTIONS
CHAPTER I
PRELIMINARY
1. Short title, extent and commencement.
CHAPTER VIA
DEDUCTIONS TO BE MADE IN COMPUTING TOTAL INCOME
80C. Deduction in respect of life insurance premia, etc.

CHAPTER I
PRELIMINARY
1. Short title, extent and commencement.
(1) This Act may be called the Income-tax Act, 1961.
(2) It extends to the whole of India.
CHAPTER VIA
DEDUCTIONS TO BE MADE IN COMPUTING TOTAL INCOME
80C. Deduction in respect of life insurance premia, etc.
(1) In computing the total income of an assessee, being an individual or a Hindu
undivided family, there shall be deducted the whole of the amount referred to in
sub-section (2) as does not exceed one hundred and fifty thousand rupees.
(2) The sums referred to in sub-section (1) shall be any sums paid in the previous
year by the assessee as life insurance premia.
Provided that the aggregate amount of the deductions shall not exceed one hundred
and fifty thousand rupees.
Explanation.—For the purposes of this section, "insurance" includes a contract of
life insurance issued by a recognised insurer.
"""


def _chunks():
    return chunk_units(it_act.parse(SAMPLE))


def test_breadcrumb_formatting():
    path = [("Act", "Income Tax Act, 1961"), ("Chapter", "VIA"), ("Section", "80C"), ("sub-section", "(2)")]
    assert build_breadcrumb(path) == "Income Tax Act, 1961 > Chapter VIA > Section 80C > sub-section (2)"


def test_section_parent_exists():
    chunks = _chunks()
    parents = [c for c in chunks if c.level == ChunkLevel.section and c.section_number == "80C"]
    assert len(parents) == 1
    p = parents[0]
    assert "Section 80C" in p.breadcrumb
    assert "Chapter VIA" in p.breadcrumb
    # the parent holds the FULL section text (context for the LLM)
    assert "life insurance premia" in p.body
    assert "Explanation" in p.body


def test_subsections_are_separate_children_with_parent_link():
    chunks = _chunks()
    parent_idx = next(i for i, c in enumerate(chunks)
                      if c.level == ChunkLevel.section and c.section_number == "80C")
    subs = [c for c in chunks if c.section_number == "80C" and c.subsection]
    assert {c.subsection for c in subs} >= {"(1)", "(2)"}
    for c in subs:
        assert c.parent_index == parent_idx
        assert c.breadcrumb.endswith(f"sub-section {c.subsection}")


def test_proviso_and_explanation_not_split_away():
    chunks = _chunks()
    provisos = [c for c in chunks if c.section_number == "80C" and c.proviso_no]
    explanations = [c for c in chunks if c.section_number == "80C" and c.explanation_no]
    assert provisos, "proviso must be its own chunk"
    assert explanations, "Explanation must be its own chunk"
    # the proviso text stays intact, not merged into sub-section (2)
    assert "aggregate amount of the deductions" in provisos[0].body
    assert "insurance" in explanations[0].body
    assert "Explanation" in explanations[0].breadcrumb


def test_text_is_breadcrumb_prefixed():
    chunks = _chunks()
    for c in chunks:
        assert c.text.startswith(c.breadcrumb)
