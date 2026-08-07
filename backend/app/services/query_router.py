"""Cheap, deterministic per-query tier router.

Purpose: stop spending 3–6 Gemini calls (planner + researcher loop +
composer) on questions that a single grounded agent — or nothing at all —
can answer just as well. This is the largest cash lever on the chat stack.

Design principles
-----------------
* **Zero LLM cost.** Classification is pure keyword/shape heuristics on the
  question string. No model call is made to decide which model path to take,
  otherwise the router would defeat its own purpose.
* **Quality-protective.** The multi-agent path exists for genuinely complex,
  multi-part, research-heavy, or recency-sensitive questions. We escalate to
  it on any real signal of that. When a question is a plain single-fact
  lookup we drop to the (still grounded) single agent; when it is pure
  small-talk we can skip the heavy stack entirely.
* **Reversible.** Set ``MULTI_AGENT_ROUTING=0`` to disable gating and restore
  the previous always-multi-agent behaviour for A/B comparison.

Tiers
-----
* ``smalltalk`` — greetings / thanks / "who are you" → cheapest path.
* ``simple``    — single-fact lookup → single grounded agent.
* ``complex``   — comparison, drafting, case-law, recency, computation,
                  multi-part → multi-agent.
"""
from __future__ import annotations

import os
import re

SMALLTALK = "smalltalk"
SIMPLE = "simple"
COMPLEX = "complex"


def _flag(name: str, default: str = "1") -> bool:
    return os.getenv(name, default).lower() in ("1", "true", "yes", "on")


# --- signal vocabularies -------------------------------------------------
# Matched as whole words (word-boundary regex) so "vs" never fires inside
# "adverse" and "sc" never fires inside "scheme".

_COMPLEX_WORDS = {
    # comparison / analysis
    "compare", "comparison", "comparisons", "difference", "differences",
    "differ", "differs", "versus", "vs", "distinguish", "contrast",
    # drafting / procedure
    "draft", "drafting", "notice", "reply", "respond", "response", "appeal",
    "appeals", "submission", "submissions", "grounds", "petition", "letter",
    "rebuttal", "represent", "representation",
    # recency / web-search sensitive
    "latest", "recent", "recently", "current", "currently", "newest",
    "amendment", "amended", "amendments", "budget", "update", "updated",
    "2023", "2024", "2025", "2026", "2027",
    # case law
    "caselaw", "judgment", "judgement", "judgments", "ruling", "rulings",
    "precedent", "precedents", "itat", "tribunal", "held", "decided",
    "verdict", "bench",
    # reasoning-heavy
    "whether", "strategy", "implication", "implications", "consequence",
    "consequences", "taxability", "applicability", "analyse", "analyze",
    "evaluate", "assess", "assessment", "justify", "justification",
    # computation
    "calculate", "compute", "computation", "liability", "workout",
}

# multi-word complex phrases (checked as substrings, lowercased)
_COMPLEX_PHRASES = (
    "case law", "high court", "supreme court", "finance act",
    "how should", "should i", "should we", "pros and cons",
    "step by step", "how much tax", "tax treatment", "treatment of",
    "as of today", "this year", "last year", "as of now",
    "what about", "as well as", "and also",
)

_SMALLTALK_EXACT = {
    "hi", "hii", "hiii", "hey", "heya", "yo", "hello", "helo", "hullo",
    "ok", "okay", "k", "kk", "cool", "nice", "great", "good", "thanks",
    "thanx", "thx", "ty", "thankyou", "bye", "goodbye", "test", "testing",
    "hi there", "hello there", "thank you", "thanks a lot", "good morning",
    "good afternoon", "good evening", "good night", "how are you",
    "who are you", "what are you", "what can you do", "what do you do",
    "help", "menu", "start",
}

_WORD_RE = re.compile(r"[a-z0-9]+")


def classify(question: str) -> str:
    """Return the cheapest tier that can serve ``question`` well."""
    if not question:
        return SIMPLE
    q = question.strip().lower()
    norm = q.rstrip(" ?!.")

    # 1) Small-talk: exact match on a tight set, or a very short greeting.
    if norm in _SMALLTALK_EXACT:
        return SMALLTALK

    words = _WORD_RE.findall(q)
    n = len(words)
    wordset = set(words)

    # 2) Complex signals — escalate on any real one.
    if wordset & _COMPLEX_WORDS:
        return COMPLEX
    if any(p in q for p in _COMPLEX_PHRASES):
        return COMPLEX
    if q.count("?") >= 2:  # multi-part question
        return COMPLEX
    if n > 28:  # long, likely multi-clause
        return COMPLEX
    # "X and Y" style compound asks that are also reasonably long
    if n >= 14 and (" and " in q or ";" in q or " also " in q):
        return COMPLEX

    # 3) Otherwise a single grounded agent handles it.
    return SIMPLE


def should_use_multi(question: str) -> bool:
    """True iff the multi-agent (planner→researcher→composer) path is worth it.

    Honours ``MULTI_AGENT_ROUTING`` (default on). When routing is disabled
    every question returns True, reproducing the prior always-multi-agent
    behaviour for cost/quality A/B testing.
    """
    if not _flag("MULTI_AGENT_ROUTING", "1"):
        return True
    return classify(question) == COMPLEX


def is_smalltalk(question: str) -> bool:
    """True for greetings / thanks / meta chit-chat that need no research.

    Gated by ``CHEAP_SMALLTALK`` (default on) so it can be turned off if a
    deployment prefers to always run the grounded stack.
    """
    if not _flag("CHEAP_SMALLTALK", "1"):
        return False
    return classify(question) == SMALLTALK
