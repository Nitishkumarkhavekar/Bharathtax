"""Prompt refinement ("Improve prompt"): rewrite a user's rough question into a
precise, professional tax-research query — WITHOUT answering it and WITHOUT
inventing facts. Mirrors the "improve prompt" affordance in Taxmann.AI and peers.

This never touches the corpus; it only reshapes the wording, so it stays fast
and cannot leak retrieved content into the editable prompt box.
"""
from __future__ import annotations

from app.services.llm import get_llm

_SYSTEM = (
    "You are a prompt editor for an Indian tax-law research assistant used by "
    "Income-tax officers and professionals. Rewrite the user's question into a "
    "single, precise, professional research query.\n\n"
    "RULES:\n"
    "- Preserve the user's original intent exactly. Do NOT answer the question.\n"
    "- Do NOT invent facts, figures, party names, assessment years, or section "
    "numbers that the user did not supply or clearly imply.\n"
    "- Use correct Indian tax terminology (e.g. 'addition under section 68', "
    "'unexplained cash credit', 'CIT(A)', 'assessment year') where it sharpens "
    "the existing meaning.\n"
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


def refine(text: str, context: str = "ask") -> str:
    """Return an improved version of `text`. Falls back to the original prompt
    when no real model is configured (the mock backend cannot rewrite)."""
    text = (text or "").strip()
    if not text:
        return text
    system = _SYSTEM + (_DOC_HINT if context == "document" else "")
    user = f"Original question:\n{text}\n\nImproved question:"
    try:
        out = get_llm().complete(system, user).strip()
    except Exception:
        return text
    # Mock backend (no model) returns a canned, bracketed string — never surface it.
    if not out or out.startswith("[mock LLM"):
        return text
    # Strip accidental wrapping quotes/labels some models add.
    out = out.strip().strip('"').strip()
    for prefix in ("Improved question:", "Improved prompt:"):
        if out.lower().startswith(prefix.lower()):
            out = out[len(prefix):].strip()
    return out or text
