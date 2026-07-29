"""Prompt refinement ("Improve prompt"): rewrite a user's rough question into a
precise, professional tax-research query — WITHOUT answering it and WITHOUT
inventing facts. Mirrors the "improve prompt" affordance in Taxmann.AI and peers.

This never touches the corpus; it only reshapes the wording, so it stays fast
and cannot leak retrieved content into the editable prompt box.
"""
from __future__ import annotations

import re

import os
from app.core.config import settings
from app.services.llm import get_llm, OpenAICompatLLM

# "Improve prompt" is an instruction-following REWRITE, not a grounded answer,
# so it must use the raw instruction model (bharattax-rag always does RAG/answers).
_IMPROVE_MODEL = os.getenv("IMPROVE_MODEL_NAME", "llama-3.1-8b-instruct")


def _improve_llm():
    if settings.llm_backend.lower() in {"openai", "vllm", "ollama"}:
        return OpenAICompatLLM(settings.llm_base_url, _IMPROVE_MODEL, settings.llm_api_key)
    return get_llm()  # mock/dev fallback

# A section/rule/article reference, e.g. "section 68", "u/s 44AD", "s. 271(1)(c)".
_SEC_TOKEN = re.compile(r"(?:section|sec\.?|s\.|u/s\.?|rule|article|art\.?)\s*(\d+[A-Za-z]*)", re.I)
# The full phrase to excise when the section was invented, incl. a leading
# "under "/"u/s " and a trailing " of the Income-tax Act, 1961".
_SEC_PHRASE = re.compile(
    r"\s*(?:under\s+|in\s+terms\s+of\s+)?"
    r"(?:section|sec\.?|s\.|u/s\.?|rule|article|art\.?)\s*\d+[A-Za-z]*(?:\([^)]*\))*"
    r"(?:\s+of\s+the\s+income[- ]?tax\s+act(?:,?\s*\d{4})?)?",
    re.I,
)
_PLACEHOLDER = re.compile(r"\s*[\[(](?:insert|enter|specify|tbd|xxx)[^\])]*[\])]", re.I)
# Bare section-like tokens in the user's OWN text (e.g. "68", "80c", "44ad",
# "271(1)(c)") — users rarely type the word "section". Liberal on purpose: this
# only ever *permits* a number to survive, so over-matching can't invent.
_BARE_NUM = re.compile(r"\b(\d+[A-Za-z]{0,4})(?:\([^)]*\))*\b")
# An assessment/financial-year phrase the rewrite may fabricate, e.g.
# "for the assessment year 2019-20", "in AY 2020-21", "financial year 2018".
_AY_PHRASE = re.compile(
    r"\s*(?:in|for|during|of)?\s*(?:the\s+)?"
    r"(?:assessment|financial|tax)\s+years?\s+(\d{4})(?:[-/]\d{2,4})?"
    r"|\s*(?:in|for|during|of)?\s*(?:the\s+)?a\.?y\.?\s*(\d{4})[-/]\d{2,4}",
    re.I,
)
# Bare four-digit years present in the user's own text (so we never strip one).
_YEAR = re.compile(r"\b(\d{4})\b")


def _allowed_numbers(original: str) -> set[str]:
    return {m.lower() for m in _BARE_NUM.findall(original or "")}


def _strip_invented_years(original: str, improved: str) -> str:
    years = set(_YEAR.findall(original or ""))

    def _drop(m: re.Match) -> str:
        yr = m.group(1) or m.group(2)
        return m.group(0) if (yr and yr in years) else ""

    return _AY_PHRASE.sub(_drop, improved)


def _strip_invented(original: str, improved: str) -> str:
    """Remove section/rule references and placeholder blanks the rewrite added
    but the user never wrote — the anti-invention guard, independent of model."""
    improved = _PLACEHOLDER.sub("", improved)
    improved = _strip_invented_years(original, improved)
    allowed = _allowed_numbers(original)
    if _SEC_TOKEN.search(improved):
        # Drop any section phrase whose number isn't in the user's original text.
        def _drop(m: re.Match) -> str:
            token = _SEC_TOKEN.search(m.group(0))
            return m.group(0) if (token and token.group(1).lower() in allowed) else ""
        improved = _SEC_PHRASE.sub(_drop, improved)
    # Tidy whitespace/punctuation left behind ("for the  ?" -> "for the?").
    improved = re.sub(r"\s{2,}", " ", improved)
    improved = re.sub(r"\s+([?.,;:])", r"\1", improved).strip()
    return improved

_SYSTEM = (
    "You are a prompt editor for an Indian tax-law research assistant used by "
    "Income-tax officers and professionals. Rewrite the user's question into a "
    "single, precise, professional research query.\n\n"
    "RULES:\n"
    "- Preserve the user's original intent exactly. Do NOT answer the question.\n"
    "- Do NOT invent facts, figures, party names, or assessment years that the "
    "user did not supply.\n"
    "- NEVER name a statutory section, rule, or article number unless the user "
    "wrote that exact number. If they didn't, refer to the issue in general "
    "terms instead. Example: 'does this order give proper reasons for the "
    "addition' -> 'Does this order record adequate reasons for the addition "
    "made?' (do NOT add 'under section 68' or any section the user omitted).\n"
    "- Do NOT add placeholder blanks like '[insert assessment year]'; if a "
    "detail is missing, simply leave it out.\n"
    "- Use correct Indian tax terminology (e.g. 'unexplained cash credit', "
    "'CIT(A)', 'burden of proof') where it sharpens the existing meaning, but "
    "only terminology — never new section numbers.\n"
    "- Make it specific and unambiguous: state the legal issue, the provision "
    "in question if the user named one, and what kind of answer is sought "
    "(principle, conditions, burden of proof, relevant case law).\n"
    "- Keep it concise — one well-formed question or a short structured ask. "
    "No preamble, no explanation, no quotes.\n"
    "Return ONLY the improved prompt text."
)

_DOC_HINT = (
    "\nThe question will be answered strictly from a single uploaded document, "
    "so phrase it as a focused ask about that document's contents."
)


def refine(text: str, context: str = "ask") -> tuple[str, dict | None]:
    """Return `(improved_text, llm_call_meta)`. `llm_call_meta` is a dict with
    `{model, usage, latency_ms}` when a real LLM call was made, else None."""
    text = (text or "").strip()
    if not text:
        return text, None
    system = _SYSTEM + (_DOC_HINT if context == "document" else "")
    user = f"Original question:\n{text}\n\nImproved question:"
    call_meta: dict | None = None
    try:
        client = _improve_llm()
        out = client.complete(system, user).strip()
        if isinstance(client, OpenAICompatLLM):
            call_meta = {
                "model": client.last_model or _IMPROVE_MODEL,
                "usage": client.last_usage,
                "latency_ms": client.last_latency_ms,
            }
    except Exception:
        return text, None
    # Mock backend (no model) returns a canned, bracketed string — never surface it.
    if not out or out.startswith("[mock LLM"):
        return text, call_meta
    # Strip accidental wrapping quotes/labels some models add.
    out = out.strip().strip('"').strip()
    for prefix in ("Improved question:", "Improved prompt:"):
        if out.lower().startswith(prefix.lower()):
            out = out[len(prefix):].strip()
    out = _strip_invented(text, out)
    return (out or text), call_meta
