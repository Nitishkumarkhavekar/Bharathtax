"""Appeal-order drafting engine (BharatTax "Draft Bot").

Implements the officer's 6-module CIT(A)/NFAC workflow, GROUNDED on the primary-law
corpus via the existing hybrid retrieval (bge-m3 + reranker) and generated via the
existing LLMClient. Anti-hallucination is preserved: legal points cite only the
numbered passages handed to the model.
"""
from __future__ import annotations

import base64
import json
import re
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from difflib import SequenceMatcher

from sqlalchemy import desc, func, select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import SessionLocal
from app.core.enums import Domain
from app.core.logging import get_logger
from app.models.appeal import AppealCase, AppealDocument, AppealOutput, AppealRun
from app.models.org import User
from app.services import llm as llm_mod
from app.services import personalization
from app.services import prompt_guard as _pg


class _RunCancelled(Exception):
    """Raised inside the pipeline when a user hits /appeal/runs/{id}/cancel
    (or /cases/{cid}/stop). Caught by the outer except in run_case(), which
    then leaves the DB in the "Cancelled by user" state already set by the
    cancel endpoint instead of overwriting it with a generic error."""
    pass
from app.services import tokens
from app.services import capture
from app.services.retrieval import retrieve

log = get_logger(__name__)

import os as _os
from app.services.llm import OpenAICompatLLM as _OpenAICompatLLM
# Draft Bot needs an instruction-following model (bharattax-rag strips the module
# prompts and just does RAG). Route it to the raw model via the gateway.
_APPEAL_MODEL = _os.getenv("APPEAL_MODEL_NAME", "llama-3.1-8b-instruct")
_GEMINI_KEY = _os.getenv("GEMINI_API_KEY", "").strip()
_GEMINI_MODELS = [m.strip() for m in _os.getenv(
    "GEMINI_MODELS",
    # Flash-first: Pro is 3-4x slower and unnecessary for module-5 drafting on
    # already-retrieved law + facts. `gemini-2.5-flash` beats the `-latest`
    # alias on Vertex — the alias occasionally routes to a heavier model with
    # a warm-up penalty on cold shards, adding 15-30s per call. Pin the
    # specific 2.5-flash model as primary and use `-latest` only as fallback.
    "gemini-2.5-flash,gemini-flash-latest").split(",") if m.strip()]
# Separate model list for OCR-only extraction of scanned appeal PDFs. Extract
# is high-volume + low-reasoning, so we default to cheaper SKUs. Operators
# can set `GEMINI_OCR_MODELS` to e.g. "gemini-1.5-flash-8b" to cut spend ~3x
# on this line item.  Falls back to _GEMINI_MODELS if unset.
_GEMINI_OCR_MODELS = [
    m.strip() for m in _os.getenv("GEMINI_OCR_MODELS", "").split(",") if m.strip()
] or _GEMINI_MODELS
# JSON-mode extraction tier — Modules 1/2/3/4 emit structured JSON (deficiency
# check, scope, doc compliance, issue matrix). These are classification tasks
# that Flash-Lite handles cleanly at 3-5x the speed of Flash. Falls back to
# _GEMINI_MODELS if the operator hasn't tiered them out yet.
_GEMINI_JSON_MODELS = [
    m.strip() for m in _os.getenv("GEMINI_JSON_MODELS", "").split(",") if m.strip()
] or _GEMINI_MODELS
# With Gemini's ~1M-token context we can feed the figure-bearing documents whole
# instead of trimming them to fit an 8K window (the source of lost-detail errors).
_BIG_CTX = bool(_GEMINI_KEY)
# Gemini 2.5/3.x are "thinking" models: thinking tokens count against
# maxOutputTokens, so on a large context they can eat the whole budget and
# return EMPTY text. Disable thinking by default (still far stronger than 8B).
_THINK_BUDGET = int(_os.getenv("GEMINI_THINKING_BUDGET", "0"))
# Cap concurrent Gemini calls (across the parallel drafts of all in-flight runs
# in this worker process) so bursts stay within the API rate limit; excess calls
# wait on the semaphore rather than 429-storming.
_GEMINI_CONCURRENCY = int(_os.getenv("GEMINI_CONCURRENCY", "8"))
_GEMINI_SEM = threading.Semaphore(_GEMINI_CONCURRENCY)
_GEMINI_RETRIES = int(_os.getenv("GEMINI_RETRIES", "3"))


class GeminiLLM:
    """Google Gemini client exposing the same surface as OpenAICompatLLM
    (`complete` + `last_usage`/`last_model`/`last_latency_ms`). It walks a chain of
    models, falling back on 5xx/429/empty responses so a busy Pro model cannot
    stall a run, and supports guaranteed-JSON output via `json_mode`."""

    _BASE = "https://generativelanguage.googleapis.com/v1beta/models"

    def __init__(self, api_key: str, models: list[str]) -> None:
        self.api_key = api_key
        self.models = models or ["gemini-flash-latest"]
        self.model = self.models[0]
        self.last_usage = None
        self.last_model = None
        self.last_latency_ms = None

    def complete(self, system: str, user: str, *, model: str | None = None,
                 max_tokens: int | None = None, json_mode: bool = False,
                 files: list | None = None) -> str:
        import time
        import httpx
        chain = [model] if model else list(self.models)
        cfg = {"temperature": settings.llm_temperature,
               "maxOutputTokens": max_tokens or settings.llm_max_tokens,
               "thinkingConfig": {"thinkingBudget": _THINK_BUDGET}}
        if json_mode:
            cfg["responseMimeType"] = "application/json"
        parts = [{"text": user}]
        for mt, data in (files or []):
            parts.append({"inlineData": {"mimeType": mt,
                                         "data": base64.b64encode(data).decode()}})
        body = {"systemInstruction": {"parts": [{"text": system}]},
                "contents": [{"role": "user", "parts": parts}],
                "generationConfig": cfg}
        last_err = None
        for m in chain:
            for attempt in range(_GEMINI_RETRIES):
                self.last_usage, self.last_model, self.last_latency_ms = None, m, None
                t0 = time.time()
                try:
                    with _GEMINI_SEM:
                        with httpx.Client(timeout=httpx.Timeout(150.0)) as client:
                            from app.services import gemini_transport as _tx
                            r = client.post(_tx.url(m, "generateContent"),
                                            headers=_tx.headers(),
                                            json=body)
                    # transient -> back off and RETRY THE SAME (fast) model rather
                    # than dropping to the slower fallback model immediately.
                    if r.status_code == 429 or r.status_code >= 500:
                        last_err = f"{m} HTTP {r.status_code}"
                        time.sleep(min(1.5 * (2 ** attempt), 8.0))
                        continue
                    r.raise_for_status()
                    payload = r.json()
                    self.last_latency_ms = int((time.time() - t0) * 1000)
                    um = payload.get("usageMetadata") or {}
                    self.last_usage = ({"prompt_tokens": um.get("promptTokenCount"),
                                        "completion_tokens": um.get("candidatesTokenCount"),
                                        "total_tokens": um.get("totalTokenCount")} if um else None)
                    cands = payload.get("candidates") or []
                    if not cands:
                        last_err = f"{m} no candidates {str(payload.get('promptFeedback',''))[:120]}"
                        break  # not transient -> try next model
                    cparts = (cands[0].get("content") or {}).get("parts") or []
                    txt = "".join(pt.get("text", "") for pt in cparts).strip()
                    if not txt:
                        last_err = f"{m} empty (finish={cands[0].get('finishReason')})"
                        break  # not transient -> try next model
                    try:
                        capture.log_llm(system, user, txt, model=m,
                                        usage=self.last_usage, latency_ms=self.last_latency_ms)
                    except Exception:  # noqa: BLE001
                        pass
                    return txt
                except Exception as e:  # noqa: BLE001
                    last_err = f"{m} {type(e).__name__}: {e}"
                    time.sleep(min(1.5 * (2 ** attempt), 8.0))
                    continue
        raise RuntimeError(f"Gemini failed for {chain}: {last_err}")


def _local_llm():
    """The local OpenAI-compatible model (vLLM llama on the gateway), or None if
    no local backend is configured. Used as the automatic fallback when Gemini
    is out of credits / quota so the project keeps working."""
    if settings.llm_backend.lower() in ("openai", "vllm", "ollama") and settings.llm_base_url:
        return _OpenAICompatLLM(settings.llm_base_url, _APPEAL_MODEL, settings.llm_api_key)
    return None


# When Gemini fails with credit/quota exhaustion it can take ~40s to walk its
# retry chain before giving up. Once that happens, skip Gemini for a cooldown
# window and serve straight from the local model (~6s), re-probing Gemini after
# the window so service auto-resumes the moment credits are topped up.
_PRIMARY_COOLDOWN_S = int(_os.getenv("GEMINI_COOLDOWN_SECONDS", "120"))
_PRIMARY_DOWN_UNTIL = 0.0


class FallbackLLM:
    """Gemini-first client that transparently falls back to the local model on
    credit / quota exhaustion (HTTP 429 RESOURCE_EXHAUSTED, depleted prepay
    credits) or any other hard Gemini failure — so drafting and editing keep
    working when the Gemini bill runs dry. Mirrors the last-call telemetry of
    whichever client actually answered so token accounting still works."""

    def __init__(self, primary, secondary):
        self.primary = primary
        self.secondary = secondary
        self.last_usage = None
        self.last_model = None
        self.last_latency_ms = None

    def _mirror(self, c):
        self.last_usage = getattr(c, "last_usage", None)
        self.last_model = getattr(c, "last_model", None)
        self.last_latency_ms = getattr(c, "last_latency_ms", None)

    def _call(self, client, system, user, *, model, max_tokens, json_mode, files):
        if isinstance(client, GeminiLLM):
            out = client.complete(system, user, model=model, max_tokens=max_tokens,
                                  json_mode=json_mode, files=files)
        else:
            # local OpenAI-compat model: no json_mode / files support
            out = client.complete(system, user, model=None, max_tokens=max_tokens)
        self._mirror(client)
        return out

    def complete(self, system, user, *, model=None, max_tokens=None,
                 json_mode=False, files=None):
        global _PRIMARY_DOWN_UNTIL
        import time, logging
        log = logging.getLogger("appeal")
        want_primary = self.primary is not None and time.time() >= _PRIMARY_DOWN_UNTIL
        if want_primary:
            try:
                return self._call(self.primary, system, user, model=model,
                                  max_tokens=max_tokens, json_mode=json_mode, files=files)
            except Exception as e:  # noqa: BLE001
                if self.secondary is None:
                    raise
                _PRIMARY_DOWN_UNTIL = time.time() + _PRIMARY_COOLDOWN_S
                log.warning("Gemini failed (%s) — using local model and skipping "
                            "Gemini for %ss", type(e).__name__, _PRIMARY_COOLDOWN_S)
                return self._call(self.secondary, system, user, model=None,
                                  max_tokens=max_tokens, json_mode=False, files=None)
        # Gemini is in cooldown -> serve from local; if local is also down, give
        # Gemini one immediate chance rather than hard-failing.
        if self.secondary is not None:
            try:
                return self._call(self.secondary, system, user, model=None,
                                  max_tokens=max_tokens, json_mode=False, files=None)
            except Exception:  # noqa: BLE001
                if self.primary is None:
                    raise
                _PRIMARY_DOWN_UNTIL = 0.0
                return self._call(self.primary, system, user, model=model,
                                  max_tokens=max_tokens, json_mode=json_mode, files=files)
        return self._call(self.primary, system, user, model=model,
                          max_tokens=max_tokens, json_mode=json_mode, files=files)


def _appeal_llm():
    primary = GeminiLLM(_GEMINI_KEY, _GEMINI_MODELS) if _GEMINI_KEY else None
    secondary = _local_llm()
    if primary and secondary:
        return FallbackLLM(primary, secondary)
    if primary:
        return primary
    if secondary:
        return secondary
    return llm_mod.get_llm()

OFFICER_SYSTEM = (
    "You are an expert AI that drafts appellate orders under the Income-tax Act for the "
    "Commissioner of Income Tax (Appeals) / NFAC. You produce a DRAFT order only; the Commissioner "
    "applies independent mind before finalising. Write in formal CIT(A) style.\n"
    "STANCE — YOU ARE A NEUTRAL QUASI-JUDICIAL ADJUDICATOR, NOT THE APPELLANT'S ADVOCATE:\n"
    "- The Assessing Officer's order carries a presumption of correctness. The BURDEN is on the "
    "APPELLANT to demonstrate, on the material on record, that the AO erred in fact or in law.\n"
    "- Where the appellant has NOT discharged that burden — the record does not establish the AO "
    "was wrong, or the legal conditions for relief are not shown to be satisfied — the addition / "
    "disallowance is SUSTAINED and the ground is DISMISSED. Do NOT allow a ground merely because it "
    "is raised, plausibly worded, sympathetic, or unrebutted in the papers.\n"
    "- For EACH ground, first state what the applicable provision actually REQUIRES (the legal test), "
    "then check whether the facts on record satisfy each limb of that test, and decide accordingly. "
    "Relief follows only where BOTH the law and the record support it; give a reasoned Finding either "
    "way. Reserve 'Allowed'/'Partly Allowed' for grounds genuinely made out on law and evidence.\n"
    "STRICT RULES:\n"
    "- Use ONLY facts, dates, figures, names and jurisdiction that appear in the appeal documents. "
    "NEVER invent a date, amount, party name, ward/jurisdiction or case citation. If a detail is "
    "missing, write [not on record].\n"
    "- Cite a section/rule as [n] ONLY if it is quoted in the RETRIEVED LAW section, and name a "
    "judicial precedent ONLY if it appears in the RETRIEVED PRECEDENTS section or in the appeal "
    "documents (refer to a retrieved case as [C1], [C2] …). If neither was retrieved (or they are "
    "empty), do NOT use [n]/[C] citations and do NOT name any case law or section that is not in the "
    "documents; reason from the documents instead.\n"
    "- If a ground was withdrawn, not pressed, or the grievance was already rectified by the AO "
    "(e.g. a rectification order under section 154), say so and treat that ground as not pressed / "
    "infructuous; do NOT 'allow' it.\n"
    "- OUTPUT ONLY the order text. NEVER reproduce or restate these rules, or the words "
    "'CITATION RULES', 'RETRIEVED LAW', 'APPEAL DOCUMENTS', 'MODULE', or any '===' header."
)


_FENCE_ECHO_RE = re.compile(r"<<\s*/?\s*(?:END_)?UNTRUSTED[A-Z_]*\s*>>", re.I)


def _clean(text: str) -> str:
    """Strip prompt scaffolding the model may have echoed into its output,
    including any guard fence markers a malicious document could provoke."""
    t = _pg.scrub_meta_leak(_FENCE_ECHO_RE.sub("", text or ""))
    m = re.search(r"(?im)^\s*(citation rules|retrieved law\b|=+\s*retrieved law)", t)
    if m:
        t = t[:m.start()]
    t = re.sub(r"(?im)^\s*={2,}.*?={2,}\s*$", "", t)
    t = re.sub(r"(?im)^\s*module\s*\d[^\n]*$", "", t)
    return t.strip()

# --- document classification (filename + content heuristics) ---
_RULES = [
    ("form_35", r"form\s*no\.?\s*35|form 35|appeal to the commissioner"),
    ("grounds_of_appeal", r"grounds of appeal"),
    ("statement_of_facts", r"statement of facts"),
    ("written_submission", r"written submission|submission of the appellant"),
    ("remand_report", r"remand report"),
    ("additional_evidence", r"additional evidence|rule 46a"),
    ("demand_notice", r"demand notice|notice of demand|section 156|u/?s\s*156"),
    ("penalty_order", r"penalty order|order.{0,20}27[01]|271\(1\)\(c\)|imposing penalty"),
    ("assessment_order", r"assessment order|order u/?s\s*143|order under section 143|u/?s\s*143\(3\)|under section 14[47]"),
]
EXPECTED = ["assessment_order", "demand_notice", "form_35", "grounds_of_appeal",
            "statement_of_facts", "written_submission"]
GROUP = {"assessment_order": "Assessment Records", "demand_notice": "Assessment Records",
         "penalty_order": "Penalty Records", "form_35": "Appeal Documents",
         "grounds_of_appeal": "Appeal Documents", "statement_of_facts": "Appeal Documents",
         "written_submission": "Appeal Documents", "remand_report": "Appeal Documents",
         "additional_evidence": "Appeal Documents", "unclassified": "Unclassified"}

_ISSUE_PATTERNS = [
    ("Addition u/s 69A — unexplained money / investment", r"69a|unexplained (money|investment)"),
    ("Addition u/s 68 — unexplained cash credit / share capital", r"\b68\b|cash credit|share application|share capital"),
    ("Assessment framed u/s 144 without service of notice / breach of natural justice",
     r"without.{0,25}(the )?notice|natural justice|void.?ab.?initio|ex.?parte|not served"),
    ("Computation of total income / excessive demand", r"excessive demand|error in comput|computation sheet|erred in comput"),
    ("Disallowance u/s 37 — business expenditure", r"\b37\b|business promotion|disallow.*expens"),
    ("Disallowance u/s 14A r.w. Rule 8D", r"\b14a\b|rule 8d|exempt income"),
    ("Penalty u/s 270A — under-reporting / misreporting", r"270a|under-?reporting|misreporting"),
    ("Penalty u/s 271(1)(c) — concealment", r"271\(1\)\(c\)|concealment"),
    ("Condonation of delay u/s 249", r"condon|delay in filing"),
    ("Additional evidence under Rule 46A", r"46a|additional evidence"),
]


def classify(filename: str, text: str) -> str:
    fn = re.sub(r"[_\-]+", " ", filename).lower()
    for cat, pat in _RULES:
        if re.search(pat, fn, re.I):
            return cat
    hay = text[:1500].lower()
    for cat, pat in _RULES:
        if re.search(pat, hay, re.I):
            return cat
    return "unclassified"


# --- grounding + LLM helpers ---
def _ground(db: Session, query: str, *, domain: Domain | None = Domain.income_tax):
    """Return (context_text, citations) grounded on the primary-law corpus (the IT
    Act & Rules), fetched from the model gateway's /law endpoint so the drafter can
    reference actual sections when unsure instead of guessing. Falls back to the
    local corpus if the remote is unavailable."""
    import httpx
    passages = []
    try:
        r = httpx.post(settings.llm_base_url.rstrip("/") + "/law",
                       headers={"Authorization": f"Bearer {settings.llm_api_key}"},
                       json={"query": query, "k": 6}, timeout=20.0)
        if r.status_code == 200:
            passages = r.json().get("passages", []) or []
    except Exception:
        passages = []
    if passages:
        blocks, cites = [], []
        for p in passages:
            n = p.get("n")
            blocks.append(f"[{n}] ({p.get('breadcrumb', '')})\n{p.get('text', '')}")
            cites.append({"n": n, "breadcrumb": p.get("breadcrumb"),
                          "section_number": p.get("section"), "source_url": None,
                          "act": p.get("act")})
        return "\n\n".join(blocks), cites
    # fallback: local corpus (usually empty on the web VPS)
    try:
        local = retrieve(db, query, domain=domain).passages
    except Exception:
        local = []
    blocks, cites = [], []
    for i, lp in enumerate(local, start=1):
        blocks.append(f"[{i}] ({lp.breadcrumb})\n{lp.text}")
        cites.append({"n": i, "chunk_id": lp.chunk_id, "breadcrumb": lp.breadcrumb,
                      "section_number": lp.section_number, "source_url": lp.source_url})
    return ("\n\n".join(blocks) if blocks else "(no relevant primary law retrieved)"), cites


# How many decided cases to weigh per ground. Precedent grounding is what lets
# the drafter SUSTAIN or ALLOW a ground firmly (on real, matched case law) instead
# of hedging to a vague "partly allowed" — the fix for one-sided shell orders.
_PRECEDENT_K = int(_os.getenv("APPEAL_PRECEDENT_K", "4"))


def _precedent(db: Session, query: str, *, k: int = _PRECEDENT_K) -> tuple[str, list]:
    """Retrieve factually-similar DECIDED CASES from the case-law corpus (ITAT/HC/SC
    judgments) so a ground is weighed against real precedent — both the cases that
    support the AO's addition and those that support the appellant. Returns
    (precedent_block_text, citations); empty when nothing relevant is found, so the
    drafter falls back to statute + facts and names no case."""
    try:
        res = retrieve(db, query, domain=Domain.case_law)
    except Exception:  # embeddings/retrieval unavailable -> draft without precedent
        return "", []
    passages = [p for p in res.passages if (p.text or p.match_text)][:k]
    if not passages:
        return "", []
    blocks, cites = [], []
    for i, p in enumerate(passages, start=1):
        case = (p.breadcrumb or "Decided case").strip()
        held = (p.digest or "").strip()
        extract = _trim((p.text or p.match_text or "").strip(), 1100)
        line = f"[C{i}] {case}"
        if p.sections_cited:
            line += f"  (sections: {', '.join(str(s) for s in p.sections_cited[:6])})"
        if held:
            line += f"\nHeld: {held}"
        if extract:
            line += f"\nExtract: {extract}"
        blocks.append(line)
        cites.append({"n": f"C{i}", "type": "case", "case": case,
                      "breadcrumb": p.breadcrumb, "digest": held or None,
                      "sections_cited": p.sections_cited, "source_url": p.source_url,
                      "score": p.score})
    return "\n\n".join(blocks), cites


# The most recent LLM client used by _complete / _complete_json — kept as
# module-level state so `run_case()` can pluck the last call's `usage` and
# persist it into `token_usage` without threading a tuple through everything.
# Thread-local so parallel modules/grounds each track the client THEY used, and
# _last_llm_meta() bills the right call's tokens even under concurrency.
_LAST = threading.local()


def _sys(persona: str = "") -> str:
    """OFFICER_SYSTEM, optionally prefixed with a compact officer persona
    (letterhead/tone/house-style — never evidence). persona="" reproduces the
    original prompt exactly, so drafting is unchanged when nothing is set."""
    return (persona + "\n\n" + OFFICER_SYSTEM) if persona else OFFICER_SYSTEM


def _sec(persona: str = "") -> str:
    # Front every appeal LLM call with the instruction-hierarchy note so
    # document text inside <<UNTRUSTED_DOCUMENT>> fences is read as data, never
    # as commands. Kept out of _sys so _sys stays byte-for-byte (see tests).
    return _pg.INSTRUCTION_HIERARCHY_NOTE + "\n\n" + _sys(persona)


def _complete(user: str, *, max_tokens: int = 900, persona: str = "") -> str:
    # llama-3.1-8b-instruct on the gateway has a 6K context window; keep the
    # output budget low so the *input* prompt has room to fit the docs +
    # retrieved law. Pass a bigger max_tokens explicitly for assembly.
    client = _appeal_llm()
    _LAST.client = client
    out = client.complete(_sec(persona), user, max_tokens=max_tokens)
    # Never let an echoed fence marker or a leaked secret reach any output.
    return _pg.redact_output(_FENCE_ECHO_RE.sub("", out or ""))


def _last_llm_meta() -> dict | None:
    c = getattr(_LAST, "client", None)
    if not isinstance(c, (_OpenAICompatLLM, GeminiLLM, FallbackLLM)):
        return None
    return {
        "model": c.last_model or _APPEAL_MODEL,
        "usage": c.last_usage,
        "latency_ms": c.last_latency_ms,
    }


def _complete_json(user: str, *, max_tokens: int = 1500, persona: str = "") -> dict:
    # JSON-mode calls are extraction tasks — route them to the faster/cheaper
    # tier (Flash-Lite by default) via a dedicated client instance. Falls back
    # to the standard drafting client when GEMINI_JSON_MODELS is unset.
    if _GEMINI_KEY and _GEMINI_JSON_MODELS != _GEMINI_MODELS:
        _json_primary = GeminiLLM(_GEMINI_KEY, _GEMINI_JSON_MODELS)
        _json_local = _local_llm()
        client = FallbackLLM(_json_primary, _json_local) if _json_local else _json_primary
    else:
        client = _appeal_llm()
    _LAST.client = client
    if isinstance(client, (GeminiLLM, FallbackLLM)):
        txt = client.complete(
            _sec(persona) + "\n\nReturn ONLY a single valid JSON object.",
            user, max_tokens=max_tokens, json_mode=True)
    else:
        txt = client.complete(
            _sec(persona) + "\n\nRespond with ONLY a valid JSON object, no prose, no code fences.",
            user, max_tokens=max_tokens)
    txt = _pg.redact_output(_FENCE_ECHO_RE.sub("", txt or ""))   # strip any echoed fence/secret
    s = txt.strip()
    if s.startswith("```"):
        s = s.split("```", 2)[1]
        s = s[4:].strip() if s.startswith("json") else s.strip()
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        a, b = s.find("{"), s.rfind("}")
        if a != -1 and b > a:
            try:
                return json.loads(s[a:b + 1])
            except json.JSONDecodeError:
                return {}
        return {}


def _detect_issues(text: str) -> list[dict]:
    return [{"issue": name} for name, pat in _ISSUE_PATTERNS if re.search(pat, text, re.I)]


# General / reservation grounds that appear in almost every Form 35 but raise NO
# specific grievance to adjudicate — the appeal order must NOT record a finding on
# these (they are the source of the phantom "extra" ground the drafter used to add).
_BOILERPLATE_GROUND = re.compile(
    r"(?i)("
    r"craves?\s+leave|"
    r"leave\s+to\s+(add|alter|amend|modify|withdraw|raise|adduce)|"
    r"add[\s,]+alter[\s,]+amend|alter[\s,]+amend|amend[\s,]+or\s+withdraw|"
    r"reserve[sd]?\s+.{0,25}\bright\s+to\s+(add|amend|alter|raise)|"
    r"\bany\s+other\s+grounds?\b|"
    r"grounds?\b.{0,40}\bmay\s+be\s+(urged|added|raised|taken|adduced)"
    r")")


def _is_boilerplate_ground(g: str) -> bool:
    return bool(_BOILERPLATE_GROUND.search(g or ""))


def _raw_cat(case, *cats) -> str:
    """Raw (un-digested) text of the first document(s) in the given categories."""
    out = []
    for c in cats:
        for d in case.documents:
            if d.category == c and (d.text or "").strip():
                out.append(d.text)
    return "\n\n".join(out)


def _extract_case(case, docs_text: str, persona: str = "") -> dict:
    """Extract the appellant's REAL case — the numbered Grounds of Appeal from Form 35,
    the Statement of Facts and the written submissions — so the order addresses the
    actual grievances and never fabricates an issue. Reads the RAW Form 35 (grounds
    live near its end and would be lost in a digest)."""
    form35 = _raw_cat(case, "form_35", "grounds_of_appeal", "statement_of_facts")
    subs = _raw_cat(case, "written_submission")
    if form35 or subs:
        src = ("=== FORM 35 / STATEMENT OF FACTS ===\n" + _trim(form35, 22000 if _BIG_CTX else 11000) +
               "\n\n=== WRITTEN SUBMISSION ===\n" + _trim(subs, 16000 if _BIG_CTX else 5000))
    else:
        src = "=== APPEAL DOCUMENTS ===\n" + _trim(docs_text, 30000 if _BIG_CTX else 12000)
    j = _complete_json(
        "You are reading an income-tax appeal. Extract the appellant's case FAITHFULLY from the "
        "documents. The Grounds of Appeal come ONLY from the 'Grounds of Appeal' in FORM No. 35. "
        "Return ONLY JSON:\n"
        "- grounds: the array of the numbered substantive Grounds of Appeal EXACTLY as raised in the "
        "FORM No. 35 'Grounds of Appeal' — no more and no fewer. Copy the appellant's own grounds, "
        "condensed to ONE clear sentence each. STRICT RULES: (a) Take grounds ONLY from the Form 35 "
        "Grounds of Appeal list; do NOT create, infer, split, combine, or add ANY ground from the "
        "Statement of Facts, the assessment order, the written submissions, or your own reasoning. "
        "(b) EXCLUDE purely general or reservation grounds that raise no specific grievance — e.g. "
        "'the appellant craves leave to add / alter / amend / withdraw any ground of appeal', 'any "
        "other ground that may be urged at the time of hearing', or a bare 'the order is bad in law' "
        "stated only as a general catch-all. (c) If the Form 35 lists N substantive grounds, return "
        "EXACTLY those N — never invent an (N+1)th ground. If you cannot find the Form 35 grounds, "
        "return an empty grounds array rather than guessing.\n"
        "- facts: a faithful narrative of the facts (6-12 sentences): the assessment and its section; "
        "the income assessed; each addition with its EXACT amount and the section it was made/taxed "
        "under (e.g. 69A, 115BBE); the demand raised BEFORE and, if a rectification order under "
        "section 154 was passed, the reduced demand AFTER rectification (state both figures and the "
        "rectification date); service of notices; and whether the tax was paid. Use ONLY figures and "
        "facts stated in the documents; never round or invent an amount.\n"
        "- submissions: a faithful summary of the appellant's written submissions/arguments (6-12 "
        "sentences).\n"
        'Return {"grounds": ["..."], "facts": "...", "submissions": "..."}\n\n' + src,
        max_tokens=3500, persona=persona)
    if not isinstance(j, dict):
        j = {}
    grounds = [str(g).strip() for g in (j.get("grounds") or [])
               if str(g).strip() not in ("", "...")]
    # Drop general/reservation grounds ("craves leave to add/amend…", "any other
    # ground…") — these carry no specific grievance and must not get a finding.
    # This is the deterministic guard against the phantom extra ground.
    grounds = [g for g in grounds if not _is_boilerplate_ground(g)]
    # Deterministic date of institution = Form 35 e-verification date (falls back to
    # the appeal-fee payment date). The LLM sometimes mis-reads this, so anchor it.
    inst = ""
    mm = (re.search(r"verified\s+by[^\n]*?\bon\s+(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})", form35, re.I)
          or re.search(r"Form of Verification.*?Date\s*[:\-]?\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})",
                        form35, re.I | re.S)
          or re.search(r"Date of payment[^\n]*?(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})", form35, re.I))
    if mm:
        inst = mm.group(1)
    return {"grounds": grounds,
            "facts": (j.get("facts") or "").strip(),
            "submissions": (j.get("submissions") or "").strip(),
            "institution_date": inst}


_LEAD_HDR = re.compile(
    r"(?i)^\**\s*(discussion and findings|ground\s*no\.?\s*\d+|ground\s*\d+|issue)\b.*?$")


def _strip_finding_headers(block: str) -> str:
    """Drop any leading duplicate 'DISCUSSION AND FINDINGS' / 'Ground No. X' / 'Issue:'
    lines the model restates, so assemble() can add ONE clean ground heading."""
    lines = (block or "").split("\n")
    i = 0
    while i < len(lines):
        ln = lines[i].strip().strip("*").strip()
        if ln == "" or _LEAD_HDR.match(lines[i].strip()):
            i += 1
            continue
        break
    return "\n".join(lines[i:]).strip()


def _digest_one(filename: str, category: str, text: str) -> str:
    """Faithfully condense a large document so ALL files fit the model context."""
    text = (text or "").strip()
    if len(text) <= 3500:
        return text
    prompt = (
        "Summarise this appeal document into a faithful, concise digest for drafting a CIT(A) "
        "appellate order. Capture: the document type; all key dates; all figures (returned/assessed "
        "income, additions, demand, penalty); parties and jurisdiction; the AO's actions and "
        "findings; the appellant's arguments; and any case law or sections cited. Use ONLY facts "
        "present in the text; do not invent. About 200-300 words.\n\n"
        f"DOCUMENT '{filename}' (category: {category}):\n{text[:14000]}")
    try:
        return _appeal_llm().complete(
            "You are a precise legal analyst. Summarise faithfully; never invent facts.", prompt)
    except Exception:
        return text[:3500]


def _ocr_pdf(minio_key: str, filename: str) -> str:
    """Transcribe a document with Gemini's native PDF/document vision when its text
    layer is empty/garbled (a scan Tesseract could not read). Returns '' on failure."""
    if not _GEMINI_KEY or not minio_key:
        return ""
    try:
        from app.services.storage import get_bytes
        raw = get_bytes(minio_key)
    except Exception as e:  # noqa: BLE001
        log.warning("OCR: could not fetch %s: %s", filename, e)
        return ""
    if not raw:
        return ""
    try:
        # OCR runs on the cheaper `_GEMINI_OCR_MODELS` list (default: same as
        # drafting, but operators can point it at gemini-1.5-flash-8b to slash
        # extract cost ~3x — the transcription task doesn't need Pro-level
        # reasoning).
        llm = GeminiLLM(_GEMINI_KEY, _GEMINI_OCR_MODELS)
        txt = llm.complete(
            "You are a precise OCR and document-transcription engine.",
            "Transcribe ALL text from this document faithfully and completely. Preserve every "
            "figure, date, amount, name and section reference exactly. Render tables as readable "
            "lines. Output ONLY the transcribed text — no commentary, no markdown fences.",
            files=[("application/pdf", raw)], max_tokens=16000)
        return txt.strip()
    except Exception as e:  # noqa: BLE001
        log.warning("OCR: Gemini transcription failed for %s: %s", filename, e)
        return ""


def _docs_text(case: AppealCase, db: Session | None = None,
               max_chars: int = 44000 if _BIG_CTX else 20000) -> str:
    """Concatenated text of the case documents, capped to fit the appeal LLM's
    context window (llama-3.1-8b on the gateway = 6K tokens, ~24KB chars; we
    leave room for the system prompt, module instructions, retrieved law and
    the output). Pre-trims very long individual documents so we don't pack the
    whole budget into one assessment order.

    Digests are cached on `AppealDocument.digest`: an uploaded doc is immutable,
    so we compute its digest ONCE and reuse it on every subsequent run of the
    case. Only the not-yet-digested docs are sent to the LLM, in parallel. When
    `db` is provided the freshly-computed digests are persisted.
    """
    per_doc = 10**9  # digests are already condensed
    _docs = list(case.documents)
    need = [d for d in _docs if not (d.digest and d.digest.strip())]
    if need:
        _pctx = capture.get_context()
        def _digest_doc(d):
            try:
                capture.set_context(**_pctx)
            except Exception:  # noqa: BLE001
                pass
            return _digest_one(d.filename, d.category, _pg.sanitize_untrusted((d.text or "").strip())).strip()
        with ThreadPoolExecutor(max_workers=min(len(need), _GEMINI_CONCURRENCY)) as _ex:
            _bodies = list(_ex.map(_digest_doc, need))
        for d, body in zip(need, _bodies):
            d.digest = body or (d.text or "")
        if db is not None:
            try:
                db.commit()
            except Exception:  # noqa: BLE001 — caching is best-effort, never fail the run
                db.rollback()
    parts = []
    for d in _docs:
        body = _pg.sanitize_untrusted((d.digest or d.text or "").strip())
        if len(body) > per_doc:
            body = body[:per_doc] + "\n…[truncated]…"
        parts.append(f"===== {d.filename} (category: {d.category}) =====\n{body}")
    blob = "\n\n".join(parts)
    if len(blob) > max_chars:
        blob = blob[:max_chars] + "\n…[truncated]…"
    # Fence the whole document block as untrusted data (the _sys note tells the
    # model to read <<UNTRUSTED_DOCUMENT>> content as data, never as commands).
    return _pg.wrap_untrusted(blob, kind="document") if blob.strip() else blob


def _trim(s: str, n: int) -> str:
    return s if len(s) <= n else s[:n] + "\n…[truncated]…"


def _sample_text(text: str, *, target_chars: int = 3200) -> str:
    """A representative excerpt of a document: the whole thing if short, otherwise
    head + tail (key figures and dates cluster at the start; grounds and conclusions
    at the end), so a long file's salient parts survive the context budget."""
    text = (text or "").strip()
    if len(text) <= target_chars:
        return text
    head = target_chars * 2 // 3
    tail = target_chars - head
    return text[:head].rstrip() + "\n…\n" + text[-tail:].lstrip()


def _issue_doc_context(case: AppealCase, issue_text: str, *, max_chars: int = 24000) -> str:
    tokens = set(re.findall(r"[a-z0-9()/-]{3,}", issue_text.lower()))
    ranked: list[tuple[float, AppealDocument]] = []

    for doc in case.documents:
        hay = f"{doc.filename} {doc.category} {(doc.text or '')[:8000]}".lower()
        overlap = sum(1 for token in tokens if token in hay)
        fuzzy = SequenceMatcher(None, issue_text.lower(), hay[:400]).ratio()
        ranked.append((overlap + fuzzy, doc))

    ranked.sort(key=lambda item: item[0], reverse=True)
    chosen = [doc for score, doc in ranked if score > 0][:4] or [doc for _, doc in ranked[:3]]

    sections = []
    budget = max_chars
    for doc in chosen:
        excerpt = _sample_text(doc.text or "", target_chars=3200)
        if not excerpt:
            continue
        block = (
            f"===== {doc.filename} =====\n"
            f"Category: {doc.category}\n"
            f"Relevant Extract:\n{excerpt}"
        )
        if len(block) > budget and sections:
            break
        sections.append(block)
        budget -= len(block) + 2

    if not sections:
        return _docs_text(case, max_chars=max_chars)
    return "\n\n".join(sections)


def document_compliance(case: AppealCase) -> dict:
    present = {d.category for d in case.documents}
    return {
        "compliance_sheet": [{"filename": d.filename, "category": d.category,
                              "group": GROUP.get(d.category, "Unclassified"), "pages": d.pages,
                              "extracted_chars": len((d.text or "").strip())}
                             for d in case.documents],
        "missing": [c for c in EXPECTED if c not in present],
    }


# --- per-issue drafting (reused by run + regenerate) ---
def draft_issue(db: Session, case: AppealCase, issue: dict, persona: str = "") -> tuple[str, list]:
    q = issue.get("issue", "")
    docs_text = _issue_doc_context(case, q)
    ctx, cites = _ground(db, q, domain=None)   # statutes (Act & Rules)
    # Weigh the ground against REAL decided cases matched to this section + these
    # facts, so the finding can firmly SUSTAIN or ALLOW instead of hedging.
    prec_text, prec_cites = _precedent(db, f"{q}. {_trim(docs_text, 600)}")
    cites = list(cites) + list(prec_cites)
    user = (f"You are drafting the issue-wise DISCUSSION AND FINDINGS for ONE ground of a formal "
            f"CIT(A)/NFAC appellate order. This is a Government legal order: write in dignified, "
            f"formal legal English in FULL, well-reasoned PARAGRAPHS. Do NOT use one-line notes, "
            f"telegraphic fragments, or one-word conclusions. Under the labelled sub-parts "
            f"Facts / Submissions / AO's view / Legal position / Precedent / Analysis / Finding / "
            f"Decision, set out: (a) the material facts and figures; (b) the appellant's contentions "
            f"in substance; (c) the AO's stand; (d) the applicable statutory provisions, stating WHAT "
            f"THE PROVISION REQUIRES — the legal test and each of its limbs; (e) the RETRIEVED "
            f"PRECEDENTS below that bear on this ground — for each relevant one, state briefly what it "
            f"HELD, then either APPLY it (where its ratio, on these facts, supports the AO / the "
            f"addition) or DISTINGUISH it (where the facts materially differ), with reasons; weigh the "
            f"cases that favour the Revenue AND those that favour the appellant; (f) a reasoned "
            f"ANALYSIS that TESTS the appellant's contention against each limb of the statutory test "
            f"AND against the weight of that precedent, applying the settled BURDEN OF PROOF (the "
            f"appellant must establish the AO erred; where a limb is not satisfied on the record, that "
            f"point goes AGAINST the appellant); (g) a clear FINDING with reasons; and (h) a DECISION "
            f"stating the outcome and the reasons for it. "
            f"REACH A DEFINITE OUTCOME: SUSTAIN the AO's addition/disallowance and DISMISS the ground "
            f"where the statutory test and the weight of precedent are NOT displaced on the facts, or "
            f"ALLOW the ground where they genuinely are. Do NOT default to a vague compromise; use "
            f"'Partly Allowed' ONLY where the ground has distinct parts that are genuinely decided "
            f"differently, and state which part and why. Then give the Result "
            f"(Allowed / Partly Allowed / Dismissed / Set Aside) and specific, actionable Directions "
            f"to the AO. Each of Analysis, Finding and Decision must be a proper paragraph of several "
            f"sentences — never a bare word like 'Dismissed.'. "
            f"CITATION RULES: cite a statutory section/rule as [n] ONLY if it appears in the RETRIEVED "
            f"LAW below (do not cite one that is off-point for THIS ground). You MAY name a judicial "
            f"precedent ONLY if it appears in the RETRIEVED PRECEDENTS below (refer to it as [C1], "
            f"[C2] …) or was expressly cited by the appellant in the documents; NEVER invent, assume, "
            f"or name any other case. If the documents state the section under which an addition was "
            f"charged to tax (e.g. section 115BBE for an addition under section 69A), state that "
            f"charging section. State an amount, date or demand ONLY as it appears in the documents "
            f"(use the reduced figure if a section-154 rectification lowered it). Do NOT state that the "
            f"appellant paid or deposited the tax, and do NOT direct any refund, unless the documents "
            f"EXPLICITLY say the tax was paid. If this ground was rectified by the AO (e.g. via a "
            f"section-154 order) or was not pressed, say so and treat it as not pressed / infructuous "
            f"rather than allowing it. Do NOT repeat these section headers.\n\n"
            f"=== ISSUE ===\n{q}\n\n"
            f"=== APPEAL DOCUMENTS (facts) ===\n{_trim(docs_text, 22000 if _BIG_CTX else 7000)}\n\n"
            f"=== RETRIEVED LAW (statutes) ===\n{_trim(ctx, 3000)}\n\n"
            f"=== RETRIEVED PRECEDENTS (decided cases) ===\n"
            f"{prec_text or '(no closely matching precedent retrieved — decide on the statute and the facts on record; do NOT name any case.)'}")
    try:
        block = _complete(user, max_tokens=1600, persona=persona)
    except Exception as e:  # one issue must not fail the order
        block = f"_[Drafting failed for this issue: {type(e).__name__}. Retry.]_"
    return _clean(block), cites


def _parse_date(v: str):
    v = (v or "").strip()
    for fmt in ("%d.%m.%Y", "%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%d.%m.%y", "%d/%m/%y",
                "%d-%b-%Y", "%d %b %Y", "%d-%B-%Y", "%d %B %Y"):
        try:
            return datetime.strptime(v, fmt).date()
        except Exception:
            continue
    return None


def _build_intro(understanding: dict, docs_text: str, case=None) -> str:
    """Deterministic CIT(A)/NFAC introduction. Extracts the ASSESSMENT-order details
    and Form-35 dates, drops any date after filing (a section-154 rectification), and
    computes the delay in code. `case` supplies authoritative AY / section from the
    case record so the header isn't [not on record] when the documents don't restate it."""
    j = _complete_json(
        "From the appeal documents return ONLY JSON (use \"\" if not found; dates dd.mm.yyyy).\n"
        "- assessment_order_section: section of the ORIGINAL assessment / best-judgment order appealed "
        "(e.g. 144 or 143(3)); NOT a section 154 rectification.\n"
        "- assessment_order_date: date of that assessment order. It is EARLIER than any rectification "
        "and BEFORE the appeal filing date. Pick the earliest substantive order date that precedes "
        "the filing date.\n"
        "- ao: the AO's designation with ward (e.g. 'Income Tax Officer, Ward 28(1), Delhi'), not a "
        "person's name.\n"
        "- service_date: the date of service of the order declared in Form No. 35.\n"
        "- filing_date: the date the appeal was filed / instituted.\n"
        "- ay: the assessment year.\n"
        'Return {"assessment_order_section":"","assessment_order_date":"","ao":"","service_date":"",'
        '"filing_date":"","ay":""}\n\n=== APPEAL DOCUMENTS ===\n' + _trim(docs_text, 9000))
    if not isinstance(j, dict):
        j = {}
    def g(k):
        return (j.get(k) or "").strip()
    _case_ay = (getattr(case, "assessment_year", "") or "").strip()
    _case_sec = (getattr(case, "section", "") or "").strip()
    sec = g("assessment_order_section") or _case_sec or "[not on record]"
    order_date, service = g("assessment_order_date"), g("service_date")
    filing = (understanding.get("institution_date") or "").strip() or g("filing_date")
    ao = g("ao") or "the Assessing Officer"
    ay = g("ay") or _case_ay or "[not on record]"
    od, sd, fd = _parse_date(order_date), _parse_date(service), _parse_date(filing)
    # a date AFTER filing is a later (section-154) order, not the impugned one -> drop
    if fd and od and od > fd:
        od, order_date = None, "[not on record]"
    if fd and sd and sd > fd:
        sd, service = None, ""
    base = sd or od
    delay_txt = ""
    if base and fd:
        d = (fd - base).days
        if d > 30:
            delay_txt = (f" The date of service of the impugned order as declared in Form No. 35 is "
                         f"{service or order_date}. Thus, the institution of this appeal is delayed by "
                         f"{d} days, and condonation of the delay is required.")
        elif d >= 0:
            delay_txt = " The appeal has been filed within the period of limitation."
    return (f"This appeal has been instituted on {filing or '[not on record]'} against the order "
            f"passed under section {sec} of the Income-tax Act, 1961 dated "
            f"{order_date or '[not on record]'} by {ao} (hereinafter referred to as 'the AO') "
            f"for A.Y. {ay}.{delay_txt}")


def assemble(understanding: dict, findings_blocks: list[str], docs_text: str = "",
             intro: str | None = None, persona: str = "", case=None) -> str:
    """Stitch the drafted parts into a complete, properly-structured order. Grounds,
    Facts and Submissions sections are always populated; each finding gets ONE clean
    'Ground No. N' heading (leading duplicates stripped); the operative Result is
    concise and does not repeat the detailed directions. `intro` may be precomputed
    (built concurrently with the findings) to keep it off the critical path."""
    grounds = understanding.get("grounds", []) or []
    grounds = [re.sub(r"^\s*\d+[.)]\s*", "", (g or "").strip()) for g in grounds if (g or "").strip()]
    facts = (understanding.get("facts", "") or "").strip()
    submissions = (understanding.get("appellant_submissions", "") or "").strip()
    if not intro:
        try:
            intro = _build_intro(understanding, docs_text or facts, case)
        except Exception:
            intro = facts[:1200]
    try:
        result = _clean(_appeal_llm().complete(
            _sec(persona),
            "Write ONLY the concluding OPERATIVE portion of the appellate order, in 4-8 sentences. "
            "State the outcome of EACH AND EVERY numbered ground in one sentence each, in order and "
            "omitting none, consistent with the finding recorded for that ground (e.g. 'Ground No. 1 is allowed / "
            "partly allowed / dismissed / set aside ...'). Then ONE sentence beginning 'In the "
            "result, the appeal is allowed / partly allowed / dismissed.'. You may add at most one "
            "consolidated sentence of directions to the AO. Do NOT repeat the detailed analysis and "
            "do NOT restate the full directions already recorded in the findings.\n\n"
            + ("\n\n".join(findings_blocks))[:9000]).strip())
        result = re.sub(r"(?is)^\**\s*(6\.\s*)?(operative portion[^\n]*|result)\s*:?\s*\**\s*\n+", "", result).strip()
    except Exception:
        result = ""

    findings = []
    for i, b in enumerate(findings_blocks):
        body = _strip_finding_headers(_clean(b))
        head = grounds[i].strip() if i < len(grounds) and grounds[i].strip() else f"Ground No. {i + 1}"
        findings.append(f"Ground No. {i + 1}: {head}\n\n{body}")

    grounds_txt = "\n".join(f"{i + 1}. {g}" for i, g in enumerate(grounds)) if grounds else "[not on record]"
    parts = [
        "DRAFT APPELLATE ORDER \u2014 CIT(A) / NFAC\n",
        "1. INTRODUCTION\n" + intro,
        "2. GROUNDS OF APPEAL\n" + grounds_txt,
        "3. FACTS OF THE CASE\n" + (facts or "[not on record]"),
        "4. SUBMISSIONS OF THE APPELLANT\n" + (submissions or "[not on record]"),
        "5. DISCUSSION AND FINDINGS\n" + "\n\n".join(findings),
    ]
    if result:
        parts.append("6. RESULT\n" + result)
    return "\n\n".join(x for x in parts if x.strip())


# --- orchestration (called by the Celery task) ---
def run_case(run_id: int) -> None:
    db = SessionLocal()
    try:
        run = db.get(AppealRun, run_id)
        if not run:
            return
        case = db.get(AppealCase, run.case_id)
        # Targeted UPDATE — never mutate the in-memory `run` object during
        # the pipeline, so subsequent `db.commit()` calls elsewhere in the
        # run don't autoflush a full-row rewrite that would clobber an
        # out-of-band cancel flip on status / error.
        db.execute(
            update(AppealRun)
            .where(AppealRun.id == run.id)
            .values(status="running", provider=settings.llm_backend, model=_APPEAL_MODEL)
        )
        db.execute(
            update(AppealCase)
            .where(AppealCase.id == case.id)
            .values(status="running")
        )
        db.commit()

        def _check_cancel():
            """Re-read status from the DB (bypassing SQLAlchemy's identity
            map so we actually see out-of-band changes) and abort the
            pipeline if a cancel endpoint has flipped us."""
            row = db.execute(
                select(AppealRun.status, AppealRun.error).where(AppealRun.id == run.id)
            ).one_or_none()
            if not row:
                return
            status, err = row
            if status == "error" and (err or "").lower().startswith("cancelled"):
                raise _RunCancelled()

        def progress(stage: str):
            # Cancel check FIRST — if we're cancelled, don't emit a progress
            # update that would race the cancel commit.
            _check_cancel()
            # Targeted UPDATE that only touches `progress`. The original
            # `run.progress = stage; db.commit()` sent SQLAlchemy's full
            # dirty-row UPDATE which also re-wrote status/error and clobbered
            # the cancel endpoint's flip. Using an explicit statement avoids
            # both the clobber AND the autoflush of any other dirty attrs on
            # the in-memory `run` object.
            db.execute(
                update(AppealRun)
                .where(AppealRun.id == run.id)
                .values(progress=stage)
            )
            db.commit()

        # Every LLM call in this pipeline gets attributed to the officer who
        # started the run (via run.created_by), so the token spend shows up
        # per-user in the admin console.
        owner_id = run.created_by
        # Officer persona (letterhead/tone/house-style only — never evidence) so
        # the order reads in the officer's authority + house style. Empty when no
        # personalization is set → byte-for-byte identical drafting to before.
        persona = ""
        try:
            _officer = db.get(User, owner_id) if owner_id else None
            persona = personalization.drafting_persona(db, _officer) if _officer else ""
        except Exception:  # noqa: BLE001
            persona = ""
        _cap_snap = {"user_id": owner_id, "case_id": case.id, "run_id": run.id}
        try:
            capture.set_context(**_cap_snap)
        except Exception:  # noqa: BLE001
            pass

        def _bill(action: str) -> None:
            meta = _last_llm_meta()
            if not meta:
                return
            tokens.record(
                db, user_id=owner_id, action=action,
                model=meta.get("model"), usage=meta.get("usage"),
                latency_ms=meta.get("latency_ms"),
            )

        # OCR-repair any document whose text layer is empty/unreadable (scanned
        # image) using Gemini document-vision; persist so re-runs skip it. Anything
        # that still can't be read is flagged so the officer is never left unaware.
        ocr_fixed, ocr_failed = [], []
        if _GEMINI_KEY:
            _empties = [d for d in case.documents
                        if len((d.text or "").strip()) < 100 and d.minio_key]
            # ------------------------------------------------------------
            # Dedup pass FIRST — for every empty doc, look for another
            # AppealDocument (any case, any user) that already has a good
            # OCR of the same PDF (same sha256). Reuse its text and skip
            # the Gemini call entirely.  This is the big cost lever.
            # ------------------------------------------------------------
            ocr_deduped: list[str] = []
            still_empty: list = []
            for d in _empties:
                if not d.sha256:
                    still_empty.append(d)
                    continue
                prior = db.scalar(
                    select(AppealDocument)
                    .where(
                        AppealDocument.sha256 == d.sha256,
                        AppealDocument.id != d.id,
                        func.length(AppealDocument.text) > 100,
                    )
                    .order_by(desc(AppealDocument.id))
                    .limit(1)
                )
                if prior is not None:
                    d.text = prior.text
                    ocr_deduped.append(d.filename)
                else:
                    still_empty.append(d)
            if ocr_deduped:
                db.commit()
                log.info("appeal %s OCR-dedup skipped Gemini for %d PDFs: %s",
                         run.id, len(ocr_deduped), ocr_deduped)
            if still_empty:
                progress(f"OCR: reading {len(still_empty)} scanned document(s)")
                def _ocr_one(d):
                    try:
                        capture.set_context(**_cap_snap)
                    except Exception:  # noqa: BLE001
                        pass
                    return d, _ocr_pdf(d.minio_key, d.filename)
                with ThreadPoolExecutor(max_workers=min(len(still_empty), 4)) as _ex:
                    for _d, _txt in _ex.map(_ocr_one, still_empty):
                        if len(_txt.strip()) >= 100:
                            _d.text = _txt
                            ocr_fixed.append(_d.filename)
                        else:
                            ocr_failed.append(_d.filename)
                db.commit()
                log.info("appeal %s OCR repaired=%s unreadable=%s (deduped=%s)",
                         run.id, ocr_fixed, ocr_failed, ocr_deduped)

        docs_text = _docs_text(case, db)

        progress("Module 3: Document compliance")
        comp = document_compliance(case)
        comp["ocr_repaired"] = ocr_fixed
        comp["unreadable"] = ocr_failed
        db.add(AppealOutput(run_id=run.id, kind="compliance", content=json.dumps(comp, ensure_ascii=False)))

        _case_id = case.id

        def _bill_meta(action: str, meta: dict | None) -> None:
            """Meter a call's tokens against the owner, given the meta captured in
            whichever thread made the call (works under parallelism)."""
            if not meta:
                return
            tokens.record(db, user_id=owner_id, action=action,
                          model=meta.get("model"), usage=meta.get("usage"),
                          latency_ms=meta.get("latency_ms"))

        # Modules 1 (deficiency), 2 (scope) and 4 (grounds extraction) are
        # INDEPENDENT of one another, so run their LLM calls CONCURRENTLY instead
        # of three sequential Gemini round-trips — the main critical-path win.
        # Each task uses its own session + capture context and returns its result
        # plus token meta; the main thread persists and meters. Module 5 depends
        # on Module 4's grounds, so it still runs after this batch.
        progress("Modules 1–4: deficiency, scope & grounds (parallel)")

        def _mod_deficiency():
            try: capture.set_context(**_cap_snap)
            except Exception: pass  # noqa: E722
            mdb = SessionLocal()
            try:
                ctx, cites = _ground(mdb, "section 249 appeal limitation condonation of delay Rule 45 Rule 46A appeal fee Form 35")
                defi = _complete("MODULE 1 — DEFICIENCY CHECKER (s.249/Rule 45/Rule 46A). Check completeness of Form 35, "
                                 "verification, appeal fee, tax on returned income; LIMITATION (order date, service date, "
                                 "filing date, delay, condonation needed & sufficient?); mandatory attachments; Rule 46A "
                                 "new-evidence (before AO? admit/reject/remand). Output a Deficiency Report.\n\n"
                                 f"=== APPEAL DOCUMENTS ===\n{_trim(docs_text, 7000)}\n\n=== RETRIEVED LAW ===\n{_trim(ctx, 2500)}")
                return ("deficiency", defi, cites, _last_llm_meta())
            except Exception as e:  # auxiliary report — never fail the whole run
                return ("deficiency", f"_[Deficiency check failed: {type(e).__name__}. Retry.]_", [], None)
            finally:
                mdb.close()

        def _mod_scope():
            try: capture.set_context(**_cap_snap)
            except Exception: pass  # noqa: E722
            mdb = SessionLocal()
            try:
                ctx, cites = _ground(mdb, "section 246A appealable orders Faceless Appeal Scheme 2021 excluded categories")
                scope = _complete("MODULE 2 — SCOPE VALIDATION (Faceless Appeal Scheme 2021). Identify the section appealed "
                                  "(143(3)/144/147/154/271B/270A), check appealability u/s 246A, flag excluded/sensitive "
                                  "categories. Output a Scope Validation Report.\n\n"
                                  f"=== APPEAL DOCUMENTS ===\n{_trim(docs_text, 7000)}\n\n=== RETRIEVED LAW ===\n{_trim(ctx, 2500)}")
                return ("scope", scope, cites, _last_llm_meta())
            except Exception as e:
                return ("scope", f"_[Scope validation failed: {type(e).__name__}. Retry.]_", [], None)
            finally:
                mdb.close()

        def _mod_extract():
            try: capture.set_context(**_cap_snap)
            except Exception: pass  # noqa: E722
            mdb = SessionLocal()
            try:
                tcase = mdb.get(AppealCase, _case_id)
                return ("extract", _extract_case(tcase, docs_text, persona), None, _last_llm_meta())
            except Exception:  # fall back to heuristic grounds below
                return ("extract", {"grounds": [], "facts": "", "submissions": "",
                                    "institution_date": ""}, None, None)
            finally:
                mdb.close()

        with ThreadPoolExecutor(max_workers=3) as _ex:
            _f_def, _f_scope, _f_ext = (_ex.submit(_mod_deficiency),
                                        _ex.submit(_mod_scope),
                                        _ex.submit(_mod_extract))
            _r_def, _r_scope, _r_ext = _f_def.result(), _f_scope.result(), _f_ext.result()

        db.add(AppealOutput(run_id=run.id, kind="deficiency", content=_r_def[1], citations=_r_def[2]))
        _bill_meta("appeal.module1", _r_def[3])
        db.add(AppealOutput(run_id=run.id, kind="scope", content=_r_scope[1], citations=_r_scope[2]))
        _bill_meta("appeal.module2", _r_scope[3])

        extracted = _r_ext[1]
        _bill_meta("appeal.module4", _r_ext[3])
        grounds = extracted["grounds"]
        if grounds:
            issues = [{"issue": g} for g in grounds]
        else:  # last-resort heuristic if Form 35 grounds could not be read
            issues = _detect_issues(docs_text) or [{"issue": "Grounds of appeal (see documents)"}]
            grounds = [i["issue"] for i in issues]
        understanding = {"facts": extracted["facts"], "grounds": grounds,
                         "appellant_submissions": extracted["submissions"], "issues": issues,
                         "institution_date": extracted.get("institution_date", "")}
        db.add(AppealOutput(run_id=run.id, kind="issue_matrix", content=json.dumps(understanding, ensure_ascii=False)))

        progress(f"Module 5: Drafting {len(issues)} ground(s) in parallel")
        def _draft_one(idx_issue):
            idx, iss = idx_issue
            try:
                capture.set_context(**_cap_snap)
            except Exception:  # noqa: BLE001
                pass
            tdb = SessionLocal()  # own session per thread (SQLAlchemy sessions aren't shared-safe)
            try:
                tcase = tdb.get(AppealCase, _case_id)  # case bound to THIS thread's session
                block, cites = draft_issue(tdb, tcase, iss, persona)
                meta = _last_llm_meta()
            finally:
                tdb.close()
            return idx, iss, block, cites, meta

        # The intro only needs the extracted `understanding` + docs — not the
        # findings — so build it CONCURRENTLY with the drafting instead of as a
        # separate call afterwards (keeps it off the critical path).
        _intro_box: dict = {}
        def _do_intro():
            try:
                capture.set_context(**_cap_snap)
            except Exception:  # noqa: BLE001
                pass
            try:
                _intro_box["intro"] = _build_intro(understanding, docs_text, case)
                _intro_box["meta"] = _last_llm_meta()
            except Exception:  # noqa: BLE001
                _intro_box["intro"] = ""

        blocks_by_idx: dict = {}
        with ThreadPoolExecutor(
            max_workers=min((len(issues) or 1) + 1, _GEMINI_CONCURRENCY)
        ) as _ex:
            _intro_fut = _ex.submit(_do_intro)
            _fut_to_idx = {_ex.submit(_draft_one, (i, iss)): i
                           for i, iss in enumerate(issues)}
            # Persist + stream each ground the MOMENT it finishes drafting, so the
            # officer watches findings appear one-by-one instead of all at the end.
            for fut in as_completed(_fut_to_idx):
                idx, iss, block, cites, meta = fut.result()
                db.add(AppealOutput(run_id=run.id, kind="finding", seq=idx,
                                    label=iss["issue"][:290], content=block, citations=cites))
                _bill_meta("appeal.module5", meta)  # metered per-ground
                try:
                    db.commit()   # make this finding visible to the polling UI now
                except Exception:  # noqa: BLE001
                    db.rollback()
                blocks_by_idx[idx] = block
            _intro_fut.result()
        blocks = [blocks_by_idx[i] for i in sorted(blocks_by_idx)]

        progress("Module 6: Assembling draft order")
        draft = assemble(understanding, blocks, docs_text,
                         intro=_intro_box.get("intro"), persona=persona)
        _bill_meta("appeal.module6.intro", _intro_box.get("meta"))
        _bill("appeal.module6")
        db.add(AppealOutput(run_id=run.id, kind="draft", content=draft))
        try:
            capture.log_event("draft", task="appeal.final", response=draft,
                              context=json.dumps(understanding, ensure_ascii=False))
        except Exception:  # noqa: BLE001
            pass

        # Flush the module outputs before the final status commit so a
        # last-second cancel that fires between these two statements can't
        # leave orphan outputs uncommitted.
        db.flush()
        # Cancel-safe final commit. Re-read status one more time — if a cancel
        # landed after the last progress() check, don't overwrite it with "done".
        _check_cancel()
        # Targeted UPDATE (as with progress()) so any dirty attrs on the in-memory
        # `run` / `case` objects don't clobber the cancel flip on their way out.
        db.execute(
            update(AppealRun)
            .where(AppealRun.id == run.id)
            .values(status="done", finished_at=datetime.now(timezone.utc))
        )
        db.execute(
            update(AppealCase)
            .where(AppealCase.id == case.id)
            .values(status="ready")
        )
        db.commit()
    except Exception as e:  # noqa: BLE001
        db.rollback()
        # Read the current DB state ourselves — don't rely on `run.error` on
        # the in-memory object because that may be stale / never refreshed.
        row = db.execute(
            select(AppealRun.error, AppealRun.case_id).where(AppealRun.id == run_id)
        ).one_or_none()
        if row:
            existing_err, case_id = row
            already_cancelled = (existing_err or "").lower().startswith("cancelled")
            new_err = existing_err if already_cancelled else f"{type(e).__name__}: {e}"
            db.execute(
                update(AppealRun)
                .where(AppealRun.id == run_id)
                .values(status="error", error=new_err, finished_at=datetime.now(timezone.utc))
            )
            db.execute(
                update(AppealCase)
                .where(AppealCase.id == case_id)
                .values(status="error")
            )
            db.commit()
        if isinstance(e, _RunCancelled):
            log.info("appeal run %s cancelled by user", run_id)
        else:
            log.exception("appeal run %s failed", run_id)
    finally:
        db.close()
