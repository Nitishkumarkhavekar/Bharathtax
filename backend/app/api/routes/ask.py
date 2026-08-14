"""Ask Bot route: ask the primary-law corpus, get a grounded, cited answer.
Every query is persisted and audit-logged."""
from __future__ import annotations

import logging
import os
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import Principal, client_meta, get_principal, require_license
from app.core.db import get_db
from app.models.org import User
from app.services import tokens
from app.services.quota import require_quota
from app.core.enums import Domain, QueryScope
from app.models.activity import Query
from app.schemas import AnswerResponse, AskRequest, CitationOut
from app.services import audit, capture, rag
from app.services import gemini_transport as _tx

router = APIRouter(prefix="/ask", tags=["ask"])
log = logging.getLogger(__name__)


# Anything raised by the LLM/Gemini path when the upstream is unreachable or
# broken. Not our bug — but we translate to a friendly 503 so the user isn't
# staring at "Internal Server Error".
_UPSTREAM_EXC = (
    httpx.HTTPStatusError,
    httpx.ConnectError,
    httpx.ReadError,
    httpx.RemoteProtocolError,
    httpx.TimeoutException,
    ConnectionError,
)


def _domain(value: str | None) -> Domain | None:
    if not value:
        return None
    try:
        return Domain(value)
    except ValueError:
        return None


# Per-document extract budget in characters. Longer docs are truncated
# so a single 500-page PDF can't blow the model's context. 120 000 chars
# is ~30 000 tokens — comfortably fits a 40-50 page sale deed, notice
# bundle, or property document in full, while leaving room for the
# composer's system prompt + response. Gemini flash-latest and 2.5-flash
# both accept 1M-token context, so this ceiling is generous but not
# reckless. The agent's search_my_documents tool remains available for
# anything even larger.
_ATTACHED_DOC_EXTRACT_CHARS = int(os.getenv("ATTACHED_DOC_EXTRACT_CHARS", "120000"))


# Follow-up phrasing that implies the user is referring to a prior turn's
# attachment. When we see any of these AND the current turn has no
# attachment, we auto-resolve to the most recently-attached doc(s) from
# the same chat's message history. Never respond "please re-attach" —
# the user expects the AI to remember the context they just discussed.
_PRIOR_CASE_HINTS = (
    # 'the above/previous/this X' references
    "in the above case", "the above case", "above case",
    "in the previous case", "the previous case", "previous case",
    "in this case", "this case", "that case",
    "in that case", "the case above", "the case you",
    "the case i uploaded", "the case i attached",
    "in the above document", "the above document", "above document",
    "the previous document", "in the previous document",
    "in this document", "this document", "the document above",
    "the document you", "the document i uploaded",
    "in this file", "this file", "from this file", "of this file",
    "the file above", "in the file above", "the file i uploaded",
    "the file i attached", "the attached file", "in the attached file",
    "the attached document", "in the attached document",
    "the deed above", "the notice above", "the order above",
    "the judgment above", "the judgement above",
    "in the pdf", "this pdf", "the pdf above",
    "same case", "same document", "same file", "same deed",
    "as discussed above", "from the above",
    "in the earlier case", "the earlier case",
    # 'give me...' and 'summarize...' that imply prior context
    "give me the important details", "give me all the details",
    "give me the details", "give me the important information",
    "give me all the information", "give me all the important information",
    "summarize this", "summarise this", "summarize the",
    "summarise the", "explain this", "explain the",
)


def _looks_like_prior_case_reference(question: str) -> bool:
    if not question:
        return False
    q = question.lower()
    return any(hint in q for hint in _PRIOR_CASE_HINTS)


def _prior_attached_doc_ids(db: Session, *, chat_id: int, user_id: int,
                            max_lookback_turns: int = 10) -> list[int]:
    """When the user references 'the above case / document' in a follow-up
    turn without re-attaching, look back at the chat's recent USER
    messages and return the doc_ids from the most-recent user message
    that had attachments.

    We prefer the MOST RECENT prior attachment because the user's
    'above' language points to the immediately-preceding context.
    """
    from app.models.chat import ChatMessage as _CM
    from sqlalchemy import select as _select
    if not chat_id:
        return []
    rows = list(db.scalars(
        _select(_CM)
        .where(_CM.chat_id == chat_id, _CM.user_id == user_id,
               _CM.role == "user")
        .order_by(_CM.id.desc())
        .limit(max_lookback_turns)
    ).all())
    for msg in rows:
        atts = (msg.meta or {}).get("attachments") or []
        ids = [int(a.get("docId")) for a in atts
               if a and a.get("docId") is not None]
        if ids:
            return ids
    return []
# Hard cap across ALL attached docs combined. Bumped 300k → 500k so a
# 5-doc turn with several large deeds (up to ~100k chars each after
# vision-OCR of a 20-25 MB Kannada PDF) actually fits without silent
# truncation of the later docs. Gemini flash accepts 1M token context;
# 500k chars = ~125k tokens, well within the model's window and still
# leaves ~875k tokens headroom for the composer prompt + answer.
_ATTACHED_DOCS_TOTAL_CHARS = int(os.getenv("ATTACHED_DOCS_TOTAL_CHARS", "500000"))


def _build_attached_context(db: Session, user_id: int,
                            doc_ids: list[int] | None) -> tuple[str, list[dict]]:
    """Fetch the extracted text of docs attached to this turn (verified to
    belong to the caller) and format it as a prefix block the agent will
    see BEFORE the user's question.

    Returns ``(prefix_text, doc_summaries)``. `prefix_text` is empty when
    no valid attachments are present. `doc_summaries` mirrors what was
    included so we can echo it into the answer meta / audit trail.

    Why prefix vs. tool-call: attaching a file is a strong user signal
    that THIS turn is about THIS document. Waiting for the agent to
    decide to call search_my_documents wastes a round-trip and often
    misses the doc entirely on short questions ("summarise this"). By
    prefixing the text we make the analysis unmistakable.
    """
    if not doc_ids:
        return "", []
    # Import lazily so the module still imports on installs where the
    # documents schema is optional (rare, but keeps ask.py resilient).
    from sqlalchemy import select
    from app.core.enums import DocumentStatus
    from app.models.documents import Document, DocumentChunk

    # Only include docs the caller owns — the frontend enforces this too,
    # but the check has to live server-side because the ids come from
    # user input.
    rows = db.scalars(
        select(Document).where(
            Document.id.in_(doc_ids),
            Document.owner_user_id == user_id,
        )
    ).all()
    if not rows:
        return "", []
    parts: list[str] = []
    summaries: list[dict] = []
    total = 0

    def _load_chunks(doc_id: int) -> list[str]:
        return list(db.scalars(
            select(DocumentChunk.text)
            .where(DocumentChunk.document_id == doc_id)
            .order_by(DocumentChunk.id.asc())
        ).all())

    # Shared deadline across ALL attached docs — this is the KEY change
    # for multi-doc uploads. Previously each doc had its own 600 s poll
    # window, so a 5-doc turn could wait 50 minutes in the worst case.
    # Now the entire /ask call has ONE 600 s ceiling. Docs already
    # indexed return instantly; the deadline only ticks against docs
    # still processing. Env-tunable via ATTACHED_DOC_POLL_MAX_S.
    _POLL_STEP_S = 1.0
    _POLL_MAX_S = int(os.getenv("ATTACHED_DOC_POLL_MAX_S", "600"))
    _shared_deadline = time.time() + _POLL_MAX_S

    for d in rows:
        # Stitch the document's chunks back together (ordered by id, which
        # matches upload order for the chunker). Truncate per-doc.
        chunk_rows = _load_chunks(d.id)
        # Adaptive wait for the background indexer. The old fixed 45 s
        # cap was too tight for the vision-heavy path — a bilingual BDA
        # sale deed can spend 60-90 s in Vertex vision OCR, and a
        # 20-page scanned corporate deed can go to 5-6 min. Rather than
        # give up and inject a placeholder into the prompt (which the
        # model reads verbatim and then apologises to the user for), we
        # poll as long as the DB says the doc is still `processing`, up
        # to the SHARED 600-s ceiling. If the status flips to `failed`
        # we bail immediately with a clear message the model can pass on.
        _deadline = _shared_deadline
        _doc_status = d.status
        while not chunk_rows and time.time() < _deadline:
            time.sleep(_POLL_STEP_S)
            db.expire_all()
            chunk_rows = _load_chunks(d.id)
            if chunk_rows:
                break
            # Re-read the parent doc's status — if the indexer errored
            # out, no amount of polling will save us; bail out fast.
            _fresh = db.get(Document, d.id)
            _doc_status = _fresh.status if _fresh else _doc_status
            if _doc_status == DocumentStatus.failed:
                break
        extract = " ".join((t or "").strip() for t in chunk_rows if t).strip()
        if not extract:
            # Chunking STILL not ready. We tell the model EXACTLY what
            # happened and what to say back — otherwise the composer
            # apologises for the failure with a generic "please re-upload"
            # boilerplate, which is the opposite of useful. The wording
            # here goes straight into the prompt so it must read as
            # instructions to the model, not to the user.
            if _doc_status == DocumentStatus.failed:
                _friendly_reason = ("could not be indexed — the extraction "
                                    "step raised an error")
                _user_msg = (
                    f"⚠️ **The uploaded file '{d.filename}' could not be "
                    f"processed.** The extraction step failed — the PDF may "
                    f"be corrupt, password-protected, or in an unsupported "
                    f"format. Please try re-uploading the file, or convert "
                    f"it to a different PDF format and try again."
                )
            else:
                _friendly_reason = (f"is still being indexed (background "
                                    f"extraction has not produced any "
                                    f"chunks yet after {_POLL_MAX_S}s)")
                _user_msg = (
                    f"⏳ **Your document '{d.filename}' is still being "
                    f"processed.** Large scanned or Kannada PDFs need "
                    f"per-page OCR which can take 3-8 minutes. The file "
                    f"IS indexing in the background right now — please "
                    f"wait 1-2 minutes and re-send your question. "
                    f"(If this message repeats after 10 minutes, the "
                    f"file may have failed silently — try uploading a "
                    f"smaller PDF or one already OCR'd.)"
                )
            parts.append(
                f"[SYSTEM NOTE — do NOT relay verbatim, but factor into your "
                f"answer: The attached file '{d.filename}' {_friendly_reason}. "
                f"Reply ONLY with this exact message and no other content: "
                f"'{_user_msg}']"
            )
            summaries.append({"id": d.id, "filename": d.filename,
                              "chars": 0, "truncated": False,
                              "status": str(_doc_status)})
            continue
        truncated = False
        if len(extract) > _ATTACHED_DOC_EXTRACT_CHARS:
            extract = extract[:_ATTACHED_DOC_EXTRACT_CHARS] + " …[truncated]"
            truncated = True
        remaining = _ATTACHED_DOCS_TOTAL_CHARS - total
        if remaining <= 0:
            summaries.append({"id": d.id, "filename": d.filename, "chars": 0,
                              "truncated": True, "skipped": True})
            continue
        if len(extract) > remaining:
            extract = extract[:remaining] + " …[truncated]"
            truncated = True
        parts.append(f"### Attached file: {d.filename}\n{extract}")
        summaries.append({"id": d.id, "filename": d.filename,
                          "chars": len(extract), "truncated": truncated})
        total += len(extract)
    if not parts:
        return "", summaries
    _multi_doc_hint = ""
    if len(parts) > 1:
        _multi_doc_hint = (
            f"\n\nMULTI-DOCUMENT CONTEXT: the user attached {len(parts)} "
            f"files this turn. Each is presented below under its own "
            f"'### Attached file:' heading. When you answer:\n"
            f"  • Treat each file INDIVIDUALLY first — do NOT merge facts "
            f"from different files unless the user explicitly asks for "
            f"cross-doc comparison.\n"
            f"  • When quoting a fact, name the source file "
            f"('per [filename], the consideration is Rs X') so the reader "
            f"can trace it back.\n"
            f"  • If files disagree (e.g. two deeds show different "
            f"amounts for what looks like the same property), FLAG the "
            f"discrepancy explicitly — do NOT silently pick one.\n"
            f"  • If the user asks a summary question ('give me the "
            f"important details'), produce a per-file summary in the "
            f"order the files appear, then any cross-file observations.\n"
        )
    prefix = (
        "ATTACHED FILE(S) FOR THIS TURN — the text BELOW is the FULL "
        "content of the document(s) the user uploaded inline with their "
        "question. THIS IS THE DOCUMENT ITSELF, not a snippet or a "
        "summary. Every fact you need to answer the user's question "
        "about the file — party names, PAN numbers, dates, consideration "
        "amounts, stamp duty, property description, boundaries, "
        "registration numbers, cheque / RTGS references, addresses — "
        "must be pulled verbatim from the block below.\n"
        "\n"
        "STRICT RULES for this answer:\n"
        "1. READ THE TEXT. It is right in front of you. Do NOT respond "
        "with ANY of these bail-out phrases (all are FORBIDDEN and trip "
        "an automatic critical warning): 'the text extract for the "
        "uploaded document is not stated in the provided text', 'I "
        "don\\'t have the document', 'the Sale Deed document has not "
        "been attached', 'the document has not been provided', 'please "
        "upload the document', 'please upload the Sale Deed', 'kindly "
        "upload', 'once you upload', 'without the document I cannot'. "
        "The text IS the document — its full content appears immediately "
        "after the STRICT RULES section under a '### Attached file:' "
        "header. Do NOT fall back to a generic 'here is how a sale deed / "
        "notice / TDS certificate is structured' template, 'illustrative "
        "scenarios', or 'example (illustrative calculation)' section "
        "when a real file is attached — that reads as a failure. If you "
        "cannot see the attached file text, re-scan the input; it is "
        "definitely there.\n"
        "2. USE ONLY the text below (and standard Indian tax-law "
        "knowledge for the legal analysis). Do NOT pull details from "
        "OTHER documents in the user's corpus, do NOT call "
        "search_my_documents, do NOT invent 'related documents' or "
        "'associated names' from cross-references. If a specific field "
        "genuinely isn't in the text below, either omit it or write one "
        "short line 'not stated in the document' — never a paragraph.\n"
        "3. NEVER mention 'OCR', 'OCR-extracted', 'text extraction', "
        "'scanned', 'scan quality', 'degraded', 'artifacts', 'font "
        "mapping', 'mojibake', 'illegible', 'certified legible copy', "
        "'character recognition', 'OCR Quality Notice', or ANY "
        "commentary about how the document was processed. The user sees "
        "a normal PDF; backend plumbing must never leak.\n"
        "4. Read Kannada / Devanagari / Tamil script (and mangled "
        "renderings of them) as best you can. If a specific value "
        "appears in either script or in mixed script, transcribe the "
        "value straight — no commentary on the script.\n"
        "5. NEVER INVENT VALUES. If a name, PAN, address, amount, "
        "date, or any other specific value is only partially readable "
        "in the text (e.g. fragments like '80.492, 13€ North, "
        "BENGALURU URBAN, 560057' where the street name is missing), "
        "quote ONLY the fragment you actually see and write "
        "'[remainder not clearly readable]' — do NOT fill the gap "
        "with a plausible-sounding neighbourhood, road, or name. It "
        "is FAR better to say 'address partially readable: No. 492, "
        "..., Bengaluru North - 560057' than to fabricate a specific "
        "locality that isn't in the source. Same for party names: if "
        "the text shows only 'Sri. O&cd BOwWoNn' after the parenthetical "
        "romanised name, report the parenthetical name and mark the "
        "unbracketed portion unreadable — do not smooth over it.\n"
        "6. STRUCTURE the answer to cover, in order (whichever apply): "
        "(a) 1-line executive summary, (b) Document & registration "
        "reference (doc no., dates, SRO), (c) Parties (Vendor / "
        "Purchaser / Witnesses — full name, PAN, Aadhaar, address), "
        "(d) Consideration & payment (figure in words + numbers, "
        "advance/balance breakup, cheque/RTGS refs), (e) Stamp duty & "
        "challan, (f) Property schedule (flat/plot/khata/survey, block, "
        "floor, area, boundaries N/S/E/W), (g) Special clauses actually "
        "present (SPA, encumbrance, prior title chain), (h) Income-tax "
        "implications (Sec 50C safe harbour, Sec 56(2)(x), Sec 194-IA "
        "threshold, Sec 269SS, capital-gain AY) — always tied back to "
        "the actual figures in the deed above.\n"
        "7. SEPARATE CLAIM TYPES — the reader is an ITO or CA who must "
        "audit your reasoning. Every substantive statement in the tax "
        "analysis must belong to ONE of these categories, and the "
        "reader must be able to tell which WITHOUT guessing:\n"
        "   (a) DOCUMENT FACT — begin with 'The deed states…' / 'The "
        "endorsement records…' / 'Per the attached file…'. Quote the "
        "specific figure, name, or clause. If a claim can't be traced "
        "back to a specific line of the attached file, it is NOT a "
        "document fact — do not label it as one.\n"
        "   (b) STATUTORY RULE — cite the exact Section (and sub-"
        "section / clause / proviso) of the Income-tax Act, 1961 or "
        "the relevant Rule of the Income-tax Rules, 1962. Format: "
        "'Section 194-IA(1) requires…' or 'Rule 30(2A) provides…'. "
        "If you cannot cite the exact section, say 'the general rule "
        "under the Act' and flag it as needing verification — do NOT "
        "invent a section number.\n"
        "   (c) CASE-LAW POSITION — cite only cases you are certain "
        "of. Format: 'CIT v. Kelvinator of India Ltd (2010) 320 ITR "
        "561 (SC)'. Include reporter, volume, page, and forum. If you "
        "do NOT have a verified citation, write 'the settled judicial "
        "view is…' WITHOUT a fake cite. NEVER invent case names, "
        "citation numbers, ITAT bench names, or years.\n"
        "   (d) ANALYSIS / CONCLUSION — your inference from the facts "
        "+ rules. Hedge in proportion to certainty:\n"
        "       • 'It follows that…' / 'The consequence is…' — well-"
        "supported by facts and clear statute;\n"
        "       • 'A defensible position is…' / 'It is arguable that…' "
        "— one of several reasonable views;\n"
        "       • 'Subject to verification, it appears…' — tentative;\n"
        "       Never state a legal conclusion as a certainty when the "
        "underlying facts are missing (e.g. do not conclude Sec 50C "
        "applicability if the Stamp Duty Value is not in the deed — "
        "say the SDV is not on record and the conclusion depends on it).\n"
        "   (e) ASSUMPTION — anything you introduced to bridge a gap "
        "in the source. All assumptions MUST be surfaced in an "
        "'Assumptions' section (see rule 8). Do NOT smuggle "
        "assumptions into the analysis prose without listing them.\n"
        "8. END WITH AN 'Assumptions & unverified points' SECTION when "
        "the tax analysis section is present. Bullet every: (i) fact "
        "you assumed because the document didn't state it (e.g. "
        "'Assumed FY of transfer is 2024-25 based on registration "
        "date 02/04/2024'); (ii) legal citation you gave from memory "
        "rather than from confirmed sources; (iii) figure derived by "
        "arithmetic (e.g. 'SDV back-computed as Rs 44,60,560 assuming "
        "5% Karnataka stamp-duty rate — verify with the actual e-"
        "stamp receipt'). If there are no assumptions and every cite "
        "is verified, write 'No assumptions — all conclusions are "
        "directly supported by the deed and cited statute.'\n"
        "9. NEVER OVER-CLAIM. If two statutory positions are both "
        "defensible (a common situation in India — e.g. Section 50C "
        "safe-harbour applicability to auction sales by government "
        "bodies), present both with the leading authority for each "
        "and let the reader choose. Do NOT pick one and hide the "
        "other.\n"
        "10. EVIDENCE STATUS TAGS — every substantive finding in the "
        "tax-implications section MUST carry one of these tags, "
        "immediately after the value:\n"
        "   🟢 Confirmed from document — the exact value is quoted in "
        "the source and can be read off directly.\n"
        "   🟡 Requires verification / inference — the value is derived "
        "by calculation, or is a general legal position that depends on "
        "facts not fully in the source.\n"
        "   🔴 Not available in document — the value is genuinely absent "
        "and must be sought from a different record.\n"
        "   Example: 'Consideration: Rs. 15,00,000 🟢 Confirmed from "
        "document (Clause 3, page 2). Stamp Duty Value (SDV): 🔴 Not "
        "stated in the deed — must be obtained from the Sub-Registrar's "
        "valuation record.'\n"
        "11. NEVER REVERSE-ENGINEER A CRITICAL TAX VALUE. If a critical "
        "value (SDV, guideline value, capital gains, TDS liability, "
        "exemption quantum) is not stated in the document, DO NOT back-"
        "compute it from a tangential figure without explicit basis in "
        "the source. Example of what NOT to do: 'Registration fee = "
        "Rs 1,33,241; assuming 1% rate → SDV ≈ Rs 1.33 crore'. The "
        "1% rate is one Karnataka rate among several; the fee itself "
        "does not conclusively establish SDV. Instead say: 'Registration "
        "fee is Rs 1,33,241 🟢. The exact SDV cannot be determined from "
        "this figure alone 🔴 — verification of the official stamp "
        "valuation record is required.' Reverse-engineering a value to "
        "complete the analysis is a HALLUCINATION in the professional "
        "sense and is explicitly forbidden.\n"
        "12. CONDITIONAL LEGAL LANGUAGE when a key fact is missing. Use "
        "'If X is established, then Y may apply' or 'Subject to "
        "verification of Z, the position is …' — NEVER a bare 'Y will "
        "apply' when the antecedent fact is 🟡 or 🔴. Bad: 'Section 50C "
        "is applicable.' Good: 'If the SDV is verified to exceed the "
        "110% safe-harbour of Rs 16,50,000, Section 50C may apply, "
        "subject to the assessee's right to seek a DVO reference under "
        "Section 50C(2).'\n"
        "13. 'Missing information / documents required' section is "
        "MANDATORY whenever any finding is 🟡 or 🔴. Bullet each missing "
        "item with the specific record that would resolve it. For a "
        "Sale Deed where SDV isn't stated, list: (a) official stamp "
        "valuation certificate / e-stamp receipt with adopted SDV; "
        "(b) Sub-Registrar's guidance-value statement for the specific "
        "location and asset type; (c) agreement-to-sell (if any) with "
        "its date, to check the Sec 50C(1) proviso; (d) prior title "
        "deed if the vendor acquired the asset by gift/inheritance "
        "(needed for indexed cost of previous owner under Sec 49(1)). "
        "Only skip this section when every finding is 🟢.\n"
        "14. CLARIFICATION REQUEST — if a critical fact is missing and "
        "the user might be able to supply it (or upload a follow-up "
        "document), END the answer with a single-paragraph 'Clarification "
        "needed' block asking for exactly what would unlock a firm "
        "conclusion. Example: 'To move from a conditional to a firm "
        "conclusion on Section 50C, please upload the stamp valuation "
        "statement or provide the SDV adopted by the Sub-Registrar.' "
        "Do NOT ask if all findings are 🟢.\n"
        "15. CONFIDENCE SCORE at the very end of the tax-implications "
        "section, as one line: 'Overall confidence: N% — [one-sentence "
        "reason].' The reason must reference the specific 🟡/🔴 items "
        "driving the uncertainty. If every finding is 🟢, use 'Overall "
        "confidence: 90%+ — all material facts are confirmed from the "
        "deed.' Never claim >70% when a material value carries a 🔴 tag.\n"
        + _multi_doc_hint
        + "\n"
        + "\n\n---\n\n".join(parts)
        + "\n\n---\n\nUSER QUESTION:\n"
    )
    return prefix, summaries


@router.post("", response_model=AnswerResponse)
def ask(body: AskRequest, request: Request,
        p: Principal = Depends(get_principal),
        _licensed: User = Depends(require_license),
        _quota: Principal = Depends(require_quota),
        db: Session = Depends(get_db)) -> AnswerResponse:
    started = time.monotonic()
    domain = _domain(body.domain)
    # Follow-up resolution: if the user asks about 'the above case' /
    # 'the above document' WITHOUT re-attaching, silently pull the last
    # attachment(s) from the same chat's history and use them as the
    # current turn's context. The user expects the AI to remember what
    # they just discussed — never respond 'please re-attach'.
    _effective_doc_ids = list(body.attached_document_ids or [])
    if (not _effective_doc_ids and body.chat_id is not None
            and _looks_like_prior_case_reference(body.question)):
        _resolved = _prior_attached_doc_ids(
            db, chat_id=body.chat_id, user_id=p.user.id)
        if _resolved:
            log.info("resolved 'above case' follow-up to doc_ids=%s from chat %s",
                     _resolved, body.chat_id)
            _effective_doc_ids = _resolved
    # Attached-file context: prefix the user's question with the extracted
    # text of any documents they uploaded inline this turn (or resolved
    # from the chat history above), so the agent analyses THIS file
    # rather than needing to guess or search for it.
    _attach_prefix, _attached = _build_attached_context(
        db, p.user.id, _effective_doc_ids,
    )
    _question_with_attach = (_attach_prefix + body.question) if _attach_prefix else body.question
    try:
        _use_agent = False
        _use_multi = False
        try:
            from app.services import agent as _agent
            _use_agent = _agent.enabled()
        except Exception:  # noqa: BLE001
            _use_agent = False
        _multi_available = False
        try:
            from app.services import multi_agent as _multi
            from app.services import query_router as _router
            # Multi-agent (3–6 Gemini calls) only for genuinely complex asks;
            # simple lookups fall through to the single grounded agent.
            _multi_available = _multi.enabled()
            _use_multi = _multi_available and _router.should_use_multi(body.question)
        except Exception:  # noqa: BLE001
            _use_multi = False
        if _use_agent:
            try:
                # Attached-file fast path (non-streaming twin of the
                # /ask/stream routing). Skips planner + researcher when
                # the primary evidence is the attached document itself.
                # Gated on `_multi_available` (composer lives in the
                # multi_agent module) NOT on `_use_multi` — the latter
                # also requires the query-complexity heuristic to say
                # 'complex', which shouldn't apply here: the file's
                # presence is the complexity signal, not the wording.
                _fast = bool(
                    _multi_available and _effective_doc_ids and _attached
                    and os.getenv("ATTACHED_FILE_FAST_PATH", "1").lower()
                    in ("1", "true", "yes")
                )
                if _fast:
                    # Prefer native-PDF read when the flag is on AND
                    # every attached doc is a PDF/image under the size
                    # cap. Falls back internally to attached_file_fast
                    # on any error.
                    _stream_fn_impl = _multi.answer_attached_file_stream
                    _native_kwargs = {}
                    if os.getenv("NATIVE_PDF_ENABLED", "0").lower() in ("1", "true", "yes"):
                        _stream_fn_impl = _multi.answer_native_pdf_stream
                        _native_kwargs = {"doc_ids": _effective_doc_ids}
                    _t, _am = "", {"used": "attached_file_fast"}
                    for _ev in _stream_fn_impl(
                        db, _question_with_attach, user_id=p.user.id,
                        chat_id=body.chat_id, domain=domain, **_native_kwargs,
                    ):
                        if "delta" in _ev:
                            _t += _ev["delta"]
                        elif "done" in _ev:
                            _am = _ev["done"]
                            _am.setdefault("used", "attached_file_fast")
                    # Prefer the done-event text (which may be prepended
                    # with a CRITICAL self-audit warning) over the
                    # concatenated deltas — the audit reorders the
                    # answer so the reader sees the warning first, and
                    # that reorder only lives in the done text.
                    if _am.get("text"):
                        _t = _am["text"]
                elif _use_multi:
                    _t, _am = _multi.answer_multi_agent(
                        db, _question_with_attach, user_id=p.user.id,
                        chat_id=body.chat_id, domain=domain,
                    )
                else:
                    _t, _am = _agent.answer_agentic(
                        db, _question_with_attach, user_id=p.user.id,
                        chat_id=body.chat_id, domain=domain,
                    )
                result = type("AgentResult", (), {})()
                # Cite what the agent's search_tax_law tool actually retrieved
                # (act/section per passage). Fall back to parsing the answer's
                # "Sources:" footer when the agent answered without that tool.
                try:
                    _cites = rag.citations_from_law_refs(db, _am.get("law_refs") or [])
                    if not _cites:
                        _cites = rag.parse_source_citations(db, _t)
                except Exception:  # noqa: BLE001
                    log.exception("citation parsing failed (agent path)")
                    _cites = []
                if _attached:
                    _am = dict(_am or {})
                    _am["attached_documents"] = _attached
                result.text, result.grounded, result.citations, result.meta = _t, True, _cites, _am
            except Exception as _ae:  # noqa: BLE001
                log.warning("agent failed, falling back to RAG: %s", _ae)
                result = rag.answer_question(db, _question_with_attach, domain=domain, user=p.user)
        else:
            result = rag.answer_question(db, _question_with_attach, domain=domain, user=p.user)
    except _UPSTREAM_EXC as e:
        log.warning("Ask Bot upstream error: %s", e)
        raise HTTPException(
            status_code=503,
            detail={
                "code": "llm_unavailable",
                "message": (
                    "The AI service is temporarily unavailable. Please try "
                    "again in a minute — if this keeps happening, contact your "
                    "administrator."
                ),
            },
        ) from e
    latency = int((time.monotonic() - started) * 1000)

    citations = [
        CitationOut(n=c.n, chunk_id=c.chunk_id, breadcrumb=c.breadcrumb,
                    source_url=c.source_url, section_number=c.section_number,
                    digest=c.digest, sections_cited=c.sections_cited)
        for c in result.citations
    ]
    q = Query(
        user_id=p.user.id, wing_id=p.user.wing_id, scope=QueryScope.corpus,
        domain=body.domain, question=body.question, answer=result.text,
        citations=[c.model_dump() for c in citations],
        retrieval_meta={**result.meta, "grounded": result.grounded}, latency_ms=latency,
    )
    db.add(q)
    db.commit()
    # Optionally persist this turn into a server-owned chat conversation (only
    # if the chat belongs to this user — otherwise silently skip, never leak).
    if body.chat_id is not None:
        from app.models.chat import Chat, ChatMessage
        chat = db.get(Chat, body.chat_id)
        if chat is not None and chat.user_id == p.user.id:
            _user_meta = {"attachments": body.attachments_meta} if body.attachments_meta else {}
            um = ChatMessage(chat_id=chat.id, user_id=p.user.id, role="user",
                             content=body.question, meta=_user_meta)
            am = ChatMessage(chat_id=chat.id, user_id=p.user.id, role="assistant",
                             content=result.text,
                             citations=[c.model_dump() for c in citations],
                             meta={"grounded": result.grounded, **(result.meta or {})})
            db.add(um)
            db.add(am)
            if chat.title == "New chat":
                chat.title = (body.question.strip()[:60]) or chat.title
            db.commit()
            # Per-chat semantic memory (best-effort; never breaks the response).
            try:
                from app.services import chat_memory as _mem
                _mem.remember(db, chat_id=chat.id, user_id=p.user.id, message_id=um.id,
                              role="user", content=body.question)
                _mem.remember(db, chat_id=chat.id, user_id=p.user.id, message_id=am.id,
                              role="assistant", content=result.text)
                _mem.maybe_summarize(db, chat_id=chat.id, user_id=p.user.id)
            except Exception:  # noqa: BLE001
                pass
    # Book the LLM token spend against this user for each underlying model call
    # (primary bharattax-rag, plus the optional llama fallback).
    for call in (result.meta.get("llm_calls") or []):
        tokens.record(
            db,
            user_id=p.user.id,
            action="ask",
            model=call.get("model"),
            usage=call.get("usage"),
            latency_ms=call.get("latency_ms"),
        )
    audit.log_event(db, action="ask", user_id=p.user.id, wing_id=p.user.wing_id,
                    resource_type="query", resource_id=str(q.id),
                    query_text=body.question, **client_meta(request))
    try:
        capture.log_event("chat", task="chat.ask", user_id=p.user.id,
                          user_prompt=body.question, response=result.text,
                          meta={"domain": body.domain, "grounded": result.grounded,
                                "citations": [c.model_dump() for c in citations],
                                "llm_calls": result.meta.get("llm_calls")})
    except Exception:  # noqa: BLE001
        pass
    return AnswerResponse(
        query_id=q.id, scope=QueryScope.corpus, grounded=result.grounded,
        answer=result.text, citations=citations, meta=result.meta, latency_ms=latency,
    )


@router.post("/stream")
def ask_stream(body: AskRequest, request: Request,
               p: Principal = Depends(get_principal),
               _licensed: User = Depends(require_license),
               _quota: Principal = Depends(require_quota),
               db: Session = Depends(get_db)) -> StreamingResponse:
    """Server-Sent-Events streaming answer. Runs the SAME tool-calling agent as
    POST /ask (corpus + case law + web + citations), but streams it: a 'status'
    event while each tool runs, 'delta' events as the final answer generates, and
    a 'done' event carrying citations + meta. Persists the turn at the end.
    Scoped to the caller; falls back to the non-streaming pipeline if needed."""
    import json as _json

    question = body.question
    chat_id = body.chat_id
    uid, wing = p.user.id, p.user.wing_id
    domain = _domain(body.domain)
    user = p.user
    # We defer `_build_attached_context` into the SSE generator (below)
    # so we can emit a live "Reading your document…" status BEFORE the
    # OCR/chunk wait. Otherwise the client sees a bland "Thinking…" for
    # 30-60 s on a big scanned PDF. Populated when _gen() first runs.
    _attach_state: dict = {"prefix": "", "attached": [], "question": question}

    def _sse(obj: dict) -> str:
        return "data: " + _json.dumps(obj) + "\n\n"

    def _cit_out(cits) -> list[CitationOut]:
        return [CitationOut(n=c.n, chunk_id=c.chunk_id, breadcrumb=c.breadcrumb,
                            source_url=c.source_url, section_number=c.section_number,
                            digest=c.digest, sections_cited=c.sections_cited) for c in cits]

    def _persist(answer: str, grounded: bool, meta: dict, cit_out: list[CitationOut]) -> None:
        cits = [c.model_dump() for c in cit_out]
        try:
            db.add(Query(user_id=uid, wing_id=wing, scope=QueryScope.corpus,
                         domain=body.domain, question=question, answer=answer, citations=cits,
                         retrieval_meta={**(meta or {}), "grounded": grounded, "streamed": True},
                         latency_ms=None))
            db.commit()
            if chat_id is not None:
                from app.models.chat import Chat, ChatMessage
                chat = db.get(Chat, chat_id)
                if chat is not None and chat.user_id == uid:
                    # Stamp the attachment metadata on the user turn so the
                    # chip renders after a chat switch / reload. The
                    # `attachments_meta` list comes straight from the
                    # composer and only contains display-safe fields
                    # (filename, contentType, size, tiny preview data URL).
                    _user_meta = {"attachments": body.attachments_meta} if body.attachments_meta else {}
                    db.add(ChatMessage(chat_id=chat.id, user_id=uid, role="user",
                                       content=question, meta=_user_meta))
                    db.add(ChatMessage(chat_id=chat.id, user_id=uid, role="assistant", content=answer,
                                       citations=cits, meta={"grounded": grounded, "streamed": True,
                                                             **(meta or {})}))
                    if chat.title == "New chat":
                        chat.title = (question.strip()[:60]) or chat.title
                    db.commit()
                    try:
                        from app.services import chat_memory as _mem
                        _mem.remember(db, chat_id=chat.id, user_id=uid, message_id=None,
                                      role="user", content=question)
                        _mem.remember(db, chat_id=chat.id, user_id=uid, message_id=None,
                                      role="assistant", content=answer)
                    except Exception:  # noqa: BLE001
                        pass
        except Exception:  # noqa: BLE001
            db.rollback()
        for call in (meta or {}).get("llm_calls") or []:
            try:
                tokens.record(db, user_id=uid, action="ask", model=call.get("model"),
                              usage=call.get("usage"), latency_ms=call.get("latency_ms"))
            except Exception:  # noqa: BLE001
                pass

    def _gen():
        # Follow-up resolution: 'in the above case / document' with no
        # current attachment → pull the last attachment from the chat
        # history and use it silently. The user never sees a 'please
        # re-attach' message.
        _effective_doc_ids = list(body.attached_document_ids or [])
        if (not _effective_doc_ids and chat_id is not None
                and _looks_like_prior_case_reference(question)):
            _resolved = _prior_attached_doc_ids(
                db, chat_id=chat_id, user_id=uid)
            if _resolved:
                log.info("stream: resolved 'above case' follow-up to "
                         "doc_ids=%s from chat %s", _resolved, chat_id)
                _effective_doc_ids = _resolved
                # Emit a small status so the user sees we're re-using
                # the prior attachment
                yield _sse({"status":
                            "Recalling the document from earlier in this chat…"})
        # If the user attached files this turn (or we resolved from
        # history), tell them we're reading BEFORE the (potentially
        # 30-60 s) OCR wait so the UI doesn't look hung.
        if _effective_doc_ids and not _effective_doc_ids == []:
            if not (chat_id is not None and _looks_like_prior_case_reference(question) and not body.attached_document_ids):
                yield _sse({"status": "Reading your document(s)…"})
        _prefix, _att = _build_attached_context(
            db, uid, _effective_doc_ids,
        )
        _attach_state["prefix"] = _prefix
        _attach_state["attached"] = _att
        q_with_attach = (_prefix + question) if _prefix else question

        use_agent = False
        use_multi = False
        multi_available = False
        try:
            from app.services import agent as _agent
            use_agent = _agent.enabled()
        except Exception:  # noqa: BLE001
            use_agent = False
        try:
            from app.services import multi_agent as _multi
            from app.services import query_router as _router
            multi_available = _multi.enabled()
            use_multi = multi_available and _router.should_use_multi(question)
        except Exception:  # noqa: BLE001
            use_multi = False

        if use_agent:
            from app.services import agent as _agent
            # Attached-file fast path: when the user attached a document,
            # the file text IS the primary evidence and the planner /
            # coverage / researcher chain adds ~15-25s without changing
            # the answer. Route straight to the composer. Requires the
            # composer (multi_agent module) to be available, NOT the
            # full multi-agent complexity heuristic — an attached file
            # IS the complexity signal.
            _use_attached_fast = bool(
                multi_available
                and _attach_state["attached"]
                and os.getenv("ATTACHED_FILE_FAST_PATH", "1").lower() in ("1", "true", "yes")
            )
            if _use_attached_fast:
                # Native-PDF read is a further optimization on the
                # attached-file fast path — one Vertex call with the PDF
                # inline, no OCR pipeline. Gated on NATIVE_PDF_ENABLED.
                # Falls back internally if any prerequisite fails.
                if os.getenv("NATIVE_PDF_ENABLED", "0").lower() in ("1", "true", "yes"):
                    def _stream_fn(db, q, *, user_id, chat_id, domain):
                        return _multi.answer_native_pdf_stream(
                            db, q, user_id=user_id,
                            doc_ids=_effective_doc_ids or [],
                            chat_id=chat_id, domain=domain,
                        )
                else:
                    _stream_fn = _multi.answer_attached_file_stream
            elif use_multi:
                _stream_fn = _multi.answer_multi_agent_stream
            else:
                _stream_fn = _agent.answer_agentic_stream
            full, meta = "", {}
            try:
                for ev in _stream_fn(db, q_with_attach, user_id=uid,
                                     chat_id=chat_id, domain=domain):
                    if "delta" in ev:
                        full += ev["delta"]
                        yield _sse({"delta": ev["delta"]})
                    elif "status" in ev:
                        yield _sse({"status": ev["status"]})
                    elif ev.get("reset"):
                        full = ""
                        yield _sse({"reset": True})
                    elif "clarify" in ev:
                        clr = ev["clarify"]
                        cq = (clr.get("question") or "").strip()
                        yield _sse({"reset": True})
                        yield _sse({"delta": cq})
                        _persist(cq, True, {"clarify": clr}, [])
                        yield _sse({"done": True, "grounded": True, "citations": [],
                                    "meta": {"clarify": clr}})
                        return
                    elif "done" in ev:
                        meta = ev["done"] or {}
                        full = (meta.get("text") or full).strip()
                try:
                    cites = rag.citations_from_law_refs(db, meta.get("law_refs") or [])
                    if not cites:
                        cites = rag.parse_source_citations(db, full)
                except Exception:  # noqa: BLE001
                    log.exception("stream citation parse failed")
                    cites = []
                cit_out = _cit_out(cites)
                meta_out = {k: v for k, v in (meta or {}).items() if k != "text"}
                if _attach_state["attached"]:
                    meta_out["attached_documents"] = _attach_state["attached"]
                _persist(full, True, meta_out, cit_out)
                yield _sse({"done": True, "grounded": True,
                            "citations": [c.model_dump() for c in cit_out], "meta": meta_out})
                return
            except Exception as e:  # noqa: BLE001
                log.warning("agent stream failed: %s", e)
                if full:  # already streaming — close it out rather than restart
                    _persist(full, True, meta, [])
                    yield _sse({"done": True, "grounded": True, "citations": [], "meta": {}})
                    return
                # else fall through to the non-streaming pipeline

        # Fallback (agent disabled, or it failed before emitting anything): run the
        # real RAG pipeline and deliver it as a single delta so the UI still works.
        try:
            res = rag.answer_question(db, q_with_attach, domain=domain, user=user)
        except _UPSTREAM_EXC:
            yield _sse({"error": "The AI service is temporarily unavailable."})
            yield _sse({"done": True, "grounded": False, "citations": [], "meta": {}})
            return
        cit_out = _cit_out(res.citations)
        _persist(res.text, res.grounded, res.meta, cit_out)
        yield _sse({"delta": res.text})
        yield _sse({"done": True, "grounded": res.grounded,
                    "citations": [c.model_dump() for c in cit_out], "meta": res.meta})

    return StreamingResponse(_gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


class _FollowupsRequest(BaseModel):
    question: str
    answer: str
    domain: str | None = None


@router.get("/starters")
def ask_starters(p: Principal = Depends(get_principal)) -> dict:
    """Rotating 'suggested starter' questions for the empty chat screen — a
    shuffled mix of today's trending topics and evergreen questions, so the same
    six do not appear on every visit. Fail-open: [] on any error."""
    try:
        from app.services import starters as _st
        return {"starters": _st.get_starters(6)}
    except Exception:  # noqa: BLE001
        return {"starters": []}


@router.post("/followups")
def ask_followups(body: _FollowupsRequest,
                  p: Principal = Depends(get_principal),
                  _quota: Principal = Depends(require_quota),
                  db: Session = Depends(get_db)) -> dict:
    """Return 3 short, topic-relevant follow-up questions for the last Q&A, so the
    UI can offer them as one-tap suggestions. Best-effort + cheap (flash-lite);
    returns [] on any failure so it never blocks the chat."""
    import os as _os
    import json as _json

    # Legacy gate checked GEMINI_API_KEY, which is only set for the AI Studio
    # backend. On Vertex the auth is a service-account JSON, so the AI-Studio
    # check silently returned []. Use the transport's own availability probe
    # instead — it's true for both backends.
    if not _tx.available() or not (body.question or "").strip():
        return {"suggestions": []}
    model = _os.getenv("GEMINI_FOLLOWUP_MODEL", "gemini-flash-latest")
    prompt = (
        f"A tax officer asked: {body.question}\n"
        f"The assistant answered: {(body.answer or '')[:1400]}\n\n"
        "Suggest exactly 3 short, natural follow-up questions the officer would "
        "likely ask NEXT about this Indian income-tax topic. Each under 12 words, "
        "specific and useful. Return ONLY a JSON array of 3 strings."
    )
    try:
        r = httpx.post(
            _tx.url(model, "generateContent"),
            headers=_tx.headers(),
            # Vertex requires an explicit role on each content ("user" or
            # "model"); AI Studio accepted role-less content. Set it always
            # so both backends work.
            json={"contents": [{"role": "user", "parts": [{"text": prompt}]}],
                  # gemini-flash-latest is a 2.5 thinking model. Previous
                  # settings (budget=128, tokens=400) ran out of output
                  # tokens BEFORE the JSON array was fully emitted — the
                  # response was a fragment that failed JSON.loads and
                  # silently returned []. Budget 512 + tokens 800 gives
                  # room for the JSON while staying well under 1s wall.
                  "generationConfig": {"temperature": 0.4, "maxOutputTokens": 800,
                                       "responseMimeType": "application/json",
                                       "thinkingConfig": {"thinkingBudget": 512}}},
            timeout=12.0,
        )
        if r.status_code != 200:
            log.warning("followups HTTP %s: %s", r.status_code, r.text[:200])
            return {"suggestions": []}
        d = r.json()
        txt = "".join(pt.get("text", "") for pt in
                      ((d.get("candidates") or [{}])[0].get("content", {}) or {}).get("parts", []))
        # Master added token accounting for followups — keep it.
        um = d.get("usageMetadata") or {}
        try:
            tokens.record(db, user_id=p.user.id, action="followups", model=model,
                          usage={"prompt_tokens": um.get("promptTokenCount"),
                                 "completion_tokens": um.get("candidatesTokenCount"),
                                 "total_tokens": um.get("totalTokenCount")})
        except Exception:  # noqa: BLE001
            pass
        # Local branch added defensive JSON parsing — keep it too, since
        # thinkingBudget overflows sometimes emit prose instead of JSON.
        try:
            arr = _json.loads(txt)
        except Exception as e:  # noqa: BLE001
            import re as _re
            m = _re.search(r'\[[^\[\]]*\]', txt, _re.DOTALL)
            if m:
                try:
                    arr = _json.loads(m.group(0))
                except Exception:  # noqa: BLE001
                    log.warning("followups JSON parse failed: %s | text=%r", e, txt[:200])
                    return {"suggestions": []}
            else:
                log.warning("followups JSON parse failed: %s | text=%r", e, txt[:200])
                return {"suggestions": []}
        sugg = [str(x).strip() for x in arr if str(x).strip()][:3]
        log.info("followups: returning %d suggestions", len(sugg))
        return {"suggestions": sugg}
    except Exception as e:  # noqa: BLE001
        log.warning("followups exception: %s", e)
        return {"suggestions": []}


class _TranslateRequest(BaseModel):
    text: str
    lang: str  # target language name, e.g. "Hindi", "Tamil". "English" = no-op.


@router.post("/translate")
def ask_translate(body: _TranslateRequest,
                  p: Principal = Depends(get_principal),
                  _quota: Principal = Depends(require_quota),
                  db: Session = Depends(get_db)) -> dict:
    """On-demand translation of an answer into an Indian language. Section
    numbers, amounts, dates, case names and citations are preserved verbatim so
    the legal content stays exact. Fail-open: returns the original on any error."""
    import os as _os

    text = (body.text or "").strip()
    lang = (body.lang or "").strip()
    if not text or not lang or lang.lower() in ("english", "en"):
        return {"translated": text}
    # Gate on the active backend, not on GEMINI_API_KEY specifically —
    # on Vertex the API key is not used (OAuth via SA JSON) and requiring
    # it silently returned the untranslated English answer.
    if not _tx.available():
        return {"translated": text}
    model = _os.getenv("GEMINI_TRANSLATE_MODEL", "gemini-flash-latest")
    sys_p = (
        f"You are a precise legal translator. Translate the user's Indian income-tax "
        f"answer into {lang}. Rules: keep the meaning exact and natural; DO NOT "
        f"translate or alter section numbers, rule numbers, amounts, dates, "
        f"assessment years, PAN, case names, party names or citations — leave those "
        f"verbatim; preserve the markdown formatting and any [n] citation markers. "
        f"Translate the ENTIRE input from the first character to the last — do NOT "
        f"stop early, summarise, or skip any section. Output ONLY the translation, "
        f"no preamble."
    )
    # Devanagari / Kannada / Tamil scripts encode at 2-3× the tokens per
    # character vs Latin, so a 4 000-token English answer explodes to
    # 10 000+ output tokens in Hindi. 2 048 was truncating multi-section
    # legal answers around the "Legal Analysis" heading — the user saw
    # only the opening paragraph in the translated language. 16 384 is
    # gemini-flash-latest's practical ceiling and comfortably covers a
    # full Template-B opinion in any of the 22 scheduled languages.
    _max_out = int(_os.getenv("TRANSLATE_MAX_OUTPUT_TOKENS", "16384"))
    try:
        r = httpx.post(
            _tx.url(model, "generateContent"),
            headers=_tx.headers(),
            json={"systemInstruction": {"parts": [{"text": sys_p}]},
                  "contents": [{"role": "user", "parts": [{"text": text}]}],
                  # NB: drop thinkingConfig — gemini-flash-latest can 400 on
                  # thinkingBudget=0 for translate prompts. Auto is fine here.
                  "generationConfig": {"temperature": 0.1, "maxOutputTokens": _max_out}},
            timeout=90.0,
        )
        if r.status_code != 200:
            log.warning("translate HTTP %s", r.status_code)
            return {"translated": text}
        d = r.json()
        out = "".join(pt.get("text", "") for pt in
                      ((d.get("candidates") or [{}])[0].get("content", {}) or {}).get("parts", []))
        um = d.get("usageMetadata") or {}
        try:
            tokens.record(db, user_id=p.user.id, action="translate", model=model,
                          usage={"prompt_tokens": um.get("promptTokenCount"),
                                 "completion_tokens": um.get("candidatesTokenCount"),
                                 "total_tokens": um.get("totalTokenCount")})
        except Exception:  # noqa: BLE001
            pass
        return {"translated": out.strip() or text}
    except Exception:  # noqa: BLE001
        log.exception("translate failed")
        return {"translated": text}
