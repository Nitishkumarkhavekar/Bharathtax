"""RAG orchestration: retrieve -> (refuse if ungrounded) -> grounded prompt ->
LLM -> answer + citations.

The anti-hallucination contract is enforced HERE, not left to the model: if
retrieval is not grounded we return a fixed refusal and never call the LLM. When
we do call it, the system prompt forbids using anything outside the passages.
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

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

REFUSAL = (
    "I could not find this in the available primary sources (Income Tax Act, "
    "Rules, and the ingested CBDT circulars/notifications). I will not answer "
    "from outside that material. Try rephrasing, or widen the corpus."
)


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
    """Ask against the primary-law corpus (optionally filtered to one module/domain)."""
    return _generate(question, retrieve(db, question, domain=domain), client)


def answer_document(db: Session, question: str, *, namespace: str,
                    client: llm_mod.LLMClient | None = None) -> Answer:
    """Ask against a single uploaded document (private namespace)."""
    return _generate(question, retrieve_documents(db, question, namespace=namespace), client)
