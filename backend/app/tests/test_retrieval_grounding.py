"""Anti-hallucination contract: the RAG layer must REFUSE when retrieval is not
grounded, and must never call the LLM in that case. When grounded, it must build
one citation per passage. Uses the shared _generate() with a fake RetrievalResult
so no DB/models/embeddings are exercised."""
from __future__ import annotations

import pytest

from app.services import rag
from app.services.retrieval import Passage, RetrievalResult


class _ExplodingLLM:
    """Fails if the answer path ever calls it (it must not, when ungrounded)."""
    def complete(self, system: str, user: str) -> str:  # noqa: D401
        raise AssertionError("LLM must not be called when retrieval is ungrounded")


class _EchoLLM:
    def __init__(self) -> None:
        self.calls = 0

    def complete(self, system: str, user: str) -> str:
        self.calls += 1
        assert "USING ONLY" in system  # grounding instruction is present
        assert "PASSAGES:" in user
        return "Grounded answer citing [1]."


def _passage(n: int) -> Passage:
    return Passage(
        chunk_id=n, breadcrumb=f"Income Tax Act, 1961 > Section {n}",
        text=f"text {n}", match_text=f"text {n}", source_url="https://example.gov.in",
        section_number=str(n), rule_number=None, domain="income_tax", score=0.9,
    )


def test_refuses_when_ungrounded():
    result = RetrievalResult(passages=[], grounded=False, meta={"top_score": None})
    ans = rag._generate("anything", result, _ExplodingLLM())
    assert ans.grounded is False
    assert ans.citations == []
    assert "could not find" in ans.text.lower()


def test_answers_and_cites_when_grounded():
    llm = _EchoLLM()
    result = RetrievalResult(passages=[_passage(1), _passage(2)], grounded=True,
                             meta={"top_score": 0.9})
    ans = rag._generate("q", result, llm)
    assert llm.calls == 1
    assert ans.grounded is True
    assert [c.n for c in ans.citations] == [1, 2]
    assert ans.citations[0].source_url == "https://example.gov.in"


def test_low_score_is_treated_as_ungrounded_upstream():
    # grounding gate lives in retrieval (score < min_score -> grounded False);
    # here we assert _generate honours that flag rather than re-deciding.
    result = RetrievalResult(passages=[_passage(1)], grounded=False, meta={})
    ans = rag._generate("q", result, _ExplodingLLM())
    assert ans.grounded is False
    assert ans.citations == []


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
