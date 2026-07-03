"""RAG orchestration: retrieve -> (refuse if ungrounded) -> grounded prompt ->
LLM -> answer + citations.

The anti-hallucination contract is enforced HERE, not left to the model: if
retrieval is not grounded we return a fixed refusal and never call the LLM. When
we do call it, the system prompt forbids using anything outside the passages.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.enums import Domain
from app.services import llm as llm_mod
from app.services.retrieval import Passage, RetrievalResult, retrieve, retrieve_documents

SYSTEM_PROMPT = (
    "You are BharathTax, a research assistant for Indian tax officers. Answer the "
    "question USING ONLY the numbered passages of primary tax law provided. "
    "Do NOT use any outside or prior knowledge. Cite every claim inline with the "
    "passage number in square brackets, e.g. [1]. Quote the exact statutory "
    "wording where relevant. If the passages do not contain the answer, say so "
    "plainly and do not guess."
)

# System prompt used when retrieval is delegated to the LLM (e.g. bharattax-rag).
SYSTEM_PROMPT_NATIVE = (
    "You are BharathTax, a professional research assistant for Indian "
    "income-tax officers and practitioners. Answer the question using primary "
    "Indian tax law (Income-Tax Act, Rules, CBDT circulars/notifications). "
    "Cite the exact section / rule / circular for every claim. If primary "
    "sources do not cover the question, say so plainly rather than guessing.\n"
    "\n"
    "FORMATTING — follow EVERY rule below so the answer is easy to read:\n"
    "1. Use clean markdown. Put a BLANK line between paragraphs.\n"
    "2. For tax-slab calculations or any multi-step computation, present it "
    "as a markdown bullet list. EACH bullet on its OWN line. Use `- ` (dash "
    "+ space) — NEVER inline '•' bullets glued together.\n"
    "3. Start labelled sub-totals on a new line and bold the label, e.g.\n"
    "   **Tax as per slabs:** Rs 25,000\n"
    "   **Less Section 87A rebate:** Rs 25,000\n"
    "   **Tax after rebate:** Rs 0\n"
    "   **Add 4% health & education cess:** Rs 0\n"
    "   **Total income tax payable:** Rs 0\n"
    "4. Use Indian number formatting with commas (Rs 8,50,000 or Rs 8.5 lakh).\n"
    "5. End with a one-line note if the answer depends on regime / assessment "
    "year. Prefix it with **Note:** on its own line.\n"
    "6. Keep prose tight — at most 2 short sentences before showing the steps."
)

REFUSAL = (
    "I could not find this in the available primary sources (Income Tax Act, "
    "Rules, and the ingested CBDT circulars/notifications). I will not answer "
    "from outside that material. Try rephrasing, or widen the corpus."
)

# Fallback prompt used when the grounded model can't find the question in
# primary sources but the question is still a legitimate income-tax topic
# (e.g. "what is income tax", "what is TDS", "explain HRA"). The fallback model
# does NOT have retrieval — keep it conversational, professional, and on-topic.
SYSTEM_PROMPT_FALLBACK = (
    "You are BharathTax, a professional research assistant for Indian "
    "income-tax officers and practitioners. The grounded primary-source "
    "lookup did not return a match for this question. Answer using your "
    "general knowledge of Indian income-tax law (Income-Tax Act 1961, "
    "Income-tax Rules, CBDT circulars/notifications, and well-established "
    "Indian tax concepts) in a clear, professional tone.\n\n"
    "Rules:\n"
    "1. Stay strictly on the topic of Indian income tax and closely related "
    "tax matters (TDS, GST/customs only if asked alongside income tax). "
    "Politely decline anything unrelated.\n"
    "2. Where you reference a section, rule or circular, name it explicitly "
    "(e.g. \"Section 80C of the Income-tax Act, 1961\").\n"
    "3. Where amounts, limits, or rates may change year-to-year, say so and "
    "note the financial year you are referring to.\n"
    "4. End with a brief, single-line disclaimer: \"Note: This is general "
    "guidance — verify against the latest Income-tax Act and CBDT "
    "notifications before acting.\"\n"
    "Keep the answer concise — ideally under 200 words unless the user "
    "explicitly asks for detail."
)

# Greeting / small-talk handler. Keep it warm and professional, and steer back
# to what the assistant can help with. Used WITHOUT an LLM call.
_GREETING_PATTERNS = re.compile(
    r"^\s*(hi|hii+|hello+|hey+|heya|yo|namaste|namaskar|namaskaram|"
    r"good\s+(morning|afternoon|evening|day)|how\s+are\s+you|how'?s\s+it\s+going|"
    r"who\s+are\s+you|what\s+can\s+you\s+do|what\s+do\s+you\s+do|help|"
    r"thanks?|thank\s+you|thx|ty|cheers|bye|goodbye|see\s+ya)"
    r"[\s!.?,]*$",
    re.IGNORECASE,
)

_GREETING_REPLIES = {
    "greet": (
        "Hello! I'm **BharathTax**, your assistant for Indian income-tax "
        "research. Ask me anything about the Income-tax Act, Rules, CBDT "
        "circulars, deductions, TDS, assessment procedures, appeals — I'll "
        "cite the relevant section or rule wherever I can.\n\n"
        "What would you like to know?"
    ),
    "who": (
        "I'm **BharathTax**, a research assistant built for Indian income-tax "
        "officers and practitioners. I can:\n"
        "- Explain provisions of the Income-tax Act, 1961 and the Income-tax Rules\n"
        "- Walk through deductions, exemptions, TDS, assessment procedure, appeals\n"
        "- Cite the exact section / rule / CBDT circular for every answer where possible\n\n"
        "Go ahead — ask me a tax question."
    ),
    "thanks": (
        "You're welcome. If you have another income-tax question, just ask."
    ),
    "bye": (
        "Goodbye — feel free to come back any time you need a tax-law lookup."
    ),
}


def _greeting_reply(question: str) -> str | None:
    """Return a canned warm reply for greetings / small talk, else None."""
    if not _GREETING_PATTERNS.match(question):
        return None
    q = question.strip().lower()
    if q.startswith(("thank", "thx", "ty", "cheers")):
        return _GREETING_REPLIES["thanks"]
    if q.startswith(("bye", "goodbye", "see")):
        return _GREETING_REPLIES["bye"]
    if "who" in q or "what can you" in q or "what do you" in q or q == "help":
        return _GREETING_REPLIES["who"]
    return _GREETING_REPLIES["greet"]


# Phrases the grounded model emits when it can't find a primary-source match.
# When we see these, we retry with the fallback model.
_REFUSAL_HINTS = (
    "could not find",
    "couldn't find",
    "not find this in the available primary sources",
    "do not have information",
    "don't have information",
    "no relevant",
    "i cannot answer",
    "i can't answer",
    "not covered in the primary sources",
)


def _looks_like_refusal(text: str) -> bool:
    t = text.lower()
    return any(h in t for h in _REFUSAL_HINTS)


_TIME_SENSITIVE = (
    "today", "latest", "recent", "recently", "this week", "this month", "newest",
    "just issued", "just announced", "just released", "up to date", "up-to-date",
    "as of now", "nowadays", "these days", "last week", "past week",
)


def _is_time_sensitive(q: str) -> bool:
    """True for questions asking about current/just-issued material the static
    corpus cannot hold (e.g. 'latest circular', 'rulings issued today')."""
    t = (q or "").lower()
    return any(k in t for k in _TIME_SENSITIVE)


@dataclass
class Citation:
    n: int
    chunk_id: int
    breadcrumb: str
    source_url: str | None
    section_number: str | None
    digest: str | None = None          # judgment headnote, shown under the citation
    sections_cited: list[str] | None = None


@dataclass
class Answer:
    text: str
    grounded: bool
    citations: list[Citation]
    meta: dict


def _build_user_prompt(question: str, passages: list[Passage]) -> str:
    blocks = []
    for i, p in enumerate(passages, start=1):
        # a judgment headnote (what it held) primes the model on the ratio before the text
        head = f"Headnote: {p.digest}\n" if getattr(p, "digest", None) else ""
        blocks.append(f"[{i}] ({p.breadcrumb})\n{head}{p.text}")
    return f"QUESTION: {question}\n\nPASSAGES:\n" + "\n\n".join(blocks)


def _generate(question: str, result: RetrievalResult, client: llm_mod.LLMClient | None) -> Answer:
    """Shared path: refuse if ungrounded, else prompt the LLM and assemble citations."""
    if not result.grounded:
        return Answer(text=REFUSAL, grounded=False, citations=[], meta=result.meta)
    citations = [
        Citation(
            n=i + 1,
            chunk_id=p.chunk_id,
            breadcrumb=p.breadcrumb,
            source_url=p.source_url,
            section_number=p.section_number,
            digest=getattr(p, "digest", None),
            sections_cited=getattr(p, "sections_cited", None),
        )
        for i, p in enumerate(result.passages)
    ]
    client = client or llm_mod.get_llm()
    text = client.complete(SYSTEM_PROMPT, _build_user_prompt(question, result.passages))
    return Answer(text=text, grounded=True, citations=citations, meta=result.meta)


def answer_question(db: Session, question: str, *, domain: Domain | None = None,
                    client: llm_mod.LLMClient | None = None) -> Answer:
    """Ask the Bharattax-rag model first; on a refusal, fall back to a general
    income-tax LLM so basic questions and clarifications still get an answer.
    Greetings get a friendly canned reply without an LLM call.

    Deployment note: the remote `bharattax-rag` model is itself a grounded RAG
    pipeline with its own retrieval over the Income-Tax Act + Rules + circulars
    on the LiteLLM gateway. We bypass the backend's local retrieval (the
    ml-server / pgvector path) and let the model do the lookup. Citations come
    back inline in the answer text.
    """
    q = (question or "").strip()
    if not q:
        return Answer(
            text="Please ask a question about Indian income-tax law.",
            grounded=False, citations=[], meta={"retrieval": "empty"},
        )

    greet = _greeting_reply(q)
    if greet is not None:
        return Answer(
            text=greet, grounded=True, citations=[],
            meta={"retrieval": "greeting", "domain": domain.value if domain else None},
        )

    client = client or llm_mod.get_llm()
    primary_text = client.complete(SYSTEM_PROMPT_NATIVE, q)
    # Telemetry the caller can persist into the token_usage table.
    llm_calls: list[dict] = []
    if isinstance(client, llm_mod.OpenAICompatLLM):
        llm_calls.append({
            "model": client.last_model or settings.llm_model_name,
            "usage": client.last_usage,
            "latency_ms": client.last_latency_ms,
        })

    # If the grounded model refused (no match in primary sources) AND a fallback
    # is configured, retry with a general income-tax LLM. The fallback prompt
    # forces it to stay on tax topics.
    used = "model-native"
    web_sources: list[dict] = []
    fallback = settings.llm_fallback_model_name
    refused = _looks_like_refusal(primary_text)
    # Live web search when the corpus refused OR the question is time-sensitive
    # (today/latest/recent) — a static corpus can't hold current data. The web
    # answer is clearly labelled as web-sourced and cited, never the statute.
    if refused or _is_time_sensitive(q):
        try:
            from app.services import gemini_search as _gs
            if _gs.available():
                _wtext, web_sources = _gs.web_answer(q)
                # Meter the Gemini call regardless of whether it produced
                # usable text — a failed call still consumes tokens on some
                # accounts (streamed + truncated responses).
                if _gs.last_usage or _gs.last_latency_ms is not None:
                    llm_calls.append({
                        "model": _gs.last_model,
                        "usage": _gs.last_usage,
                        "latency_ms": _gs.last_latency_ms,
                    })
                if _wtext:
                    primary_text = (
                        "🌐 *Note: the following is drawn from external web sources, not the "
                        "Income-tax Act corpus. Please verify against the official source before "
                        "relying on it.*\n\n" + _wtext
                    )
                    if web_sources:
                        primary_text += "\n\nSources:\n" + "\n".join(
                            f"- {srcs['title']}: {srcs['url']}" for srcs in web_sources[:6])
                    used = "web-search:gemini"
        except Exception:  # noqa: BLE001
            pass
    # Only a genuine REFUSAL (not mere time-sensitivity) lets the general LLM
    # replace an otherwise-valid corpus answer; if web search failed on a
    # time-sensitive query we keep the corpus answer.
    if refused and used == "model-native" and fallback and hasattr(client, "complete"):
        try:
            primary_text = client.complete(SYSTEM_PROMPT_FALLBACK, q, model=fallback)
            used = f"fallback:{fallback}"
            if isinstance(client, llm_mod.OpenAICompatLLM):
                llm_calls.append({
                    "model": client.last_model or fallback,
                    "usage": client.last_usage,
                    "latency_ms": client.last_latency_ms,
                })
        except TypeError:
            # Older LLMClient.complete() without a `model` kwarg (e.g. tests). Skip.
            pass

    # A time-sensitive question that did NOT get a live web answer must never be
    # served from the static corpus as if it were current — warn the user instead
    # of silently presenting outdated data as "latest".
    if _is_time_sensitive(q) and used != "web-search:gemini":
        primary_text = (
            "\u26a0\ufe0f *A live web lookup for the most recent information could not be completed "
            "just now, so the following is from the stored material and may not reflect the latest "
            "updates \u2014 please try again shortly for current data.*\n\n" + primary_text
        )
        used = used + "+stale-warned"

    return Answer(
        text=primary_text, grounded=True, citations=[],
        meta={
            "retrieval": used,
            "primary_model": settings.llm_model_name,
            "domain": domain.value if domain else None,
            "llm_calls": llm_calls,
            "web_sources": web_sources,
        },
    )


def answer_document(db: Session, question: str, *, namespace: str,
                    client: llm_mod.LLMClient | None = None) -> Answer:
    """Ask against a single uploaded document (private namespace)."""
    return _generate(question, retrieve_documents(db, question, namespace=namespace), client)
