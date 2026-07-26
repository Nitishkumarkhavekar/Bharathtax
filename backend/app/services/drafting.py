"""Grounded, personalized drafting of officer-side artifacts — notices, orders,
letters — for the Income-Tax Department.

Generation runs on the SELF-HOSTED model (data stays in-country; department
paperwork must not leave the network). Each artifact is defined by a template
(fields + structure); the officer's profile (name, designation, charge) is fed
in so the draft is correctly headed and written from the authority's standpoint.
"""
from __future__ import annotations

import os

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.enums import Domain
from app.models.org import User
from app.services import llm as llm_mod

# Raw self-hosted model (respects our system prompt — unlike the RAG gateway
# model). Same endpoint the digest/appeal-local paths use.
_DRAFT_MODEL = os.getenv("DRAFT_MODEL_NAME", "llama-3.1-8b-instruct")


def _draft_llm() -> llm_mod.OpenAICompatLLM:
    return llm_mod.OpenAICompatLLM(settings.llm_base_url, _DRAFT_MODEL, settings.llm_api_key)


# --------------------------------------------------------------- templates
class Field:
    def __init__(self, key: str, label: str, *, textarea: bool = False,
                 required: bool = True, placeholder: str = ""):
        self.key, self.label, self.textarea = key, label, textarea
        self.required, self.placeholder = required, placeholder

    def as_dict(self) -> dict:
        return {"key": self.key, "label": self.label, "textarea": self.textarea,
                "required": self.required, "placeholder": self.placeholder}


_COMMON = [
    Field("assessee", "Assessee name", placeholder="M/s ABC Pvt. Ltd."),
    Field("pan", "PAN", placeholder="AAACA1234A"),
    Field("ay", "Assessment year", placeholder="2023-24"),
]

TEMPLATES: dict[str, dict] = {
    "notice_142_1": {
        "label": "Notice u/s 142(1)",
        "category": "Notice",
        "section": "142(1)",
        "fields": _COMMON + [
            Field("requirement", "What is called for", textarea=True,
                  placeholder="Books of account and vouchers for FY 2022-23; details of cash deposits…"),
            Field("comply_by", "Comply by (date)", placeholder="15.08.2026"),
        ],
        "structure": (
            "a formal Notice under section 142(1) of the Income-tax Act, 1961: the office "
            "heading, notice number and date, the addressee (assessee + PAN), the assessment "
            "year, a numbered list of exactly the accounts/documents/information called for, the "
            "date and time by which to comply, the consequence of non-compliance (best-judgment "
            "assessment u/s 144 and penalty u/s 272A(1)(d)), and the issuing officer's designation "
            "and charge."
        ),
    },
    "notice_143_2": {
        "label": "Notice u/s 143(2)",
        "category": "Notice",
        "section": "143(2)",
        "fields": _COMMON + [
            Field("reason", "Reason / issues flagged", textarea=True, required=False,
                  placeholder="Large cash deposits; mismatch in reported turnover…"),
            Field("comply_by", "Hearing / response date", placeholder="20.08.2026"),
        ],
        "structure": (
            "a Notice under section 143(2) selecting the return for scrutiny: heading, number and "
            "date, addressee + PAN + AY, a statement that the return filed has been selected for "
            "scrutiny and the assessee is required to produce evidence in support of the return, "
            "the response/hearing date, and the officer's designation and charge. Keep the issues "
            "general unless specifics are provided."
        ),
    },
    "show_cause": {
        "label": "Show-cause notice",
        "category": "Notice",
        "section": "",
        "fields": _COMMON + [
            Field("proposed_action", "Proposed action / addition", textarea=True,
                  placeholder="Proposed addition of Rs. 25,00,000 u/s 69A as unexplained money…"),
            Field("grounds", "Grounds / basis", textarea=True,
                  placeholder="Cash deposits during demonetisation not explained…"),
            Field("comply_by", "Reply by (date)", placeholder="18.08.2026"),
        ],
        "structure": (
            "a show-cause notice: heading, number and date, addressee + PAN + AY, a clear statement "
            "of the proposed action/addition and the grounds/basis for it (citing the relevant "
            "section), a call to show cause in writing why the proposed action should not be taken, "
            "the reply-by date, a note that non-response will lead to the action being taken on "
            "merits, and the officer's designation and charge."
        ),
    },
    "order_154": {
        "label": "Rectification order u/s 154",
        "category": "Order",
        "section": "154",
        "fields": _COMMON + [
            Field("mistake", "Mistake apparent from record", textarea=True,
                  placeholder="Credit for TDS of Rs. 1,20,000 as per 26AS not allowed in the intimation…"),
            Field("original_ref", "Order/intimation being rectified", required=False,
                  placeholder="Intimation u/s 143(1) dated 10.02.2024"),
        ],
        "structure": (
            "a rectification order under section 154: heading, number and date, assessee + PAN + AY, "
            "reference to the order/intimation being rectified, a statement of the mistake apparent "
            "from the record, the rectification made and the recomputed figures (only as given), and "
            "the officer's designation and charge. Do NOT invent figures — use only what is provided."
        ),
    },
}


def list_templates() -> list[dict]:
    return [
        {"kind": k, "label": t["label"], "category": t["category"], "section": t["section"],
         "fields": [f.as_dict() for f in t["fields"]]}
        for k, t in TEMPLATES.items()
    ]


# --------------------------------------------------------------- grounding
def _governing_law(section: str) -> str:
    """Short excerpt of the governing provision so the draft cites it accurately.
    Best-effort — returns '' if retrieval is unavailable."""
    if not section:
        return ""
    try:
        from app.services.retrieval import retrieve
        from app.core.db import SessionLocal
        db = SessionLocal()
        try:
            res = retrieve(db, f"section {section} Income-tax Act", domain=Domain.income_tax)
        finally:
            db.close()
        if res.passages:
            p = res.passages[0]
            return f"[{p.breadcrumb}] {p.text[:900]}"
    except Exception:  # noqa: BLE001
        pass
    return ""


_SYSTEM = (
    "You are an expert drafting assistant for officers of the Indian Income-Tax Department. "
    "You draft formal departmental documents (notices, orders, letters) in correct, dignified "
    "legal English, from the AUTHORITY's standpoint. STRICT RULES: use ONLY the facts, names, "
    "figures, dates and PAN provided — NEVER invent an amount, date, name or fact; if a detail is "
    "missing write [•]. Cite the governing section as given. Output ONLY the document text, ready "
    "to place on the office letterhead — no preamble, no commentary, no markdown code fences."
)


def _officer_block(user: User) -> str:
    who = (user.designation or (user.role.value if hasattr(user.role, "value") else str(user.role))).strip()
    charge = (user.charge or "").strip()
    name = (user.full_name or "").strip()
    parts = [x for x in [name, who, charge] if x]
    return ", ".join(parts) if parts else "[Issuing Officer, designation, charge]"


def generate(db: Session, user: User, kind: str, inputs: dict) -> str:
    tmpl = TEMPLATES.get(kind)
    if not tmpl:
        raise ValueError(f"unknown draft kind: {kind}")
    facts = "\n".join(f"- {f.label}: {inputs.get(f.key, '').strip() or '[•]'}"
                      for f in tmpl["fields"])
    law = _governing_law(tmpl["section"])
    user_prompt = (
        f"Draft {tmpl['structure']}\n\n"
        f"=== FACTS ON RECORD (use ONLY these) ===\n{facts}\n\n"
        f"=== ISSUING OFFICER ===\n{_officer_block(user)}\n\n"
        + (f"=== GOVERNING LAW (cite accurately) ===\n{law}\n\n" if law else "")
        + "Now write the complete document."
    )
    return _draft_llm().complete(_SYSTEM, user_prompt, max_tokens=1400).strip()
