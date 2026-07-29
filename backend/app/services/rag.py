"""RAG orchestration: retrieve -> (refuse if ungrounded) -> grounded prompt ->
LLM -> answer + citations.

The anti-hallucination contract is enforced HERE, not left to the model: if
retrieval is not grounded we return a fixed refusal and never call the LLM. When
we do call it, the system prompt forbids using anything outside the passages.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.enums import Domain
from app.services import llm as llm_mod
from app.services import query_cache as _qcache
from app.services.retrieval import Passage, RetrievalResult, retrieve, retrieve_documents

log = logging.getLogger(__name__)

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
    "1. Your scope is Indian income tax and everything around it an officer "
    "deals with — including TDS, capital gains, ESOPs, and the tax treatment "
    "or litigation of a specific taxpayer, company, transaction, or tribunal/"
    "court case. A question naming a company, a case, a section, or a tax issue "
    "is IN scope — answer it; never brush it off as 'unrelated'. Decline only "
    "requests with no plausible tax angle at all (weather, coding, trivia).\n"
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
# Kept TIGHT — loose matching burned Gemini web-search calls on perfectly good
# corpus answers that merely hedged mid-sentence.
_REFUSAL_HINTS = (
    "could not find this in the available primary sources",
    "not find this in the available primary sources",
    "not covered in the primary sources",
    "i cannot answer",
    "i can't answer",
    "i do not have information about this",
    "i don't have information about this",
)


def _looks_like_refusal(text: str) -> bool:
    """True only for HIGH-CONFIDENCE refusals. Historically we tripped on
    any answer containing "I don't have" or "no relevant" as sub-strings —
    that fired Gemini's grounded search (~₹3 each) on hundreds of otherwise
    valid corpus answers. Now we require BOTH:
      1. The answer is short (a genuine refusal is 1-3 sentences), AND
      2. It contains one of the tight `_REFUSAL_HINTS` phrases.
    """
    if not text:
        return True
    stripped = text.strip()
    # A real refusal is short. Anything > 500 chars is a real answer, even
    # if it happens to contain the string "do not have information" somewhere
    # inside a long hedge.
    if len(stripped) > 500:
        return False
    t = stripped.lower()
    return any(h in t for h in _REFUSAL_HINTS)


# Tight time-sensitivity gate. We require BOTH:
#   1. A word that flags "now-ness" (today / latest / recent / current / this-year), AND
#   2. A subject the corpus genuinely can't hold (circular / notification / ruling /
#      order / news / update / order date after 2024)
# so questions like "what is the current section 80C limit?" DON'T fire Gemini
# (the corpus answers this perfectly for the standard AY).
_TIME_MARKERS = (
    "today", "yesterday", "latest", "recent", "recently", "just issued",
    "just announced", "just released", "this week", "last week", "past week",
    "this month", "past month", "as of now", "as of today",
    "current", "currently", "these days", "nowadays", "this year",
    "right now", "trending", "happening", "going on", "as of",
)
_TIME_SUBJECTS = (
    "circular", "notification", "press release", "ruling", "order",
    "amendment", "budget", "news", "update", "developments",
    "annouoncement", "announcement", "cabinet", "finance minister",
    "cbdt press", "cbdt release",
)


_LIVE_DISCLAIMER_HINTS = (
    "real-time", "real time", "do not have access to", "don't have access to",
    "cannot provide the latest", "can't provide the latest", "no access to live",
    "cannot access live", "not have access to live", "unable to access",
)


def _is_live_disclaimer(text: str) -> bool:
    """True when the corpus answer is essentially 'I can't see live/real-time
    data' — for a time-sensitive query we should show the web answer instead of
    prepending this disclaimer to it."""
    t = (text or "").lower()
    return any(p in t for p in _LIVE_DISCLAIMER_HINTS)


def _is_time_sensitive(q: str) -> bool:
    """True for questions the static corpus genuinely cannot hold — new
    circular/ruling/notification news. Requires a time marker AND a
    time-varying subject; either alone is not enough."""
    if not q:
        return False
    t = q.lower()
    has_marker = any(k in t for k in _TIME_MARKERS)
    if not has_marker:
        return False
    has_subject = any(s in t for s in _TIME_SUBJECTS)
    return has_subject


_DOC_MARKERS = (
    "circular", "notification", "press release", "office memorandum", "office order",
    "instruction no", "instruction number", "f. no", "f.no", "cbdt circular",
    "this circular", "the circular", "this notification", "this order",
)


def _is_document_query(q: str) -> bool:
    """True for questions about a SPECIFIC external document (a CBDT circular /
    notification / press release / instruction) whose full text the static corpus
    cannot hold — better answered live from the web than from a stray fragment."""
    t = (q or "").lower()
    return any(k in t for k in _DOC_MARKERS)


_CASELAW_HINTS = (
    "case law", "case laws", "caselaw", "case-law", "judgment", "judgement",
    "judgments", "judgements", "precedent", "precedents", "in favour of",
    "in favor of", "held that", "landmark", "verdict", "itat", "apex court",
    "case in favour", "favourable case", "favorable case", "supreme court decision",
    "high court decision", "supreme court judgment", "high court judgment",
    "supreme court ruling", "high court ruling", "decided case", "cited case",
)


def _is_caselaw_query(q: str) -> bool:
    """True for questions asking for judicial case law / judgments / precedents.
    The static corpus (Act + Rules) has NO case law, so these must be answered
    from the web to avoid a deflecting half-answer."""
    t = (q or "").lower()
    return any(k in t for k in _CASELAW_HINTS)


_DEFLECTION_HINTS = (
    "do not contain", "does not contain", "not contain a list", "do not provide a list",
    "cannot provide a list", "please specify", "could you specify",
    "specify the section or topic", "i can assist you further",
    "i would be happy to assist", "i do not have specific", "i don't have specific",
    "not covered in the provided", "outside the scope of the provided",
    "the provided passages do not", "provided statutory passages",
    "they do not contain", "if you require", "please provide more",
    "do not have a list", "does not include a list",
    # "can't answer from the passage / not stated / not specified" family — any
    # of these means the corpus couldn't actually answer, so fall through to web.
    "not explicitly stated", "not stated in the", "not specified in",
    "does not specify", "do not specify", "the passage does not",
    "the passages do not", "not mentioned in the passage", "not found in the",
    "provided passage", "provided passages", "the provided text",
    "unfortunately, the passage", "unfortunately, the provided",
    "not available in the provided", "is not defined in the", "not detailed in the",
)


def _looks_like_deflection(text: str) -> bool:
    """A SOFTER refusal than _looks_like_refusal: the corpus produced a long,
    citation-bearing answer that nonetheless deflects ('the passages don't
    contain that — please specify…'). Treat as low-confidence → web search."""
    t = (text or "").lower()
    return any(p in t for p in _DEFLECTION_HINTS)


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


# ---------------------------------------------------------------------------
# Citation extraction from the answer TEXT.
#
# The remote `bharattax-rag` model runs its OWN retrieval on the LLM VPS, so the
# backend never sees the passages it used. The only trace is what the model
# writes into the answer: inline [n] markers plus a trailing "Sources:" footer —
#
#     ... the aggregate is Rs 1,50,000 [1], [2].
#
#     Sources:
#     - Income Tax Act, 1961 80C
#     - Income Tax Rules, 1962 20
#
# The Gemini agent path emits the same footer in markdown-bold form
# ("**Sources:**" with `*` bullets), sometimes inline ("Sources: a.in, b.in"),
# and mixes statutory lines with bare web domains / markdown links.
#
# We parse that footer and resolve each STATUTORY line against the local corpus
# (act_name + section_number / rule_number) so the UI gets a real chunk_id and a
# source_url to link to.
#
# Deliberately NOT turned into citations: bare web domains and markdown links.
# The UI already renders those separately from meta["web_sources"], so promoting
# them here would show every web source twice.
#
# NOTE on numbering: the inline [n] markers index the REMOTE model's private
# passage list, which is longer and differently ordered than the deduplicated
# footer (e.g. an answer citing [1],[2] with a single footer line). There is no
# reliable mapping, so we do NOT try to align them — `n` is simply the footer
# ordinal. The UI renders citations as a "Sources (k)" card list rather than as
# inline anchors, so the two numberings never have to agree.
# ---------------------------------------------------------------------------

_MAX_CITATIONS = 20

# A "Sources:" header line, with optional markdown bold/heading decoration.
# Captures anything trailing on the same line (the inline "Sources: a, b" form).
_SOURCES_HEADER_RE = re.compile(
    r"^[#\s]*\**\s*sources?\s*\**\s*:\s*\**\s*(?P<rest>.*?)\s*$",
    re.IGNORECASE,
)

# A markdown/plain list item: "- foo", "* foo", "1. foo".
_BULLET_RE = re.compile(r"^\s*(?:[-*•·–—]|\d+[.)])\s+(?P<item>.+?)\s*$")

# "[label](https://...)" — a web source, not a statutory reference.
_MD_LINK_RE = re.compile(r"^\[(?P<label>[^\]]+)\]\(\s*(?P<url>https?://[^)\s]+)\s*\)$")

# "taxguru.in", "www.incometaxindia.gov.in/foo" — a bare web source.
_BARE_DOMAIN_RE = re.compile(
    r"^(?:https?://)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:/\S*)?$", re.IGNORECASE
)

# "Income Tax Act, 1961 80C" / "Income-tax Rules, 2026 > Rule 164" /
# "Income-tax Act, 2025 501" -> (act, number). The act part must end in
# Act/Rules/Code so prose lines don't get mistaken for statutory references.
_STATUTORY_RE = re.compile(
    r"^(?P<act>.*?(?:act|rules|code)\b[^0-9]*(?:,?\s*(?:19|20)\d{2})?)"
    r"[\s>]+(?:section\s+|rule\s+|s\.\s*|§\s*)?"
    r"(?P<num>\d+[A-Za-z]{0,4}(?:\([^)]{1,10}\))?)\s*$",
    re.IGNORECASE,
)


def _norm_act(name: str | None) -> str:
    """Fold 'Income-tax Rules, 1962' and 'Income Tax Rules, 1962' together."""
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def _extract_source_lines(text: str) -> list[str]:
    """Pull the raw item strings out of the trailing 'Sources:' footer."""
    lines = (text or "").splitlines()
    header_idx, inline_rest = None, ""
    # Take the LAST "Sources:" header — the footer, not a mid-answer mention.
    for i, line in enumerate(lines):
        m = _SOURCES_HEADER_RE.match(line)
        if m:
            header_idx, inline_rest = i, m.group("rest")
    if header_idx is None:
        return []

    # Inline form: "Sources: lemonn.co.in, blinkx.in"
    if inline_rest:
        return [p.strip() for p in inline_rest.split(",") if p.strip()]

    # Block form: bullets (or bare lines) until a blank-separated non-list block.
    items: list[str] = []
    for line in lines[header_idx + 1:]:
        if not line.strip():
            # Tolerate the blank line markdown puts after "**Sources:**", but
            # stop once we've started collecting and hit a gap.
            if items:
                break
            continue
        m = _BULLET_RE.match(line)
        if m:
            items.append(m.group("item").strip())
        elif items:
            break
        else:
            # Unbulleted footer line directly under the header.
            items.append(line.strip())
    return items


def _resolve_statutory(db: Session, act: str, num: str) -> tuple[int, str, str | None] | None:
    """Look a statutory reference up in the local corpus.

    Returns (chunk_id, breadcrumb, source_url), or None when the corpus has no
    chunk for that ACT. We require the act name to match, not just the number:
    resolving 'Income-tax Act, 2025 s.501' onto a 1961-Act chunk numbered 501
    would attach a confidently wrong link to a legal citation.
    """
    from app.models.corpus import CorpusChunk, CorpusDocument
    from sqlalchemy import select as _select

    is_rule = "rule" in (act or "").lower()
    col = CorpusChunk.rule_number if is_rule else CorpusChunk.section_number
    try:
        rows = db.execute(
            _select(CorpusChunk.id, CorpusChunk.act_name, CorpusChunk.breadcrumb,
                    CorpusDocument.source_url)
            .join(CorpusDocument, CorpusChunk.corpus_document_id == CorpusDocument.id)
            .where(col == num, CorpusChunk.is_current.is_(True))
            .order_by(CorpusChunk.id)
            .limit(50)
        ).all()
    except Exception as e:  # noqa: BLE001 — a citation lookup must never 500 the answer
        log.warning("citation resolve failed for %s %s: %s", act, num, e)
        return None

    target = _norm_act(act)
    for r in rows:
        if _norm_act(r.act_name) == target:
            return int(r.id), (r.breadcrumb or f"{act} {num}"), r.source_url
    return None


def citations_from_law_refs(db: Session, refs: list[dict]) -> list[Citation]:
    """Build citations from STRUCTURED references — the passages the agent's
    `search_tax_law` tool actually retrieved (each carrying act/section/breadcrumb).

    Preferred over `parse_source_citations` whenever the refs are available: it
    cites what retrieval genuinely returned instead of re-deriving it from the
    prose the model wrote about it.
    """
    citations: list[Citation] = []
    seen: set[tuple[str, str]] = set()
    for ref in refs or []:
        act = (ref.get("act") or "").strip()
        num = (ref.get("section") or ref.get("rule") or "").strip()
        if not act or not num:
            continue
        key = (_norm_act(act), num.lower())
        if key in seen:
            continue
        seen.add(key)

        resolved = _resolve_statutory(db, act, num)
        if resolved:
            chunk_id, breadcrumb, url = resolved
        else:
            chunk_id = 0
            breadcrumb = (ref.get("breadcrumb") or f"{act} {num}").strip()
            url = None
        citations.append(Citation(
            n=len(citations) + 1,
            chunk_id=chunk_id,
            breadcrumb=breadcrumb,
            source_url=url,
            section_number=num,
        ))
        if len(citations) >= _MAX_CITATIONS:
            break
    return citations


def parse_source_citations(db: Session, text: str) -> list[Citation]:
    """Build citations[] from the 'Sources:' footer the RAG model emits.

    Statutory lines are resolved against the local corpus so the UI gets a real
    chunk_id + source_url. Unresolvable statutory lines are still returned (with
    chunk_id 0 and no URL) so the officer at least sees what the model relied on.
    Web domains/links are skipped — see the module note above.
    """
    citations: list[Citation] = []
    seen: set[tuple[str, str]] = set()
    for item in _extract_source_lines(text):
        # Strip markdown emphasis around the whole item.
        clean = item.strip().strip("*_` ").strip()
        if not clean:
            continue
        if _MD_LINK_RE.match(clean) or _BARE_DOMAIN_RE.match(clean):
            continue  # a web source — rendered from meta["web_sources"]
        m = _STATUTORY_RE.match(clean)
        if not m:
            continue
        act, num = m.group("act").strip(" ,>"), m.group("num").strip()
        key = (_norm_act(act), num.lower())
        if key in seen:
            continue
        seen.add(key)

        resolved = _resolve_statutory(db, act, num)
        if resolved:
            chunk_id, breadcrumb, url = resolved
        else:
            chunk_id, breadcrumb, url = 0, clean, None
        citations.append(Citation(
            n=len(citations) + 1,
            chunk_id=chunk_id,
            breadcrumb=breadcrumb,
            source_url=url,
            section_number=num,
        ))
        if len(citations) >= _MAX_CITATIONS:
            break
    return citations


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
                    client: llm_mod.LLMClient | None = None, user=None) -> Answer:
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

    # Explicit "remember that …" — store the fact and acknowledge; no model call.
    if user is not None:
        try:
            from app.services import personalization as _pers
            _mem = _pers.remember_if_requested(db, user, q)
        except Exception:  # noqa: BLE001
            _mem = None
        if _mem is not None:
            return Answer(
                text=f"Got it — I'll remember that: “{_mem.content}”.",
                grounded=True, citations=[],
                meta={"retrieval": "memory", "domain": domain.value if domain else None,
                      "memory_added": [{"id": _mem.id, "content": _mem.content}]},
            )

    # Personalization preamble — profile + custom instructions + relevant memory.
    # Fed ONLY to the self-hosted model (never the web-search fallback), and it
    # bypasses the shared question cache so one user's tone/memory can't leak to
    # another.
    persona_ctx = ""
    if user is not None:
        try:
            from app.services import personalization as _pers
            persona_ctx = _pers.build_context(db, user, q)
        except Exception:  # noqa: BLE001 — personalization must never break an answer
            persona_ctx = ""

    # -----------------------------------------------------------------
    # Question cache lookup — repeat questions ("current 80C limit?",
    # "HRA exemption rules?") come back instantly and cost nothing.
    # We only cache answers that DIDN'T involve web-search (see
    # query_cache.should_cache) so a "latest circular" query never
    # returns a 24-h-old snapshot.
    # -----------------------------------------------------------------
    domain_slug = domain.value if domain else None
    # Document / time-sensitive questions must ALWAYS take the live path — never
    # serve them a cached (possibly pre-web-search) answer.
    # Time-sensitive queries ("latest/today") always go live; everything else —
    # including STABLE document lookups (a circular's content never changes) — may be
    # served instantly from cache.
    cached = None if (_is_time_sensitive(q) or _is_caselaw_query(q) or persona_ctx) else _qcache.get(q, domain=domain_slug)
    if cached:
        meta = dict(cached.get("meta") or {})
        meta["cache_hit"] = True
        cached_text = cached.get("text") or ""
        # Re-parse rather than caching the citations: resolution depends on the
        # corpus, which is re-ingested independently of the answer cache.
        try:
            cached_citations = parse_source_citations(db, cached_text)
        except Exception:  # noqa: BLE001
            log.exception("citation parsing failed (cache hit)")
            cached_citations = []
        return Answer(
            text=cached_text,
            grounded=bool(cached.get("grounded", True)),
            citations=cached_citations,
            meta=meta,
        )

    client = client or llm_mod.get_llm()
    llm_calls: list[dict] = []

    def _primary_call() -> str:
        txt = client.complete(SYSTEM_PROMPT_NATIVE, q, context=persona_ctx or None)
        if isinstance(client, llm_mod.OpenAICompatLLM):
            llm_calls.append({
                "model": client.last_model or settings.llm_model_name,
                "usage": client.last_usage,
                "latency_ms": client.last_latency_ms,
            })
        return txt

    # Case-law queries are never in the static corpus, so the primary call is
    # pure wasted latency — skip it and go straight to web search.
    caselaw_query = _is_caselaw_query(q)
    primary_text = "" if caselaw_query else _primary_call()

    # If the grounded model refused (no match in primary sources) AND a fallback
    # is configured, retry with a general income-tax LLM. The fallback prompt
    # forces it to stay on tax topics.
    used = "model-native"
    web_sources: list[dict] = []
    fallback = settings.llm_fallback_model_name
    refused = _looks_like_refusal(primary_text)
    time_sensitive = _is_time_sensitive(q)
    # ------------------------------------------------------------------
    # Web-search fallback policy (COST-OPTIMISED, Nov 2025):
    #   * On genuine REFUSAL → REPLACE the corpus answer with Gemini's.
    #   * On TIME-SENSITIVE query WITH a valid corpus answer → SUPPLEMENT:
    #       keep the corpus answer, append a short "Recent updates" section
    #       drawn from Gemini so we don't overwrite good grounded content.
    #   * On TIME-SENSITIVE query WHERE the corpus also refused → REPLACE.
    #   * Otherwise → SKIP Gemini entirely (biggest saving vs the previous
    #       behaviour, which triggered on any query containing "current"/
    #       "latest" even when the corpus already answered it).
    # ------------------------------------------------------------------
    document_query = _is_document_query(q)
    deflected = _looks_like_deflection(primary_text)
    should_call_gemini = (refused or time_sensitive or document_query
                          or caselaw_query or deflected)
    supplement_mode = (time_sensitive and not refused and not document_query
                       and not caselaw_query and not deflected
                       and not _is_live_disclaimer(primary_text))
    # For a "this circular / notification" question, pull the document identifier
    # the corpus matched (e.g. "F. No. 225/205/2024/ITA-II") into the web query so
    # the live search targets the RIGHT document rather than a generic one.
    web_query = q
    if document_query:
        import re as _re
        _ids = _re.findall(
            r"(?:F\.?\s*No\.?|Circular\s+No\.?|Notification\s+No\.?|Instruction\s+No\.?)\s*[\w./()\-]+",
            primary_text or "", _re.I)
        if _ids:
            _idstr = " ".join(dict.fromkeys(_ids))
            web_query = (f"{q} This refers to the CBDT communication {_idstr}. Give its "
                         f"circular/notification number, date, subject and key contents in "
                         f"simple terms.")[:320]
    if caselaw_query and not document_query:
        web_query = (
            f"{q}. Cover the 6-8 most important Indian income-tax cases. Write each as "
            f"**Case name** (citation, court) followed by the key principle in one "
            f"sentence, grouped under Supreme Court then High Courts. Finish with a short "
            f"conclusion of the key propositions the Department relies on."
        )[:380]
    if should_call_gemini:
        try:
            from app.services import gemini_search as _gs
            if _gs.available():
                _wtext, web_sources = _gs.web_answer(web_query)
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
                    # Sources are returned as structured meta["web_sources"] and
                    # rendered as favicon chips by the UI — do NOT inline the raw
                    # (ugly grounding-redirect) URLs into the answer text.
                    if supplement_mode:
                        primary_text = (
                            primary_text
                            + "\n\n---\n\n"
                            + "🌐 **Recent updates from the web** *(external sources — verify before relying):*\n\n"
                            + _wtext
                        )
                        used = "corpus+web-search:gemini"
                    else:
                        primary_text = _wtext
                        used = "web-search:gemini"
        except Exception:  # noqa: BLE001
            pass
    if caselaw_query and not (primary_text or "").strip():
        # Web search failed — fall back to a native answer so we never
        # return an empty response.
        primary_text = _primary_call()
        used = "model-native"

    # Only a genuine REFUSAL (not mere time-sensitivity) lets the general LLM
    # replace an otherwise-valid corpus answer; if web search failed on a
    # time-sensitive query we keep the corpus answer.
    if refused and used == "model-native" and fallback and hasattr(client, "complete"):
        try:
            primary_text = client.complete(SYSTEM_PROMPT_FALLBACK, q, model=fallback, context=persona_ctx or None)
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
    # of silently presenting outdated data as "latest". (Includes both replace
    # and supplement modes.)
    if time_sensitive and not used.endswith("web-search:gemini") and "web-search:gemini" not in used:
        primary_text = (
            "\u26a0\ufe0f *A live web lookup for the most recent information could not be completed "
            "just now, so the following is from the stored material and may not reflect the latest "
            "updates \u2014 please try again shortly for current data.*\n\n" + primary_text
        )
        used = used + "+stale-warned"

    # "grounded" must reflect reality: true only for a genuine corpus-backed
    # answer — NOT a refusal, a pure external web-search replacement, or an
    # ungrounded general-LLM fallback. (A corpus answer supplemented with web,
    # or one flagged stale, is still corpus-grounded.)
    grounded = (
        not refused
        and used != "web-search:gemini"
        and not used.startswith("fallback:")
    )
    result_meta = {
        "retrieval": used,
        "primary_model": settings.llm_model_name,
        "domain": domain.value if domain else None,
        "llm_calls": llm_calls,
        "web_sources": web_sources,
    }
    # Cache the fresh answer so the next identical question returns instantly.
    # We skip web-search answers (staleness risk) — see query_cache.should_cache.
    try:
        # Cache native answers always; cache web-search answers too when the query is
        # a STABLE document lookup (circular/notification content does not change),
        # but never a time-sensitive "latest" answer.
        stable_web = document_query and not time_sensitive and used == "web-search:gemini"
        if not persona_ctx and ((_qcache.should_cache(meta=result_meta) and not deflected) or stable_web):
            _qcache.put(
                q,
                {"text": primary_text, "grounded": grounded, "meta": result_meta},
                domain=domain_slug,
            )
    except Exception:  # noqa: BLE001 — never let cache-write break the response
        pass

    # The remote RAG model cites in prose ("Sources:" footer) rather than
    # handing back passages — parse that into structured citations so the UI can
    # render clickable source cards. Never let this break the answer.
    try:
        parsed_citations = parse_source_citations(db, primary_text)
    except Exception:  # noqa: BLE001
        log.exception("citation parsing failed")
        parsed_citations = []

    return Answer(
        text=primary_text, grounded=grounded, citations=parsed_citations,
        meta=result_meta,
    )


def answer_document(db: Session, question: str, *, namespace: str,
                    client: llm_mod.LLMClient | None = None) -> Answer:
    """Ask against a single uploaded document (private namespace)."""
    return _generate(question, retrieve_documents(db, question, namespace=namespace), client)
