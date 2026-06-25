"""Appeal-order drafting engine (BharathTax "Draft Bot").

Implements the officer's 6-module CIT(A)/NFAC workflow, GROUNDED on the primary-law
corpus via the existing hybrid retrieval (bge-m3 + reranker) and generated via the
existing LLMClient. Anti-hallucination is preserved: legal points cite only the
numbered passages handed to the model.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import SessionLocal
from app.core.enums import Domain
from app.core.logging import get_logger
from app.models.appeal import AppealCase, AppealDocument, AppealOutput, AppealRun
from app.services import llm as llm_mod
from app.services.retrieval import retrieve

log = get_logger(__name__)

OFFICER_SYSTEM = (
    "You are an AI assistant for drafting appellate orders under the Income-tax Act for the "
    "Commissioner of Income Tax (Appeals) / NFAC. You produce a DRAFT ('shell') order only; "
    "the Commissioner applies independent mind before finalising.\n"
    "CITATION RULES (mandatory): for any legal proposition, cite ONLY the numbered passages in "
    "the RETRIEVED LAW section, inline as [n]. Never invent a case, section or rule not present "
    "there. Facts come only from the appeal documents. If the passages don't support a point, "
    "say so rather than guessing."
)

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
    ("Addition u/s 68 — unexplained cash credit / share capital", r"\b68\b|cash credit|share application|unexplained"),
    ("Disallowance u/s 37 — business expenditure", r"\b37\b|business promotion|disallow.*expens"),
    ("Disallowance u/s 14A r.w. Rule 8D", r"\b14a\b|rule 8d|exempt income"),
    ("Penalty u/s 270A — under-reporting / misreporting", r"270a|under-?reporting|misreporting"),
    ("Penalty u/s 271(1)(c) — concealment", r"271\(1\)\(c\)|concealment"),
    ("Condonation of delay u/s 249", r"condon|delay in filing|limitation"),
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
    """Return (context_text, citations) from the corpus for a query."""
    res = retrieve(db, query, domain=domain)
    blocks, cites = [], []
    for i, p in enumerate(res.passages, start=1):
        blocks.append(f"[{i}] ({p.breadcrumb})\n{p.text}")
        cites.append({"n": i, "chunk_id": p.chunk_id, "breadcrumb": p.breadcrumb,
                      "section_number": p.section_number, "source_url": p.source_url})
    return ("\n\n".join(blocks) if blocks else "(no relevant primary law retrieved)"), cites


def _complete(user: str) -> str:
    return llm_mod.get_llm().complete(OFFICER_SYSTEM, user)


def _complete_json(user: str) -> dict:
    txt = llm_mod.get_llm().complete(
        OFFICER_SYSTEM + "\n\nRespond with ONLY a valid JSON object, no prose, no code fences.", user)
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


def _docs_text(case: AppealCase, max_chars: int = 24000) -> str:
    parts = [f"===== {d.filename} (category: {d.category}) =====\n{(d.text or '').strip()}"
             for d in case.documents]
    blob = "\n\n".join(parts)
    return blob[:max_chars] + ("\n…[truncated]…" if len(blob) > max_chars else "")


def document_compliance(case: AppealCase) -> dict:
    present = {d.category for d in case.documents}
    return {
        "compliance_sheet": [{"filename": d.filename, "category": d.category,
                              "group": GROUP.get(d.category, "Unclassified"), "pages": d.pages}
                             for d in case.documents],
        "missing": [c for c in EXPECTED if c not in present],
    }


# --- per-issue drafting (reused by run + regenerate) ---
def draft_issue(db: Session, docs_text: str, issue: dict) -> tuple[str, list]:
    q = issue.get("issue", "")
    ctx, cites = _ground(db, q, domain=None)   # ground on statutes AND case law
    user = (f"MODULE 5 — DRAFTING ENGINE for ONE issue. Write the issue-wise Discussion and Findings "
            f"with labelled sub-parts: Facts / Submissions / AO's view / Legal position / Analysis / "
            f"Finding / Decision. End with the Result (Allowed / Partly Allowed / Dismissed / Set Aside) "
            f"and any direction to the AO. Cite legal points as [n] from the RETRIEVED LAW only.\n\n"
            f"=== ISSUE ===\n{q}\n\n=== APPEAL DOCUMENTS (facts) ===\n{docs_text}\n\n"
            f"=== RETRIEVED LAW ===\n{ctx}")
    try:
        block = _complete(user)
    except Exception as e:  # one issue must not fail the order
        block = f"_[Drafting failed for this issue: {type(e).__name__}. Retry.]_"
    return block, cites


def assemble(understanding: dict, findings_blocks: list[str]) -> str:
    grounds = understanding.get("grounds", []) or []
    user = (
        "MODULE 5/6 — ASSEMBLE THE DRAFT APPELLATE ORDER (formal CIT(A)/NFAC style) with sections: "
        "1. Introduction 2. Grounds of Appeal 3. Facts of the Case 4. Submissions of the Appellant "
        "5. Remand Report/Rejoinder (if any) 6. Discussion and Findings (use the blocks verbatim) "
        "7. Result with directions. Do NOT add any new citation beyond what the blocks contain.\n\n"
        f"=== FACTS ===\n{understanding.get('facts', '')}\n\n"
        f"=== GROUNDS ===\n" + "\n".join(f"{i+1}. {g}" for i, g in enumerate(grounds)) + "\n\n"
        f"=== APPELLANT SUBMISSIONS ===\n{understanding.get('appellant_submissions', '')}\n\n"
        f"=== ISSUE-WISE DISCUSSION AND FINDINGS (verbatim) ===\n" + "\n\n".join(findings_blocks)
    )
    return _complete(user)


# --- orchestration (called by the Celery task) ---
def run_case(run_id: int) -> None:
    db = SessionLocal()
    try:
        run = db.get(AppealRun, run_id)
        if not run:
            return
        case = db.get(AppealCase, run.case_id)
        run.status, run.provider, run.model = "running", settings.llm_backend, settings.llm_model_name
        case.status = "running"
        db.commit()

        def progress(stage: str):
            run.progress = stage
            db.commit()

        docs_text = _docs_text(case)

        progress("Module 3: Document compliance")
        comp = document_compliance(case)
        db.add(AppealOutput(run_id=run.id, kind="compliance", content=json.dumps(comp, ensure_ascii=False)))

        progress("Module 1: Deficiency check")
        ctx, cites = _ground(db, "section 249 appeal limitation condonation of delay Rule 45 Rule 46A appeal fee Form 35")
        defi = _complete("MODULE 1 — DEFICIENCY CHECKER (s.249/Rule 45/Rule 46A). Check completeness of Form 35, "
                         "verification, appeal fee, tax on returned income; LIMITATION (order date, service date, "
                         "filing date, delay, condonation needed & sufficient?); mandatory attachments; Rule 46A "
                         "new-evidence (before AO? admit/reject/remand). Output a Deficiency Report.\n\n"
                         f"=== APPEAL DOCUMENTS ===\n{docs_text}\n\n=== RETRIEVED LAW ===\n{ctx}")
        db.add(AppealOutput(run_id=run.id, kind="deficiency", content=defi, citations=cites))

        progress("Module 2: Scope validation")
        ctx, cites = _ground(db, "section 246A appealable orders Faceless Appeal Scheme 2021 excluded categories")
        scope = _complete("MODULE 2 — SCOPE VALIDATION (Faceless Appeal Scheme 2021). Identify the section appealed "
                          "(143(3)/144/147/154/271B/270A), check appealability u/s 246A, flag excluded/sensitive "
                          "categories. Output a Scope Validation Report.\n\n"
                          f"=== APPEAL DOCUMENTS ===\n{docs_text}\n\n=== RETRIEVED LAW ===\n{ctx}")
        db.add(AppealOutput(run_id=run.id, kind="scope", content=scope, citations=cites))

        progress("Module 4: Issue matrix")
        understanding = _complete_json(
            "MODULE 4 — DOCUMENT UNDERSTANDING. From the documents return JSON: "
            '{"facts": "...", "grounds": ["..."], "appellant_submissions": "...", "ao_position": "...", '
            '"issues": [{"issue": "..."}]}\n\n=== APPEAL DOCUMENTS ===\n' + docs_text)
        issues = understanding.get("issues") if isinstance(understanding, dict) else None
        issues = [i for i in (issues or []) if isinstance(i, dict) and i.get("issue", "").strip() not in ("", "...")]
        if not issues:
            issues = _detect_issues(docs_text)
            understanding = {"facts": understanding.get("facts", "") if isinstance(understanding, dict) else "",
                             "grounds": understanding.get("grounds", []) if isinstance(understanding, dict) else [],
                             "appellant_submissions": "", "issues": issues}
        db.add(AppealOutput(run_id=run.id, kind="issue_matrix", content=json.dumps(understanding, ensure_ascii=False)))

        blocks = []
        for i, issue in enumerate(issues):
            progress(f"Module 5: Drafting issue {i + 1}/{len(issues)}")
            block, cites = draft_issue(db, docs_text, issue)
            db.add(AppealOutput(run_id=run.id, kind="finding", seq=i, label=issue["issue"], content=block, citations=cites))
            blocks.append(f"### Issue: {issue['issue']}\n\n{block}")

        progress("Module 6: Assembling draft order")
        draft = assemble(understanding, blocks)
        db.add(AppealOutput(run_id=run.id, kind="draft", content=draft))

        run.status, run.finished_at = "done", datetime.now(timezone.utc)
        case.status = "ready"
        db.commit()
    except Exception as e:  # noqa: BLE001
        db.rollback()
        run = db.get(AppealRun, run_id)
        if run:
            run.status, run.error, run.finished_at = "error", f"{type(e).__name__}: {e}", datetime.now(timezone.utc)
            db.commit()
        log.exception("appeal run %s failed", run_id)
    finally:
        db.close()
