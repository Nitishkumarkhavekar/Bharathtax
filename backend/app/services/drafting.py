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
        "wings": ["officer"],
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
        "wings": ["officer"],
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

    # ---- Supervisory / approving authority (Range head, Commissioner) --------
    "approval_153D": {
        "label": "Approval u/s 153D (search assessments)",
        "category": "Approval",
        "section": "153D",
        "wings": ["officer"],
        "fields": _COMMON + [
            Field("draft_ref", "Draft order(s) submitted for approval", textarea=True,
                  placeholder="Draft assessment orders u/s 153A for AY 2018-19 to 2024-25 submitted by the AO, Central Circle-2"),
            Field("observations", "Observations / directions", required=False, textarea=True,
                  placeholder="Additions on the seized material examined; AO to verify the peak on issue 3 before finalising"),
        ],
        "structure": (
            "an approval under section 153D by the Range Head (Additional / Joint CIT): heading of the "
            "office of the Additional/Joint CIT, number and date, reference to the draft assessment "
            "order(s) under section 153A/153C submitted by the Assessing Officer for the assessment "
            "year(s) stated, a statement that the draft order(s) together with the seized material and "
            "the assessment records have been examined, the approval accorded with any observations / "
            "directions to the AO, and the approving authority's designation and charge. This is a "
            "SUPERVISORY approval — record application of mind; do NOT re-draft the assessment."
        ),
    },
    "sanction_151": {
        "label": "Sanction u/s 151 for issue of notice u/s 148",
        "category": "Approval",
        "section": "151",
        "wings": ["officer"],
        "fields": _COMMON + [
            Field("reasons_ref", "Reasons recorded / AO's proposal", textarea=True,
                  placeholder="Reasons recorded by the AO for reopening AY 2019-20 — escapement of Rs. 42,00,000 on account of bogus purchases"),
            Field("decision", "Satisfaction", required=False, placeholder="Fit case — sanction accorded"),
        ],
        "structure": (
            "a sanction under section 151 for issue of a notice under section 148: heading of the "
            "specified sanctioning authority (Pr. CIT/CIT, or Pr. CCIT/CCIT where the extended time "
            "limit applies), number and date, reference to the reasons recorded and the proposal of "
            "the Assessing Officer for the assessment year stated, a statement that the reasons and the "
            "material on record have been examined and that it is a fit case for issue of notice under "
            "section 148, the satisfaction recorded and the sanction accorded, and the sanctioning "
            "authority's designation. RECORD the satisfaction — do NOT merely state 'approved'."
        ),
    },

    # ---- Recovery / TRO -------------------------------------------------------
    "notice_226_3": {
        "label": "Garnishee notice u/s 226(3)",
        "category": "Notice",
        "section": "226(3)",
        "wings": ["recovery"],
        "fields": _COMMON + [
            Field("amount", "Tax arrears outstanding", placeholder="Rs. 12,45,000"),
            Field("garnishee", "Person/bank holding the money", placeholder="State Bank of India, XYZ Branch"),
            Field("demand_ref", "Demand notice reference", required=False, placeholder="Demand u/s 156 dated 10.01.2025"),
        ],
        "structure": (
            "a notice under section 226(3) of the Income-tax Act, 1961 addressed to a person from whom "
            "money is due to the assessee (the garnishee): heading of the office of the Tax Recovery "
            "Officer / Assessing Officer, notice number and date, the garnishee's name, the assessee's "
            "name + PAN, the amount of tax arrears outstanding, a direction to pay to the credit of the "
            "Central Government so much of the money as is or becomes due to the assessee, a statement "
            "that on failure the garnishee shall be deemed an assessee-in-default under section "
            "226(3)(x), the requirement to comply forthwith / by the stated date, and the officer's "
            "designation and charge. Use only the figures provided."
        ),
    },
    "notice_221": {
        "label": "Show-cause for penalty u/s 221 (default in payment)",
        "category": "Notice",
        "section": "221(1)",
        "wings": ["recovery"],
        "fields": _COMMON + [
            Field("amount", "Demand in default", placeholder="Rs. 12,45,000"),
            Field("demand_ref", "Demand notice + due date", required=False,
                  placeholder="Demand u/s 156 dated 10.01.2025, payable by 09.02.2025"),
            Field("comply_by", "Reply by (date)", placeholder="18.08.2026"),
        ],
        "structure": (
            "a show-cause notice under section 221(1) proposing penalty for default in payment of tax: "
            "heading, number and date, assessee + PAN + AY, a statement that the demand of the stated "
            "amount raised vide the demand notice remains unpaid despite the due date and the assessee "
            "is therefore in default, a call to show cause why penalty under section 221(1) should not "
            "be levied, the reply-by date, a note that the penalty shall not exceed the tax in arrears "
            "and that no penalty is levied if good and sufficient reasons are shown, and the officer's "
            "designation and charge."
        ),
    },
    "order_220_6": {
        "label": "Order allowing installments u/s 220(6)",
        "category": "Order",
        "section": "220(6)",
        "wings": ["recovery"],
        "fields": _COMMON + [
            Field("amount", "Demand outstanding", placeholder="Rs. 12,45,000"),
            Field("plan", "Installment terms allowed", textarea=True,
                  placeholder="6 monthly installments of Rs. 2,07,500 commencing 01.09.2026"),
            Field("conditions", "Conditions", required=False, textarea=True,
                  placeholder="Interest u/s 220(2) to continue; default of one installment vacates the facility"),
        ],
        "structure": (
            "an order under section 220(6)/220(3) allowing the outstanding demand to be paid in "
            "installments: heading, number and date, assessee + PAN + AY, reference to the demand "
            "outstanding and the application considered, the installment schedule allowed (amounts and "
            "dates exactly as provided), the conditions (continuation of interest under section 220(2), "
            "and that default in any installment renders the whole demand due and recovery will follow), "
            "and the officer's designation and charge. Use only the figures provided."
        ),
    },

    # ---- TDS / Exemptions -----------------------------------------------------
    "notice_201": {
        "label": "Show-cause u/s 201/201(1A) (TDS default)",
        "category": "Notice",
        "section": "201",
        "wings": ["tds"],
        "fields": [
            Field("assessee", "Deductor name", placeholder="M/s ABC Pvt. Ltd."),
            Field("pan", "TAN / PAN", placeholder="DELA12345A"),
            Field("ay", "Financial year", placeholder="2022-23"),
            Field("default", "Nature of default", textarea=True,
                  placeholder="Short deduction of TDS u/s 194C on contractor payments of Rs. 50,00,000"),
            Field("comply_by", "Reply by (date)", placeholder="18.08.2026"),
        ],
        "structure": (
            "a show-cause notice under section 201(1)/201(1A) proposing to treat the deductor as an "
            "assessee-in-default: heading, number and date, the deductor's name + TAN/PAN + financial "
            "year, a statement of the default (non-deduction / short deduction / non-payment of TDS) "
            "with the amount and the section under which tax was deductible, a call to show cause why "
            "the deductor should not be treated as an assessee-in-default under section 201(1) and "
            "interest charged under section 201(1A), the reply-by date, and the officer's designation "
            "and charge. Use only the figures provided."
        ),
    },

    # ---- Transfer Pricing (TPO) ----------------------------------------------
    "show_cause_92ca": {
        "label": "Show-cause proposing TP adjustment u/s 92CA(3)",
        "category": "Notice",
        "section": "92CA(3)",
        "wings": ["tp"],
        "fields": _COMMON + [
            Field("transaction", "International / specified domestic transaction", textarea=True,
                  placeholder="Provision of software development services to AE — Rs. 45,00,00,000"),
            Field("proposed_adjustment", "Proposed adjustment & basis", textarea=True,
                  placeholder="TNMM; arm's-length margin 18% vs 11% shown; proposed adjustment Rs. 3,15,00,000"),
            Field("comply_by", "Reply by (date)", placeholder="18.08.2026"),
        ],
        "structure": (
            "a show-cause notice by the Transfer Pricing Officer under section 92CA(3) proposing an "
            "adjustment to the arm's-length price: heading of the office of the TPO, number and date, "
            "assessee + PAN + AY, identification of the international transaction / specified domestic "
            "transaction, the most appropriate method and the comparables/margin relied on, the "
            "proposed adjustment to the ALP with the amount, a call to show cause why the adjustment "
            "should not be made, the reply-by date, and the TPO's designation and charge. Use only the "
            "figures provided; do NOT invent comparables."
        ),
    },

    # ---- Investigation / I&CI -------------------------------------------------
    "summons_131": {
        "label": "Summons u/s 131",
        "category": "Notice",
        "section": "131(1)",
        "wings": ["investigation"],
        "fields": _COMMON + [
            Field("attend_on", "Date & time to attend", placeholder="20.08.2026 at 11:30 AM"),
            Field("produce", "Evidence / documents to produce", textarea=True,
                  placeholder="Books of account and bank statements for FY 2022-23; to give evidence on cash transactions"),
        ],
        "structure": (
            "a summons under section 131(1) of the Income-tax Act, 1961: heading, number and date, the "
            "name + PAN of the person summoned, a direction to attend in person before the officer on "
            "the stated date and time to give evidence on oath and/or to produce the documents "
            "specified, a note that the officer has the powers of a civil court and of the consequence "
            "of non-attendance, and the officer's designation and charge."
        ),
    },
    "notice_133_6": {
        "label": "Notice u/s 133(6) (call for information)",
        "category": "Notice",
        "section": "133(6)",
        "wings": ["investigation", "ici"],
        "fields": _COMMON + [
            Field("information", "Information / documents required", textarea=True,
                  placeholder="Details of all transactions with M/s XYZ during FY 2022-23; ledger and bank statements"),
            Field("comply_by", "Furnish by (date)", placeholder="18.08.2026"),
        ],
        "structure": (
            "a notice under section 133(6) calling for information: heading, number and date, the "
            "addressee + PAN, a statement that the information is required for the purposes of an "
            "enquiry/proceeding under the Act, a numbered list of exactly the information/documents "
            "required, the date by which to furnish it, the consequence of non-compliance (penalty "
            "u/s 272A(2)), and the officer's designation and charge."
        ),
    },

    # ---- CIT(A) / NFAC --------------------------------------------------------
    "notice_250": {
        "label": "Notice of hearing u/s 250(1)",
        "category": "Notice",
        "section": "250(1)",
        "wings": ["cita"],
        "fields": _COMMON + [
            Field("appeal_no", "Appeal number", required=False, placeholder="CIT(A)/NFAC/12345/2024-25"),
            Field("hearing_on", "Date & time of hearing", placeholder="20.08.2026 at 11:00 AM"),
        ],
        "structure": (
            "a notice of hearing under section 250(1) issued by the CIT(A)/NFAC in a pending appeal: "
            "heading, appeal number, date, the appellant + PAN + AY, a statement fixing the date and "
            "time of hearing of the appeal, a direction to attend and/or file written submissions, a "
            "note that in default the appeal may be decided on merits / ex parte, and the issuing "
            "appellate authority's designation."
        ),
    },

    # ---- CA / Advocate (assessee side) ---------------------------------------
    "reply_notice": {
        "label": "Reply to a notice (assessee side)",
        "category": "Letter",
        "section": "",
        "wings": ["ca"],
        "fields": _COMMON + [
            Field("notice_ref", "Notice being replied to", placeholder="Notice u/s 142(1) dated 01.08.2026"),
            Field("points", "Points / explanation to make", textarea=True,
                  placeholder="Cash deposits are out of accumulated business receipts; ledger and cash book enclosed"),
        ],
        "structure": (
            "a reply, on behalf of the assessee, to a notice issued by the Assessing Officer: heading "
            "addressed to the officer, reference to the notice being replied to, the assessee's name + "
            "PAN + AY, a courteous point-wise reply addressing each requirement/query with the "
            "explanation and the documents enclosed, a request to drop/adjourn the proceeding as "
            "appropriate, and the authorised representative's details. Written from the ASSESSEE's side."
        ),
    },
}


def _user_wing_keys(profile: str | None, wings: list[str] | None) -> set[str]:
    """The function key(s) the requesting officer works. Empty = no scoping
    (all/none) → natural template order."""
    if not profile or profile == "all":
        return set()
    if profile == "custom":
        return set(wings or [])
    return {profile}


def list_templates(profile: str | None = None, wings: list[str] | None = None) -> list[dict]:
    """Every template, but RANKED so the officer's own function's templates come
    first, then the universal ones, then the rest — soft emphasis, nothing
    hidden (an AO can still reach a 133(6); a TRO can still reach a 142(1))."""
    keys = _user_wing_keys(profile, wings)

    def rank(t: dict) -> int:
        tw = t.get("wings")  # None = universal (belongs to every desk)
        if not keys:
            return 0
        if tw and keys & set(tw):
            return 0  # the officer's own function
        if tw is None:
            return 1  # universal
        return 2      # another wing's — still listed, just lower

    items = [
        (rank(t), {"kind": k, "label": t["label"], "category": t["category"],
                   "section": t["section"], "wings": t.get("wings") or [],
                   "fields": [f.as_dict() for f in t["fields"]]})
        for k, t in TEMPLATES.items()
    ]
    items.sort(key=lambda x: x[0])  # stable → preserves definition order within a rank
    return [d for _, d in items]


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
