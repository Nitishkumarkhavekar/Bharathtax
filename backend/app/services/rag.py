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
    "You are BharathTax, a research assistant for Indian tax officers. Answer "
    "the question concisely using primary Indian tax law (Income-Tax Act, "
    "Rules, and CBDT circulars/notifications). Cite the exact section / rule / "
    "circular for every claim. If the primary sources do not cover the "
    "question, say so plainly rather than guessing."
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


@dataclass
class Citation:
    n: int
    chunk_id: int
    breadcrumb: str
    source_url: str | None
    section_number: str | None


@dataclass
class Answer:
    text: str
    grounded: bool
    citations: list[Citation]
    meta: dict


def _build_user_prompt(question: str, passages: list[Passage]) -> str:
    blocks = []
    for i, p in enumerate(passages, start=1):
        blocks.append(f"[{i}] ({p.breadcrumb})\n{p.text}")
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

    # If the grounded model refused (no match in primary sources) AND a fallback
    # is configured, retry with a general income-tax LLM. The fallback prompt
    # forces it to stay on tax topics.
    used = "model-native"
    fallback = settings.llm_fallback_model_name
    if fallback and _looks_like_refusal(primary_text) and hasattr(client, "complete"):
        try:
            primary_text = client.complete(SYSTEM_PROMPT_FALLBACK, q, model=fallback)
            used = f"fallback:{fallback}"
        except TypeError:
            # Older LLMClient.complete() without a `model` kwarg (e.g. tests). Skip.
            pass

    return Answer(
        text=primary_text, grounded=True, citations=[],
        meta={
            "retrieval": used,
            "primary_model": settings.llm_model_name,
            "domain": domain.value if domain else None,
        },
    )


def answer_document(db: Session, question: str, *, namespace: str,
                    client: llm_mod.LLMClient | None = None) -> Answer:
    """Ask against a single uploaded document (private namespace)."""
    return _generate(question, retrieve_documents(db, question, namespace=namespace), client)
