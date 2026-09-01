"""Grounded, personalized drafting of officer-side artifacts — notices, orders,
letters — for the Income-Tax Department.

Backend selection is env-flagged via ``DRAFT_LLM_BACKEND``:

  * ``vertex`` (default) — Vertex AI Gemini, for higher-quality drafts.
    Model is picked from ``DRAFT_VERTEX_MODEL`` (default gemini-flash-latest).
  * ``openai`` (or any other value) — the self-hosted OpenAI-compatible model
    on the LiteLLM gateway (``DRAFT_MODEL_NAME``, default llama-3.1-8b-instruct).
    Use this for on-prem / sovereign deployments where department paperwork
    must not leave the network.

Each artifact is defined by a template (fields + structure); the officer's
profile (name, designation, charge) is fed in so the draft is correctly
headed and written from the authority's standpoint.
"""
from __future__ import annotations

import os

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.enums import Domain
from app.models.org import User
from app.services import llm as llm_mod

# Local / self-hosted model — the on-prem fallback path.
_DRAFT_MODEL = os.getenv("DRAFT_MODEL_NAME", "llama-3.1-8b-instruct")
# Vertex model — the default drafting engine. flash-latest is the sweet
# spot for form-driven prose: fast, cheap, and instruction-following.
_DRAFT_VERTEX_MODEL = os.getenv("DRAFT_VERTEX_MODEL", "gemini-flash-latest")
# Route selector. Vertex by default; department deployments can flip to
# "openai" (or "local") to keep everything on the internal gateway.
_DRAFT_BACKEND = os.getenv("DRAFT_LLM_BACKEND", "vertex").strip().lower()


def _draft_llm():
    """Return the drafting LLM client. Vertex by default; on-prem fallback
    on the local LiteLLM gateway when ``DRAFT_LLM_BACKEND`` is anything other
    than ``vertex``. Both clients implement the same `.complete(system,
    user, *, max_tokens=...)` surface, so callers don't branch."""
    if _DRAFT_BACKEND == "vertex":
        return llm_mod.VertexLLM(_DRAFT_VERTEX_MODEL)
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

    # ==== Batch 1 — high-frequency, cross-wing =================================
    "notice_156": {
        "label": "Notice of Demand u/s 156",
        "category": "Notice",
        "section": "156",
        "wings": ["officer", "recovery"],
        "fields": _COMMON + [
            Field("order_ref", "Order raising the demand", placeholder="Assessment order u/s 143(3) dated 20.03.2025"),
            Field("amount", "Sum payable", placeholder="Rs. 12,45,600 (tax Rs. 9,80,000 + interest Rs. 2,65,600)"),
            Field("pay_by", "Payable by (date)", required=False, placeholder="within 30 days of service"),
        ],
        "structure": (
            "a Notice of Demand under section 156 of the Income-tax Act, 1961: office heading of "
            "the ISSUING officer (from ISSUING OFFICER block — the officer serving this demand, "
            "not the officer who passed the underlying order), `DIN: [•]`, `F. No.` with `[•]`, "
            "`Date: [•]`, assessee + PAN + AY, a `Sub:` line naming the underlying order, a "
            "reference paragraph reproducing the underlying order reference EXACTLY as given "
            "(including the designation of the officer who passed it — do not silently retitle it "
            "to match the issuing officer), the amount payable broken into tax / interest u/s "
            "234A/234B/234C / penalty / fee u/s 234F as given, a direction to pay within 30 days "
            "of service of THIS notice at the specified mode, the consequences of non-payment: "
            "(i) simple interest u/s 220(2) at 1% per month or part thereof from the date of "
            "default, (ii) penalty u/s 221 not exceeding the amount of tax in arrears, (iii) "
            "recovery proceedings including garnishee proceedings u/s 226(3), attachment and "
            "sale of movable/immovable property under the Second Schedule read with section "
            "222, and treatment as an assessee-in-default u/s 220(4); the right of appeal to "
            "the CIT(A)/NFAC u/s 246A within 30 days in Form 35, and the option to seek stay "
            "of demand u/s 220(6) pending appeal on payment of 20% of the disputed demand; "
            "close with `Yours faithfully,` then the officer's name, designation and charge on "
            "separate lines. Use ONLY the figures provided."
        ),
    },
    "notice_148A": {
        "label": "Show-cause before reopening u/s 148A(1)",
        "category": "Notice",
        "section": "148A(1)",
        "wings": ["officer"],
        "fields": _COMMON + [
            Field("information", "Information suggesting escapement", textarea=True,
                  placeholder="Insight/AIS information: cash deposits of Rs. 45,00,000 not reconciled with the return for AY 2021-22"),
            Field("escaped", "Income alleged to have escaped", placeholder="Rs. 45,00,000"),
            Field("reply_by", "Reply by (date)", placeholder="18.08.2026"),
        ],
        "structure": (
            "a show-cause notice under section 148A(1) (as substituted by the Finance (No. 2) Act, "
            "2024) before issue of a notice u/s 148: heading, DIN, number and date, assessee + "
            "PAN + AY, a statement that information as per section 148/149 suggests income "
            "chargeable to tax has escaped assessment, the SUBSTANCE of that information and the "
            "amount (name the likely charging provision inferred from the information — "
            "section 68 / 69 / 69A / 56(2) etc. — do not merely say 'the Act'), a call to show "
            "cause within the period specified why a notice u/s 148 should not be issued, a "
            "note that on failure to reply within the stipulated time an order u/s 148A(3) will "
            "be passed on the material available on record deciding whether it is a fit case "
            "for issue of notice u/s 148 within the limitation prescribed by section 149, and "
            "the closing block: `Yours faithfully,` on its own line, then the officer's name, "
            "designation and charge on separate lines. Use only the information provided; do "
            "NOT invent figures."
        ),
    },
    "order_148A": {
        "label": "Order u/s 148A(3) — fit case for reopening",
        "category": "Order",
        "section": "148A(3)",
        "wings": ["officer"],
        "fields": _COMMON + [
            Field("scn_ref", "Show-cause notice reference", placeholder="Notice u/s 148A(1) dated 01.08.2026"),
            Field("reply_gist", "Assessee's reply (gist)", textarea=True, required=False,
                  placeholder="Reply dated 12.08.2026: deposits stated to be business receipts; no evidence filed"),
            Field("decision", "Decision", placeholder="Fit case — notice u/s 148 to be issued"),
        ],
        "structure": (
            "an order under section 148A(3) deciding whether it is a fit case to issue a notice u/s 148: "
            "heading, DIN, number and date, assessee + PAN + AY, reference to the 148A(1) notice and the "
            "information relied on, a fair summary of the assessee's reply, a REASONED consideration of "
            "the reply against the information, the decision (fit / not a fit case) with the sanction of "
            "the specified authority u/s 151, and the officer's designation and charge. Record "
            "application of mind — do not merely conclude."
        ),
    },
    "notice_148": {
        "label": "Notice u/s 148 (reassessment)",
        "category": "Notice",
        "section": "148",
        "wings": ["officer"],
        "fields": _COMMON + [
            Field("order_148a_ref", "Order u/s 148A(3) + sanction", required=False,
                  placeholder="Order u/s 148A(3) dated 20.08.2026; sanction of Addl. CIT, Range-7 dated 20.08.2026"),
            Field("file_by", "Return to be filed by", placeholder="within 3 months"),
        ],
        "structure": (
            "a notice under section 148: heading, DIN, number and date, assessee + PAN + AY, a statement "
            "that the Assessing Officer has information suggesting income chargeable to tax has escaped "
            "assessment and that a notice is issued after the order u/s 148A(3) and the sanction of the "
            "specified authority u/s 151, a requirement to furnish a return of income for the assessment "
            "year within the period stated, and the officer's designation and charge. Reference the "
            "148A(3) order and sanction where provided."
        ),
    },
    "sc_270A": {
        "label": "Penalty show-cause u/s 274 r.w. 270A",
        "category": "Notice",
        "section": "270A",
        "wings": ["officer"],
        "fields": _COMMON + [
            Field("addition", "Addition / variation attracting penalty", textarea=True,
                  placeholder="Addition of Rs. 45,00,000 u/s 69A as unexplained money in the order u/s 143(3)"),
            Field("nature", "Under-reporting or mis-reporting", required=False, placeholder="mis-reporting u/s 270A(9)(a)"),
            Field("reply_by", "Reply by (date)", placeholder="18.08.2026"),
        ],
        "structure": (
            "a penalty show-cause notice under section 274 read with section 270A: heading, DIN, number "
            "and date, assessee + PAN + AY, reference to the assessment order and the addition/variation, "
            "a statement that it amounts to under-reporting (50% of tax) or mis-reporting (200% of tax) "
            "of income with the limb of 270A(9) invoked where mis-reporting is alleged, a call to show "
            "cause why penalty u/s 270A should not be levied, a note of the immunity available u/s 270AA "
            "on payment and non-appeal, the reply-by date, and the officer's designation and charge."
        ),
    },
    "order_201": {
        "label": "Order u/s 201(1)/201(1A) — assessee-in-default (TDS)",
        "category": "Order",
        "section": "201",
        "wings": ["tds"],
        "fields": [
            Field("assessee", "Deductor name", placeholder="M/s ABC Pvt. Ltd."),
            Field("pan", "TAN / PAN", placeholder="DELA12345A"),
            Field("ay", "Financial year", placeholder="2022-23"),
            Field("default", "Default + amount", textarea=True,
                  placeholder="Short deduction of TDS u/s 194C on contractor payments of Rs. 50,00,000; tax short-deducted Rs. 1,00,000"),
            Field("interest", "Interest u/s 201(1A)", required=False, placeholder="Rs. 24,000"),
        ],
        "structure": (
            "an order under section 201(1)/201(1A) treating the deductor as an assessee-in-default: "
            "heading, DIN, number and date, deductor + TAN/PAN + financial year, a reasoned finding of "
            "the default (non-deduction / short-deduction / non-payment) with the amount and the section "
            "under which tax was deductible, the tax held short u/s 201(1), interest u/s 201(1A) "
            "(1%/month for non-deduction, 1.5%/month for deducted-not-paid), the total demand, a note "
            "that a demand notice u/s 156 follows, and the officer's designation and charge. Use only the "
            "figures provided; consider the payee-return proviso to 201(1) if the record shows it."
        ),
    },
    "order_92CA": {
        "label": "Order u/s 92CA(3) — arm's-length price",
        "category": "Order",
        "section": "92CA(3)",
        "wings": ["tp"],
        "fields": _COMMON + [
            Field("transaction", "International / specified domestic transaction", textarea=True,
                  placeholder="Provision of software development services to AE — Rs. 45,00,00,000"),
            Field("method", "Most appropriate method + comparables", textarea=True,
                  placeholder="TNMM; comparables' arm's-length margin 18% vs 11% shown by the assessee"),
            Field("adjustment", "Adjustment to ALP", placeholder="Rs. 3,15,00,000"),
        ],
        "structure": (
            "an order under section 92CA(3) by the Transfer Pricing Officer determining the arm's-length "
            "price: heading of the office of the TPO, DIN, number and date, assessee + PAN + AY, "
            "identification of the international/specified domestic transaction, the most appropriate "
            "method chosen with reasons, the comparables and the arm's-length margin, dealing with the "
            "assessee's objections to the show-cause, the ALP determined and the adjustment computed "
            "exactly, and the TPO's designation and charge. Use only the figures provided; do NOT invent "
            "comparables."
        ),
    },
    "order_281B": {
        "label": "Provisional attachment order u/s 281B",
        "category": "Order",
        "section": "281B",
        "wings": ["recovery"],
        "fields": _COMMON + [
            Field("property", "Property to be attached", textarea=True,
                  placeholder="Bank account no. 001234 with SBI, XYZ Branch; immovable property at ..."),
            Field("proceeding", "Pending proceeding", required=False, placeholder="Assessment u/s 143(3) for AY 2024-25 pending"),
            Field("approval", "Approval of PCIT/CIT", required=False, placeholder="Approval of PCIT, Delhi-3 dated 10.08.2026"),
        ],
        "structure": (
            "an order of provisional attachment under section 281B to protect the interests of revenue: "
            "heading, DIN, number and date, assessee + PAN + AY, a statement that assessment/reassessment "
            "proceedings are pending and that provisional attachment is necessary to protect revenue, the "
            "prior approval of the PCCIT/CCIT/PCIT/CIT, the property attached (specified), a note that the "
            "attachment is valid for six months (extendable to two years), and the officer's designation "
            "and charge. Record the reason to believe; use only the particulars provided."
        ),
    },
    "notice_245": {
        "label": "Intimation of set-off of refund u/s 245",
        "category": "Notice",
        "section": "245",
        "wings": ["recovery", "officer"],
        "fields": _COMMON + [
            Field("refund", "Refund proposed to be set off", placeholder="Refund of Rs. 3,20,000 for AY 2024-25"),
            Field("demand", "Outstanding demand", textarea=True,
                  placeholder="Demand of Rs. 5,10,000 for AY 2021-22 (order u/s 143(3) dated 15.03.2024)"),
            Field("respond_by", "Respond by (date)", placeholder="within 21 days"),
        ],
        "structure": (
            "an intimation under section 245 proposing to set off a refund against an outstanding demand: "
            "heading, DIN, number and date, assessee + PAN, the refund determined and the assessment year "
            "it relates to, the outstanding demand proposed to be adjusted (amount, AY and the order it "
            "arises from), a call to the assessee to respond/agree or object within the period stated "
            "before the adjustment is made, and the officer's designation and charge. Use only the "
            "figures provided."
        ),
    },
    "sc_263": {
        "label": "Show-cause for revision u/s 263",
        "category": "Notice",
        "section": "263",
        "wings": ["cita"],
        "fields": _COMMON + [
            Field("order_ref", "Order sought to be revised", placeholder="Assessment order u/s 143(3) dated 20.03.2024 passed by the ITO, Ward 2(1)"),
            Field("error", "Error / prejudice to revenue", textarea=True,
                  placeholder="AO allowed a deduction of Rs. 30,00,000 u/s 80-IA without verifying the audit report — order erroneous and prejudicial to revenue"),
            Field("hearing_on", "Hearing on (date)", placeholder="20.08.2026"),
        ],
        "structure": (
            "a show-cause notice under section 263(1) by the Principal Commissioner / Commissioner: "
            "heading of the office of the PCIT/CIT, DIN, number and date, assessee + PAN + AY, reference "
            "to the order proposed to be revised, a reasoned statement of why the order is considered "
            "erroneous IN SO FAR AS it is prejudicial to the interests of revenue (the specific error and "
            "the lack of enquiry/verification), a call to show cause why the order should not be revised "
            "u/s 263, the date/mode of hearing, and the revising authority's designation. Record the "
            "twin conditions (erroneous AND prejudicial)."
        ),
    },
    "notice_285BA5": {
        "label": "Notice u/s 285BA(5) — furnish / rectify SFT",
        "category": "Notice",
        "section": "285BA(5)",
        "wings": ["ici"],
        "fields": [
            Field("entity", "Reporting entity", placeholder="XYZ Co-operative Bank Ltd."),
            Field("pan", "PAN / ITDREIN", required=False, placeholder="AAACX1234A / ITDREIN ..."),
            Field("fy", "Financial year", placeholder="2024-25"),
            Field("defect", "Default / defect", textarea=True,
                  placeholder="SFT for cash deposits (Rule 114E) not furnished by the due date of 31 May 2025"),
        ],
        "structure": (
            "a notice under section 285BA(5) to a reporting person/entity to furnish or rectify a "
            "Statement of Financial Transactions: heading of the office of the Director/Jt. Director "
            "(Intelligence & Criminal Investigation) / prescribed authority, number and date, the "
            "reporting entity + PAN/ITDREIN + financial year, a statement that the SFT has not been "
            "furnished or is defective/inaccurate (specifying the defect), a direction to furnish or "
            "rectify it within 30 days, the consequence of non-compliance (penalty u/s 271FA rising from "
            "Rs. 500 to Rs. 1,000 per day, and 271FAA for inaccuracy), and the authority's designation."
        ),
    },
    "summons_131_1A": {
        "label": "Summons u/s 131(1A) (investigation)",
        "category": "Notice",
        "section": "131(1A)",
        "wings": ["investigation"],
        "fields": _COMMON + [
            Field("attend_on", "Date & time to attend", placeholder="20.08.2026 at 11:30 AM"),
            Field("purpose", "Matter under enquiry / documents to produce", textarea=True,
                  placeholder="Enquiry into unaccounted cash transactions; produce bank statements and books for FY 2023-24, and give evidence on oath"),
        ],
        "structure": (
            "a summons under section 131(1A) by the Investigation authority: heading of the office of the "
            "DDIT/ADIT (Investigation), number and date, the name + PAN of the person summoned, a "
            "statement that the authority is making an enquiry/investigation in respect of the matter "
            "even though no proceeding is pending, a direction to attend in person on the stated date and "
            "time to give evidence on oath and/or produce the documents specified, a note of the civil-"
            "court powers and the consequences of non-attendance, and the officer's designation. Do NOT "
            "invent case facts beyond what is provided."
        ),
    },

    # ==== Batch 2 — Penalty family ============================================
    "order_270A": {
        "label": "Penalty order u/s 270A",
        "category": "Order",
        "section": "270A",
        "wings": ["officer"],
        "fields": _COMMON + [
            Field("scn_ref", "Show-cause notice reference", placeholder="Notice u/s 274 r.w. 270A dated 01.08.2026"),
            Field("addition", "Under/mis-reported income + tax", textarea=True,
                  placeholder="Under-reported income Rs. 45,00,000; tax payable thereon Rs. 13,50,000"),
            Field("reply_gist", "Assessee's reply (gist)", required=False, textarea=True),
            Field("nature", "Under-reporting or mis-reporting", placeholder="mis-reporting u/s 270A(9)(a) — misrepresentation of facts"),
        ],
        "structure": (
            "a penalty order under section 270A: heading, DIN, number and date, assessee + PAN + AY, "
            "reference to the show-cause and the assessment addition, a reasoned finding of under-"
            "reporting or mis-reporting (with the limb of 270A(9)), consideration of the assessee's "
            "reply, the tax on the under-reported income, the penalty computed at 50% (under-reporting) "
            "or 200% (mis-reporting) of that tax, a note that a demand notice u/s 156 follows, and the "
            "officer's designation and charge. Use only the figures provided."
        ),
    },
    "order_270AA": {
        "label": "Order on immunity u/s 270AA",
        "category": "Order",
        "section": "270AA",
        "wings": ["officer"],
        "fields": _COMMON + [
            Field("application_ref", "Immunity application (Form 68)", placeholder="Application in Form 68 dated 20.04.2026"),
            Field("conditions", "Conditions verified", required=False, textarea=True,
                  placeholder="Tax + interest per the order paid on 15.04.2026; no appeal filed against the assessment order"),
            Field("decision", "Decision", placeholder="Immunity granted from penalty u/s 270A and prosecution u/s 276C/276CC"),
        ],
        "structure": (
            "an order under section 270AA on an immunity application: heading, DIN, number and date, "
            "assessee + PAN + AY, reference to the Form 68 application, verification that the tax and "
            "interest in the demand notice are paid within the period and that no appeal has been filed, "
            "that the case is not one of mis-reporting u/s 270A(9), the decision granting (or refusing) "
            "immunity from penalty u/s 270A and prosecution u/s 276C/276CC, and the officer's "
            "designation and charge."
        ),
    },
    "sc_271AAC": {
        "label": "Penalty show-cause u/s 271AAC",
        "category": "Notice",
        "section": "271AAC",
        "wings": ["officer"],
        "fields": _COMMON + [
            Field("income", "Income u/s 68/69/69A-D + tax u/s 115BBE", textarea=True,
                  placeholder="Unexplained money Rs. 45,00,000 added u/s 69A, taxed u/s 115BBE (Rs. 27,90,000)"),
            Field("reply_by", "Reply by (date)", placeholder="18.08.2026"),
        ],
        "structure": (
            "a penalty show-cause notice under section 274 read with section 271AAC: heading, DIN, "
            "number and date, assessee + PAN + AY, reference to the assessed income that includes income "
            "referred to in sections 68/69/69A-69D taxed u/s 115BBE, a statement that penalty at 10% of "
            "the tax payable u/s 115BBE is attracted (where not covered by 271AAB), a call to show cause "
            "within the stated period, the reply-by date, and the officer's designation and charge."
        ),
    },
    "sc_271AAB": {
        "label": "Penalty show-cause u/s 271AAB (search)",
        "category": "Notice",
        "section": "271AAB",
        "wings": ["investigation"],
        "fields": _COMMON + [
            Field("search_date", "Date of search u/s 132", placeholder="12.09.2024"),
            Field("undisclosed", "Undisclosed income of the specified year", textarea=True,
                  placeholder="Undisclosed income of Rs. 1,20,00,000 admitted in the statement u/s 132(4) / found in seized material"),
            Field("reply_by", "Reply by (date)", placeholder="18.08.2026"),
        ],
        "structure": (
            "a penalty show-cause notice under section 274 read with section 271AAB: heading, DIN, "
            "number and date, assessee + PAN + AY, reference to the search u/s 132 and the undisclosed "
            "income of the specified previous year (from the 132(4) statement / seized material), a "
            "statement of the penalty attracted (30% where admitted, substantiated and tax paid; 60% "
            "otherwise, under 271AAB(1A) for searches on/after 15.12.2016), a call to show cause, the "
            "reply-by date, and the officer's designation and charge. Use only figures on record."
        ),
    },
    "sc_271AAD": {
        "label": "Penalty show-cause u/s 271AAD (false entries)",
        "category": "Notice",
        "section": "271AAD",
        "wings": ["officer"],
        "fields": _COMMON + [
            Field("entries", "False / omitted entries", textarea=True,
                  placeholder="Bogus purchase invoices of Rs. 60,00,000 from non-existent parties found in the books"),
            Field("reply_by", "Reply by (date)", placeholder="18.08.2026"),
        ],
        "structure": (
            "a penalty show-cause notice under section 274 read with section 271AAD: heading, DIN, "
            "number and date, assessee + PAN + AY, a statement that the books of account contain a false "
            "entry or omit an entry relevant to evade tax (describe the entry), that penalty equal to the "
            "aggregate amount of such false/omitted entries is attracted, a call to show cause within the "
            "stated period, the reply-by date, and the officer's designation and charge."
        ),
    },
    "sc_271B": {
        "label": "Penalty show-cause u/s 271B (audit)",
        "category": "Notice",
        "section": "271B",
        "wings": ["officer"],
        "fields": _COMMON + [
            Field("turnover", "Turnover / gross receipts", placeholder="Rs. 4,20,00,000 (exceeds the §44AB threshold)"),
            Field("default", "Default", required=False, placeholder="Tax-audit report u/s 44AB not obtained / not furnished by the due date"),
            Field("reply_by", "Reply by (date)", placeholder="18.08.2026"),
        ],
        "structure": (
            "a penalty show-cause notice under section 274 read with section 271B: heading, DIN, number "
            "and date, assessee + PAN + AY, a statement that the assessee was required to get the "
            "accounts audited u/s 44AB (turnover/receipts exceeding the threshold) and failed to obtain / "
            "furnish the report by the due date, that penalty of 0.5% of turnover (max Rs. 1,50,000) is "
            "attracted, a call to show cause, the reply-by date, and the officer's designation. Note the "
            "reasonable-cause defence u/s 273B."
        ),
    },
    "sc_271D_E": {
        "label": "Penalty show-cause u/s 271D / 271E (cash loan/repayment)",
        "category": "Notice",
        "section": "271D/271E",
        "wings": ["officer"],
        "fields": _COMMON + [
            Field("provision", "Provision contravened", placeholder="269SS (acceptance) — penalty u/s 271D  /  269T (repayment) — penalty u/s 271E"),
            Field("transaction", "Cash transaction", textarea=True,
                  placeholder="Loan of Rs. 8,00,000 accepted in cash from XYZ on 10.06.2024 in contravention of §269SS"),
            Field("reply_by", "Reply by (date)", placeholder="18.08.2026"),
        ],
        "structure": (
            "a penalty show-cause notice (levied by the Joint Commissioner) under section 274 read with "
            "section 271D (for §269SS acceptance) or 271E (for §269T repayment): heading, DIN, number and "
            "date, assessee + PAN + AY, the cash transaction and the provision contravened, that penalty "
            "equal to the amount of the loan/deposit/repayment is attracted, a call to show cause, the "
            "reply-by date, the reasonable-cause defence u/s 273B, and the officer's designation."
        ),
    },
    "sc_271DA": {
        "label": "Penalty show-cause u/s 271DA (cash receipt ≥ ₹2 lakh)",
        "category": "Notice",
        "section": "271DA",
        "wings": ["officer"],
        "fields": _COMMON + [
            Field("receipt", "Cash receipt in contravention of §269ST", textarea=True,
                  placeholder="Cash of Rs. 3,50,000 received from a single person in a day against one bill on 05.07.2024"),
            Field("reply_by", "Reply by (date)", placeholder="18.08.2026"),
        ],
        "structure": (
            "a penalty show-cause notice under section 274 read with section 271DA: heading, DIN, number "
            "and date, assessee + PAN + AY, a statement that the assessee received Rs. 2,00,000 or more "
            "in cash in contravention of section 269ST (in aggregate from a person in a day / for a "
            "single transaction / for transactions relating to one event), that penalty equal to the "
            "amount received is attracted, a call to show cause, the reply-by date, and the officer's "
            "designation."
        ),
    },
    "sc_272A": {
        "label": "Penalty show-cause u/s 272A (non-compliance)",
        "category": "Notice",
        "section": "272A",
        "wings": ["officer"],
        "fields": _COMMON + [
            Field("default", "Non-compliance", textarea=True,
                  placeholder="Failure to comply with the notice u/s 142(1) dated 01.07.2026 despite reminders"),
            Field("reply_by", "Reply by (date)", placeholder="18.08.2026"),
        ],
        "structure": (
            "a penalty show-cause notice under section 274 read with section 272A: heading, DIN, number "
            "and date, assessee + PAN + AY, a statement of the non-compliance (failure to answer / sign / "
            "attend / comply with a notice u/s 142(1)/143(2)/142(2A) under 272A(1)(d), or a 272A(2) "
            "failure), the penalty attracted (Rs. 10,000 per default under 272A(1); Rs. 100–500/day under "
            "272A(2)), a call to show cause, the reply-by date, and the officer's designation."
        ),
    },
    "order_273B": {
        "label": "Order dropping penalty (reasonable cause) u/s 273B",
        "category": "Order",
        "section": "273B",
        "wings": ["officer"],
        "fields": _COMMON + [
            Field("penalty_ref", "Penalty proceeding", placeholder="Penalty u/s 271B initiated vide notice dated 01.08.2026"),
            Field("cause", "Reasonable cause shown", textarea=True,
                  placeholder="Delay in audit due to the sudden demise of the accountant; report obtained and filed within a month"),
        ],
        "structure": (
            "an order dropping penalty under section 273B: heading, DIN, number and date, assessee + PAN "
            "+ AY, reference to the penalty proceeding, the reasonable cause shown by the assessee, a "
            "reasoned finding that reasonable cause is established for the failure (a specified default "
            "covered by 273B), the decision that no penalty is imposable, and the officer's designation "
            "and charge."
        ),
    },

    # ==== Batch 3 — Recovery / TRO ============================================
    "order_stay_220": {
        "label": "Order of stay of demand u/s 220(6)",
        "category": "Order",
        "section": "220(6)",
        "wings": ["recovery"],
        "fields": _COMMON + [
            Field("demand", "Disputed demand", placeholder="Rs. 50,00,000 (order u/s 143(3) dated 15.03.2025)"),
            Field("appeal", "Appeal pending", required=False, placeholder="Appeal before CIT(A) filed on 10.04.2025"),
            Field("deposit", "Deposit / condition", required=False, placeholder="20% (Rs. 10,00,000) paid on 12.04.2025"),
        ],
        "structure": (
            "an order under section 220(6) treating the assessee as not being in default and staying "
            "recovery of the demand pending the first appeal: heading, DIN, number and date, assessee + "
            "PAN + AY, reference to the demand and the pending appeal, the officer's consideration in "
            "light of CBDT Instruction No. 1914 as modified by O.M. dated 31.07.2017 (ordinarily 20% "
            "deposit), the amount stayed and the conditions imposed (deposit paid / to be paid, no "
            "further stay of coercive recovery), the period of stay (till disposal of appeal or a stated "
            "date), and the officer's designation and charge. Use only the figures provided."
        ),
    },
    "order_179": {
        "label": "Order u/s 179 — director's joint liability",
        "category": "Order",
        "section": "179",
        "wings": ["recovery"],
        "fields": _COMMON + [
            Field("company", "Private company + arrears", textarea=True,
                  placeholder="Tax arrears of Rs. 42,00,000 of M/s ABC Pvt. Ltd. (PAN AAACA1234A) for AY 2020-21 could not be recovered"),
            Field("director", "Director sought to be made liable", placeholder="Shri XYZ, director during the relevant previous year"),
        ],
        "structure": (
            "an order under section 179 holding a director of a private company jointly and severally "
            "liable for the company's tax arrears: heading, DIN, number and date, the director + PAN, "
            "the company + PAN + AY, a finding that the tax due from the private company for the relevant "
            "previous year cannot be recovered from the company, that the person was a director during "
            "that year, a reasoned rejection of any plea that the non-recovery is not attributable to his "
            "gross neglect/misfeasance/breach of duty, the amount for which he is held liable, and the "
            "officer's designation and charge."
        ),
    },
    "order_167C": {
        "label": "Order u/s 167C — LLP partner's joint liability",
        "category": "Order",
        "section": "167C",
        "wings": ["recovery"],
        "fields": _COMMON + [
            Field("llp", "LLP + arrears", textarea=True,
                  placeholder="Tax arrears of Rs. 18,00,000 of M/s ABC LLP for AY 2021-22 not recoverable from the LLP"),
            Field("partner", "Partner sought to be made liable", placeholder="Shri XYZ, partner during the relevant previous year"),
        ],
        "structure": (
            "an order under section 167C holding a partner of a limited liability partnership jointly and "
            "severally liable for the LLP's tax arrears: heading, DIN, number and date, the partner + PAN, "
            "the LLP + PAN + AY, a finding that the tax due from the LLP cannot be recovered from it, that "
            "the person was a partner during the relevant year, a reasoned dealing with any plea of "
            "non-attribution to gross neglect/breach, the amount for which he is held liable, and the "
            "officer's designation and charge."
        ),
    },
    "cert_222": {
        "label": "Tax Recovery Certificate u/s 222",
        "category": "Certificate",
        "section": "222",
        "wings": ["recovery"],
        "fields": _COMMON + [
            Field("arrears", "Arrears (tax + interest + penalty)", textarea=True,
                  placeholder="Rs. 62,45,000 (tax Rs. 50,00,000 + interest u/s 220(2) Rs. 8,45,000 + penalty Rs. 4,00,000)"),
            Field("order_ref", "Order(s) creating the demand", required=False, placeholder="Order u/s 143(3) dated 15.03.2024; demand notice u/s 156"),
        ],
        "structure": (
            "a Tax Recovery Certificate drawn up by the Tax Recovery Officer under section 222: heading of "
            "the office of the TRO, certificate number and date, the defaulter + PAN + AY, a statement "
            "that the assessee is in default (or deemed in default) in respect of the arrears specified, "
            "the amount of arrears broken into tax / interest / penalty, a statement that the TRO shall "
            "proceed to recover the amount by the modes in the Second Schedule (attachment & sale of "
            "movable/immovable property, arrest & detention, appointment of receiver), and the TRO's "
            "signature and designation. Use only the figures provided."
        ),
    },
    "notice_226_2": {
        "label": "Notice u/s 226(2) — attachment of salary",
        "category": "Notice",
        "section": "226(2)",
        "wings": ["recovery"],
        "fields": _COMMON + [
            Field("employer", "Employer / disbursing officer", placeholder="The DDO, XYZ Ltd., Delhi"),
            Field("arrears", "Arrears outstanding", placeholder="Rs. 3,20,000"),
            Field("amount", "Amount to deduct", required=False, placeholder="Rs. 25,000 per month until recovered"),
        ],
        "structure": (
            "a notice under section 226(2) requiring an employer to deduct arrears from the defaulter's "
            "salary: heading, number and date, the employer/DDO addressed, the assessee-employee + PAN, "
            "the arrears outstanding, a direction to deduct the stated amount from the salary payable and "
            "remit it to the credit of the Central Government until the arrears are cleared (subject to "
            "the exemptions under the Code of Civil Procedure), the consequence of non-compliance, and "
            "the officer's designation and charge."
        ),
    },
    "itcp1_demand": {
        "label": "Second Schedule — notice of demand (ITCP-1)",
        "category": "Notice",
        "section": "Sch.II r.2",
        "wings": ["recovery"],
        "fields": _COMMON + [
            Field("cert_ref", "Recovery certificate reference", placeholder="TRC No. 45/2026 dated 01.08.2026"),
            Field("arrears", "Arrears payable", placeholder="Rs. 62,45,000"),
        ],
        "structure": (
            "a notice of demand under rule 2 of the Second Schedule (Form ITCP-1) issued by the Tax "
            "Recovery Officer on drawing up the certificate: heading of the TRO's office, number and "
            "date, the defaulter + PAN, reference to the recovery certificate and the arrears specified, "
            "a requirement to pay the amount within 15 days of service, a warning that on default the "
            "TRO shall proceed to realise the amount by attachment and sale of property or by arrest and "
            "detention, and the TRO's signature and designation."
        ),
    },
    "itcp_attach": {
        "label": "Second Schedule — order of attachment (movable/immovable)",
        "category": "Order",
        "section": "Sch.II r.20/48",
        "wings": ["recovery"],
        "fields": _COMMON + [
            Field("property", "Property to be attached", textarea=True,
                  placeholder="Immovable property: plot no. 12, Sector 5, ... / Movable: stock, vehicle no. DL-1C-1234"),
            Field("arrears", "Arrears", placeholder="Rs. 62,45,000"),
        ],
        "structure": (
            "an order of attachment under the Second Schedule (Form ITCP-2 for movable / ITCP-16 for "
            "immovable property) by the Tax Recovery Officer: heading of the TRO's office, number and "
            "date, the defaulter + PAN, reference to the certificate and the arrears, the property "
            "attached (fully described), a prohibition on the defaulter from transferring or charging the "
            "property and on any person from taking any benefit under such transfer, that the attachment "
            "continues until further order, and the TRO's signature and designation. Use only the "
            "particulars provided."
        ),
    },
    "itcp13_sale": {
        "label": "Second Schedule — proclamation of sale (ITCP-13)",
        "category": "Notice",
        "section": "Sch.II r.38/52",
        "wings": ["recovery"],
        "fields": _COMMON + [
            Field("property", "Property to be sold", textarea=True,
                  placeholder="Immovable property attached vide order dated 01.08.2026 — plot no. 12, Sector 5, ..."),
            Field("sale_on", "Date, time & place of sale", placeholder="20.09.2026 at 11:00 AM at the office of the TRO"),
            Field("reserve", "Arrears / reserve price", required=False, placeholder="Arrears Rs. 62,45,000; reserve price Rs. 80,00,000"),
        ],
        "structure": (
            "a proclamation of sale under the Second Schedule (Form ITCP-13) by the Tax Recovery Officer: "
            "heading of the TRO's office, number and date, the defaulter + PAN, the property to be sold "
            "(fully described), the arrears for which it is sold, the date, time and place of the public "
            "auction, the reserve price and terms/conditions of sale (deposit, encumbrances known), a "
            "note of the right to have the sale set aside on deposit/irregularity, and the TRO's "
            "signature and designation. Use only the particulars provided."
        ),
    },
    "itcp25_arrest": {
        "label": "Second Schedule — show-cause before arrest (ITCP-25)",
        "category": "Notice",
        "section": "Sch.II r.73",
        "wings": ["recovery"],
        "fields": _COMMON + [
            Field("arrears", "Arrears outstanding", placeholder="Rs. 62,45,000"),
            Field("grounds", "Grounds (means / dissipation)", textarea=True, required=False,
                  placeholder="Defaulter has the means to pay but is dishonestly transferring assets to defeat recovery"),
            Field("appear_on", "Appear on (date)", placeholder="20.08.2026 at 11:00 AM"),
        ],
        "structure": (
            "a notice under rule 73 of the Second Schedule (Form ITCP-25) calling upon the defaulter to "
            "show cause why he should not be committed to civil prison: heading of the TRO's office, "
            "number and date, the defaulter + PAN, the arrears outstanding, the grounds (that he has, or "
            "has had since the certificate, the means to pay and refuses/neglects, or is dishonestly "
            "dissipating assets), a direction to appear before the TRO on the stated date to show cause "
            "against arrest and detention, and the TRO's signature and designation. This is a "
            "show-cause, not a warrant."
        ),
    },

    # ==== Batch 4 — TDS / TCS =================================================
    "sc_206C": {
        "label": "Show-cause u/s 206C(6A) (TCS default)",
        "category": "Notice",
        "section": "206C(6A)",
        "wings": ["tds"],
        "fields": [
            Field("assessee", "Collector name", placeholder="M/s ABC Traders Pvt. Ltd."),
            Field("pan", "TAN / PAN", placeholder="DELA12345A"),
            Field("ay", "Financial year", placeholder="2023-24"),
            Field("default", "TCS default + amount", textarea=True,
                  placeholder="Failure to collect TCS u/s 206C(1H) on sale of goods of Rs. 2,10,00,000; tax not collected Rs. 21,000"),
            Field("comply_by", "Reply by (date)", placeholder="18.08.2026"),
        ],
        "structure": (
            "a show-cause notice under section 206C(6A) before treating the collector as an assessee-in-"
            "default: heading, DIN, number and date, the collector + TAN/PAN + financial year, the TCS "
            "default (non-collection / short-collection / non-payment) with the amount and the sub-"
            "section under which tax was collectible, a call to show cause why he should not be deemed in "
            "default with interest u/s 206C(7), the reply-by date, and the officer's designation."
        ),
    },
    "sc_271C": {
        "label": "Penalty show-cause u/s 271C / 271CA (TDS/TCS)",
        "category": "Notice",
        "section": "271C",
        "wings": ["tds"],
        "fields": [
            Field("assessee", "Deductor / collector", placeholder="M/s ABC Pvt. Ltd."),
            Field("pan", "TAN / PAN", placeholder="DELA12345A"),
            Field("ay", "Financial year", placeholder="2022-23"),
            Field("default", "Default + amount", textarea=True,
                  placeholder="Failure to deduct TDS u/s 194J of Rs. 1,00,000 on professional fees"),
            Field("comply_by", "Reply by (date)", placeholder="18.08.2026"),
        ],
        "structure": (
            "a penalty show-cause notice under section 274 read with section 271C (TDS non-deduction) or "
            "271CA (TCS non-collection): heading, DIN, number and date, the deductor/collector + TAN/PAN "
            "+ financial year, the default and the amount of tax not deducted/collected, a statement that "
            "penalty equal to that tax is attracted (levied by the Joint Commissioner), the reasonable-"
            "cause defence u/s 273B, a call to show cause, the reply-by date, and the officer's "
            "designation."
        ),
    },
    "order_271H": {
        "label": "Penalty order u/s 271H (TDS/TCS statement)",
        "category": "Order",
        "section": "271H",
        "wings": ["tds"],
        "fields": [
            Field("assessee", "Deductor / collector", placeholder="M/s ABC Pvt. Ltd."),
            Field("pan", "TAN / PAN", placeholder="DELA12345A"),
            Field("ay", "Financial year + quarter", placeholder="Q2 FY 2023-24"),
            Field("default", "Default", textarea=True,
                  placeholder="TDS statement in Form 26Q for Q2 FY 2023-24 not furnished within one year of the due date"),
        ],
        "structure": (
            "a penalty order under section 271H for failure to furnish, or furnishing an incorrect, "
            "TDS/TCS statement: heading, DIN, number and date, the deductor/collector + TAN/PAN + period, "
            "a reasoned finding of the default, the penalty of Rs. 10,000 to Rs. 1,00,000 imposed, a note "
            "that no penalty is imposable if the statement is filed within a year with tax, interest and "
            "fee paid, and the officer's designation. Use only the figures provided."
        ),
    },
    "cert_197": {
        "label": "Certificate u/s 197 (lower / nil TDS)",
        "category": "Certificate",
        "section": "197",
        "wings": ["tds"],
        "fields": _COMMON + [
            Field("nature", "Nature of payment", placeholder="Contract receipts u/s 194C / rent u/s 194-I"),
            Field("rate", "Rate / amount certified", placeholder="TDS @ 0.5% (or nil) on receipts up to Rs. 2,00,00,000"),
            Field("valid", "Valid for", required=False, placeholder="FY 2026-27"),
        ],
        "structure": (
            "a certificate under section 197 for deduction of tax at a lower rate or no deduction: "
            "heading, certificate number and date, the applicant (payee) + PAN, the nature of the "
            "payment and the payer (if specified), a statement that on the application in Form 13 and the "
            "existing/estimated total income the tax may be deducted at the certified lower rate or nil, "
            "the rate/amount and the ceiling, the validity period and conditions (Rule 28AA), and the "
            "officer's designation. Use only the particulars provided."
        ),
    },
    "notice_133A_2A": {
        "label": "TDS verification survey u/s 133A(2A)",
        "category": "Letter",
        "section": "133A(2A)",
        "wings": ["tds"],
        "fields": [
            Field("assessee", "Deductor", placeholder="M/s ABC Pvt. Ltd."),
            Field("pan", "TAN / PAN", placeholder="DELA12345A"),
            Field("premises", "Premises", required=False, placeholder="Registered office at ..."),
            Field("scope", "Scope of verification", textarea=True, required=False,
                  placeholder="Verify TDS compliance on contractor, rent and professional payments for FY 2023-24"),
        ],
        "structure": (
            "a communication for a TDS/TCS verification survey under section 133A(2A): heading of the "
            "office of the AO(TDS)/ITO(TDS), number and date, the deductor + TAN/PAN, a statement that "
            "the authority may enter the place of business to verify that tax has been deducted/collected "
            "and paid in accordance with Chapter XVII, the scope of verification, the books/records to be "
            "kept ready, the powers under 133A, and the officer's designation. Not a search — no seizure."
        ),
    },

    # ==== Batch 4 — Exemptions (Trusts & Institutions) ========================
    "notice_12AB_docs": {
        "label": "Call for documents on registration u/s 12AB",
        "category": "Notice",
        "section": "12AB(1)(b)",
        "wings": ["tds"],
        "fields": _COMMON + [
            Field("application", "Registration application", placeholder="Application in Form 10AB dated 30.06.2026 for regular registration"),
            Field("documents", "Documents / information required", textarea=True,
                  placeholder="Trust deed, activity report and accounts for 3 years, details of donations, and compliance with other laws"),
            Field("furnish_by", "Furnish by (date)", placeholder="18.08.2026"),
        ],
        "structure": (
            "a notice under section 12AB(1)(b)(i) by the Commissioner (Exemptions) calling for documents "
            "on a registration application: heading of the office of the CIT (Exemptions), number and "
            "date, the applicant trust/institution + PAN, reference to the Form 10AB application, a "
            "numbered list of the documents/information required to verify the genuineness of activities "
            "and compliance with the requirements of any other law, the date to furnish them, and the "
            "authority's designation. Use only the particulars provided."
        ),
    },
    "sc_12AB_cancel": {
        "label": "Show-cause for cancellation of registration u/s 12AB(4)",
        "category": "Notice",
        "section": "12AB(4)",
        "wings": ["tds"],
        "fields": _COMMON + [
            Field("violation", "Specified violation", textarea=True,
                  placeholder="Income applied for the benefit of a specified person u/s 13(1)(c); activities not carried on in accordance with the objects"),
            Field("reply_by", "Reply by (date)", placeholder="18.08.2026"),
        ],
        "structure": (
            "a show-cause notice under section 12AB(4) before cancellation of registration: heading of "
            "the office of the CIT (Exemptions), number and date, the trust/institution + PAN, a "
            "statement of the specified violation noticed (or referred by the AO) — e.g. a section 13 "
            "breach, non-genuine activity, or non-compliance with the requirements of other laws — a "
            "call to show cause why the registration should not be cancelled, the reply-by date, and the "
            "authority's designation."
        ),
    },
    "sc_115TD": {
        "label": "Show-cause on exit tax u/s 115TD (accreted income)",
        "category": "Notice",
        "section": "115TD",
        "wings": ["tds"],
        "fields": _COMMON + [
            Field("trigger", "Trigger event", placeholder="Registration u/s 12AB cancelled on 20.03.2026 / trust converted / dissolved"),
            Field("assets", "Assets & liabilities (for accreted income)", textarea=True, required=False,
                  placeholder="FMV of total assets Rs. 8,50,00,000 less liabilities Rs. 1,00,00,000 as on the specified date"),
            Field("reply_by", "Reply by (date)", placeholder="18.08.2026"),
        ],
        "structure": (
            "a show-cause notice under section 115TD on tax on accreted income (exit tax): heading of the "
            "office of the AO (Exemptions), DIN, number and date, the trust/institution + PAN, the "
            "trigger event (cancellation of registration / conversion into a non-eligible form / merger / "
            "failure to transfer assets on dissolution within 12 months), a statement that additional "
            "income-tax at the maximum marginal rate on the accreted income (FMV of assets less "
            "liabilities on the specified date) is chargeable, a call to show cause with the computation, "
            "the reply-by date, and the officer's designation. Use only the figures provided."
        ),
    },
    "sc_13": {
        "label": "Show-cause denying exemption u/s 13 r.w. 11",
        "category": "Notice",
        "section": "13",
        "wings": ["tds"],
        "fields": _COMMON + [
            Field("violation", "§13 violation", textarea=True,
                  placeholder="Loan of Rs. 20,00,000 given to a trustee (specified person u/s 13(3)) without adequate security/interest"),
            Field("reply_by", "Reply by (date)", placeholder="18.08.2026"),
        ],
        "structure": (
            "a show-cause notice proposing to deny exemption u/s 11/12 by virtue of section 13: heading, "
            "DIN, number and date, the trust/institution + PAN + AY, the violation under section 13(1)(c)/"
            "(d) (income or property applied for the benefit of a specified person, or funds invested in "
            "contravention), a statement that the relevant income is therefore not exempt and is proposed "
            "to be brought to tax (at the maximum marginal rate where applicable), a call to show cause, "
            "the reply-by date, and the officer's designation. Use only the facts provided."
        ),
    },

    # ==== Batch 5 — Transfer Pricing / DRP ====================================
    "order_92CA_1": {
        "label": "Reference to TPO u/s 92CA(1)",
        "category": "Order",
        "section": "92CA(1)",
        "wings": ["tp"],
        "fields": _COMMON + [
            Field("transactions", "International / specified domestic transactions", textarea=True,
                  placeholder="Provision of software development services to AE Rs. 45 cr; intra-group services Rs. 8 cr"),
            Field("approval", "Approval of PCIT/CIT", required=False, placeholder="Approval of PCIT-1 dated 10.08.2026"),
        ],
        "structure": (
            "a reference under section 92CA(1) by the Assessing Officer to the Transfer Pricing Officer: "
            "heading, DIN, number and date, assessee + PAN + AY, a statement that the assessee has "
            "entered into international transactions / specified domestic transactions (listed), that the "
            "AO considers it necessary/expedient to refer the computation of the arm's-length price to "
            "the TPO, the prior approval of the PCIT/CIT, and the AO's designation. Use only the "
            "particulars provided."
        ),
    },
    "notice_92D": {
        "label": "Notice u/s 92D — TP documentation",
        "category": "Notice",
        "section": "92D",
        "wings": ["tp"],
        "fields": _COMMON + [
            Field("documents", "Documents / information required", textarea=True,
                  placeholder="Rule 10D documentation, FAR analysis, comparables study and the Master File for the international transactions"),
            Field("furnish_by", "Furnish within", placeholder="30 days"),
        ],
        "structure": (
            "a notice under section 92D read with Rule 10D requiring the assessee to furnish transfer-"
            "pricing documentation: heading of the office of the TPO/AO, DIN, number and date, assessee + "
            "PAN + AY, a direction to furnish the prescribed information and documents maintained in "
            "respect of the international/specified domestic transactions (including the Master File where "
            "applicable) within the period (30 days, extendable by 30), the consequence of failure "
            "(penalty u/s 271AA/271G), and the officer's designation. Use only the particulars provided."
        ),
    },
    "order_144C_1": {
        "label": "Draft assessment order u/s 144C(1)",
        "category": "Order",
        "section": "144C(1)",
        "wings": ["drp"],
        "fields": _COMMON + [
            Field("variation", "Proposed variation", textarea=True,
                  placeholder="Transfer-pricing adjustment of Rs. 3,15,00,000 per the TPO's order; disallowance of Rs. 40,00,000"),
            Field("returned", "Returned income", required=False, placeholder="Rs. 12,00,00,000"),
        ],
        "structure": (
            "a DRAFT assessment order under section 144C(1) for an eligible assessee: office "
            "heading, `DIN: [•]`, `F. No.` with `[•]`, `Date: [•]`, assessee + PAN + AY, a "
            "`Sub:` line, an opening paragraph stating that the assessee IS an eligible "
            "assessee within the meaning of section 144C(15)(b) (either a foreign company, or "
            "any person in whose case a variation arises from the TPO's order u/s 92CA(3)), a "
            "paragraph stating the returned income (as given in the FACTS block — if not given, "
            "write `[•]`; do NOT invent the date of filing the return), an issue-wise "
            "discussion of EACH proposed variation prejudicial to the assessee: TP adjustment "
            "u/s 92CA(3) (extract the TPO order number and date from the variation text "
            "exactly), corporate-tax disallowances — cite the correct sub-clause EVERY TIME, "
            "in BOTH the paragraph heading AND the computation-table row: u/s 40(a)(i) for "
            "non-resident payment TDS default, u/s 40(a)(ia) for resident payment TDS "
            "default, u/s 43B(a) for statutory dues (tax, duty, cess, fee under any law — "
            "GST included) unpaid before the due date u/s 139(1). Never write bare `Section "
            "43B` or bare `Section 40(a)` — always the sub-clause. Any other proposed "
            "additions get the exact charging clause. Then the draft computed total income "
            "table (Returned → each Variation → Draft Assessed Income), followed by a "
            "MANDATORY closing paragraph stating: (i) this is a DRAFT ORDER under section "
            "144C(1) — no demand is being raised on this draft; (ii) the assessee may within "
            "30 days of receipt either (a) file its acceptance of the variations with the AO, "
            "or (b) file objections with the Dispute Resolution Panel u/s 144C(2) in Form 35A "
            "with a copy to the AO; (iii) if the DRP option is exercised, the AO shall "
            "complete the assessment in conformity with the DRP's directions u/s 144C(13); "
            "(iv) failing either action within 30 days, a final assessment order u/s 144C(3) "
            "will be passed on the terms of this draft. Close with `Yours faithfully,` then "
            "the officer's name, designation and charge on separate lines. Use only the "
            "figures provided."
        ),
    },
    "order_144C_5": {
        "label": "DRP directions u/s 144C(5)",
        "category": "Order",
        "section": "144C(5)",
        "wings": ["drp"],
        "fields": _COMMON + [
            Field("objections", "Objections considered", textarea=True,
                  placeholder="Objection to comparables selection and to the disallowance u/s 14A"),
            Field("directions", "Directions", textarea=True,
                  placeholder="Exclude comparable X; re-work the margin; sustain the 14A disallowance to the extent of exempt income"),
        ],
        "structure": (
            "binding directions under section 144C(5) by the Dispute Resolution Panel: heading of the "
            "DRP (three PCIT/CIT), DIN, number and date, assessee + PAN + AY, reference to the draft "
            "order and the objections filed, an objection-wise reasoned consideration, the DIRECTIONS "
            "issued to the Assessing Officer (confirm / reduce / vary — the DRP cannot set aside or "
            "remand), a note that the directions are binding and the AO shall complete the assessment in "
            "conformity within one month, and the Panel's designation. Use only the material provided."
        ),
    },

    # ==== Batch 5 — Appeals & Revision ========================================
    "notice_251": {
        "label": "Notice of enhancement u/s 251(2)",
        "category": "Notice",
        "section": "251(2)",
        "wings": ["cita"],
        "fields": _COMMON + [
            Field("appeal_no", "Appeal number", required=False, placeholder="CIT(A)/NFAC/12345/2024-25"),
            Field("enhancement", "Proposed enhancement", textarea=True,
                  placeholder="Proposed to enhance the assessment by Rs. 20,00,000 on account of an unexamined capital gain"),
            Field("reply_by", "Reply by (date)", placeholder="18.08.2026"),
        ],
        "structure": (
            "a notice of enhancement under section 251(2) by the CIT(A)/NFAC: heading, appeal number, "
            "date, the appellant + PAN + AY, a statement of the proposed enhancement of the assessment / "
            "penalty and the basis for it, that no enhancement shall be made without a reasonable "
            "opportunity, a call to show cause why the assessment should not be enhanced, the reply-by "
            "date, and the appellate authority's designation. Use only the facts provided."
        ),
    },
    "letter_46A": {
        "label": "Remand-report / additional-evidence call (Rule 46A)",
        "category": "Letter",
        "section": "250(4) r.w. 46A",
        "wings": ["cita"],
        "fields": _COMMON + [
            Field("appeal_no", "Appeal number", required=False, placeholder="CIT(A)/NFAC/12345/2024-25"),
            Field("evidence", "Additional evidence / matter for remand", textarea=True,
                  placeholder="Bank confirmations and ledger filed as additional evidence under Rule 46A — remand report called"),
            Field("report_by", "Report by (date)", placeholder="18.08.2026"),
        ],
        "structure": (
            "a communication from the CIT(A)/NFAC to the Assessing Officer calling a remand report on "
            "additional evidence under section 250(4) read with Rule 46A: heading, appeal number, date, "
            "the appellant + PAN + AY, a description of the additional evidence admitted / the matter on "
            "which enquiry is directed, a direction to the AO to examine it and submit a remand report by "
            "the stated date after allowing the appellant an opportunity, and the appellate authority's "
            "designation."
        ),
    },
    "order_263": {
        "label": "Revision order u/s 263",
        "category": "Order",
        "section": "263",
        "wings": ["cita"],
        "fields": _COMMON + [
            Field("order_ref", "Order revised", placeholder="Assessment order u/s 143(3) dated 20.03.2024 by the ITO, Ward 2(1)"),
            Field("error", "Error + prejudice", textarea=True,
                  placeholder="Deduction of Rs. 30,00,000 u/s 80-IA allowed without verifying the audit report — erroneous and prejudicial to revenue"),
            Field("direction", "Direction", required=False, placeholder="Set aside and remit for fresh assessment on this issue"),
        ],
        "structure": (
            "a revision order under section 263(1) by the Principal Commissioner / Commissioner: heading "
            "of the office of the PCIT/CIT, DIN, number and date, assessee + PAN + AY, reference to the "
            "order revised and the show-cause, a reasoned finding that the order is erroneous IN SO FAR "
            "AS it is prejudicial to the interests of revenue (the twin conditions), consideration of the "
            "assessee's reply, and the direction (modify / enhance / set aside and direct a fresh "
            "assessment on the specified issue), and the revising authority's designation. Record both "
            "limbs — erroneous AND prejudicial."
        ),
    },
    "order_264": {
        "label": "Order on revision application u/s 264",
        "category": "Order",
        "section": "264",
        "wings": ["cita"],
        "fields": _COMMON + [
            Field("application", "Application + order sought to be revised", textarea=True,
                  placeholder="Application dated 10.05.2026 against the intimation u/s 143(1) — relief for TDS credit of Rs. 1,20,000 not allowed"),
            Field("decision", "Relief", required=False, placeholder="Allow the TDS credit; direct rectification"),
        ],
        "structure": (
            "an order under section 264(1) on an assessee's revision application: heading of the office of "
            "the PCIT/CIT, DIN, number and date, assessee + PAN + AY, reference to the application and "
            "the order sought to be revised, a reasoned consideration of the grievance, the relief "
            "granted (the order cannot be revised prejudicially to the assessee), a direction to the AO "
            "to give effect, and the authority's designation. Use only the facts provided."
        ),
    },
    "order_oge": {
        "label": "Order Giving Effect (appellate / ITAT / revision)",
        "category": "Order",
        "section": "143(3) r.w. 250/254",
        "wings": ["officer", "cita"],
        "fields": _COMMON + [
            Field("appellate_ref", "Appellate / ITAT / revisional order", placeholder="CIT(A) order in appeal no. 12345 dated 10.06.2026"),
            Field("directions", "Directions to give effect to", textarea=True,
                  placeholder="Addition of Rs. 45,00,000 u/s 69A deleted; disallowance of Rs. 5,00,000 restricted to Rs. 2,00,000"),
        ],
        "structure": (
            "an Order Giving Effect to an appellate / ITAT / revisional order. CITE THE RIGHT "
            "SECTION in the heading based on which forum's order is being given effect: for "
            "a CIT(A)/NFAC order, `ORDER UNDER SECTION 143(3) READ WITH SECTIONS 250 AND 250(2) "
            "OF THE INCOME-TAX ACT, 1961` (250 is the appellate provision, 250(2) is the "
            "procedural hook empowering the AO to give effect); for an ITAT order, `... READ "
            "WITH SECTION 254`; for a PCIT/CIT revision, `... READ WITH SECTION 263`. Decide "
            "the forum from the `Appellate / ITAT / revisional order` field. Then: office heading of the AO, `DIN: [•]`, `F. No.` with "
            "`[•]`, `Date: [•]`, assessee + PAN + AY, a `Sub:` line, a reference paragraph "
            "reproducing the appellate order reference EXACTLY as given, a direction-by-"
            "direction implementation section (deletion / restriction / recomputation as the "
            "appellate order says), a recomputation table showing Assessed Income → Effect of "
            "Appellate Order → Revised Total Income; if the prior assessed income or tax figures "
            "are NOT in the FACTS block, write `[•]` in those cells and continue (do NOT invent "
            "or write hedged filler like 'assumed for calculation purposes' or 'as per record'), "
            "the revised demand or refund with a note that a fresh notice of demand u/s 156 "
            "(or refund) will follow, consequential recomputation of interest u/s 234A/234B "
            "and penalty proceedings u/s 270A on the revised income if the appellate order so "
            "directs, and the closing block: `Yours faithfully,` then the officer's name, "
            "designation and charge on separate lines. Do NOT re-adjudicate — only give effect "
            "to the directions."
        ),
    },

    # ==== Batch 6 — Investigation / Survey ====================================
    "notice_133A": {
        "label": "Survey u/s 133A",
        "category": "Letter",
        "section": "133A",
        "wings": ["investigation"],
        "fields": _COMMON + [
            Field("premises", "Business/profession premises", placeholder="Registered office / godown at ..."),
            Field("scope", "Purpose / records to inspect", textarea=True, required=False,
                  placeholder="Verify stock, cash and books; impound documents if found relevant to undisclosed income"),
        ],
        "structure": (
            "a communication recording a survey under section 133A: heading of the office of the "
            "authority, number and date, the assessee + PAN, a statement of entry into the place of "
            "business/profession during business hours to inspect books, cash and stock and to record "
            "statements, the powers exercised (inspection, impounding of books u/s 133A(3)(ia) with "
            "reasons, verification of cash/stock), a note that it is a SURVEY not a search (no seizure of "
            "assets; statements are not on oath), and the officer's designation. Use only the facts "
            "provided."
        ),
    },
    "statement_132_4": {
        "label": "Statement on oath u/s 132(4) (proforma)",
        "category": "Statement",
        "section": "132(4)",
        "wings": ["investigation"],
        "fields": _COMMON + [
            Field("deponent", "Person examined", placeholder="Shri XYZ, Director, found in control of the premises"),
            Field("questions", "Matters to be examined", textarea=True, required=False,
                  placeholder="Ownership of the cash of Rs. 45,00,000 found; source of the jewellery; nature of the seized documents"),
        ],
        "structure": (
            "a proforma for recording a statement on oath under section 132(4) during a search: heading, "
            "number, date, time and place, the name + PAN + designation of the person examined, the "
            "authorised officer administering the oath, a preamble that the statement is recorded on oath "
            "and may be used in evidence, and a question-and-answer structure covering the matters to be "
            "examined (ownership, source and nature of the assets/documents found). Leave the answers for "
            "the deponent; do NOT fabricate admissions."
        ),
    },
    "order_132_3": {
        "label": "Prohibitory / restraint order u/s 132(3)",
        "category": "Order",
        "section": "132(3)",
        "wings": ["investigation"],
        "fields": _COMMON + [
            Field("property", "Property restrained", textarea=True,
                  placeholder="Almirah / locker no. 45 / stock lying at the godown — not practicable to seize"),
            Field("premises", "Premises", required=False, placeholder="Business premises at ..."),
        ],
        "structure": (
            "a prohibitory (restraint) order under section 132(3): heading, number and date, the person "
            "in possession + PAN, a statement that during the search it is not practicable to seize the "
            "specified books/assets, an order that the person shall not remove, part with or deal with "
            "them except with prior permission of the authorised officer, a note that the order does not "
            "amount to seizure and shall not remain in force beyond sixty days (s.132(8A)), and the "
            "authorised officer's designation. Use only the particulars provided."
        ),
    },
    "note_appraisal": {
        "label": "Appraisal / satisfaction note to the AO",
        "category": "Letter",
        "section": "132 admin.",
        "wings": ["investigation"],
        "fields": _COMMON + [
            Field("seized", "Seized material / findings", textarea=True,
                  placeholder="Seized documents A-1 to A-12; cash Rs. 45,00,000; statement u/s 132(4) admitting Rs. 1.2 cr undisclosed income"),
            Field("estimate", "Estimated undisclosed income / issues", textarea=True, required=False,
                  placeholder="Estimated undisclosed income Rs. 1,20,00,000 across AY 2020-21 to 2024-25; bogus purchases and on-money"),
        ],
        "structure": (
            "an appraisal / satisfaction note from the Investigation wing to the jurisdictional/Central "
            "Circle Assessing Officer: heading, number and date, the searched person + PAN, a summary of "
            "the seized material and the modus operandi, the key admissions and evidence, an issue-wise "
            "analysis with the estimated undisclosed income for each assessment year, and (where the "
            "material relates to another person) the satisfaction recorded for handing it over. For "
            "internal transmission to the AO — record findings, do NOT frame the assessment."
        ),
    },

    # ==== Batch 6 — I&CI / e-Verification =====================================
    "sc_271FA": {
        "label": "Penalty show-cause u/s 271FA (SFT)",
        "category": "Notice",
        "section": "271FA",
        "wings": ["ici"],
        "fields": [
            Field("entity", "Reporting entity", placeholder="XYZ Co-operative Bank Ltd."),
            Field("pan", "PAN / ITDREIN", required=False, placeholder="AAACX1234A"),
            Field("fy", "Financial year", placeholder="2024-25"),
            Field("default", "Default", textarea=True,
                  placeholder="SFT (Rule 114E) not furnished by 31 May 2025; not furnished within the 30-day period allowed u/s 285BA(5)"),
        ],
        "structure": (
            "a penalty show-cause notice under section 271FA for failure to furnish the Statement of "
            "Financial Transactions: heading of the office of the Director/Jt. Director (I&CI) / "
            "prescribed authority, number and date, the reporting entity + PAN/ITDREIN + financial year, "
            "the default, a statement that penalty of Rs. 500 per day (rising to Rs. 1,000 per day after "
            "the 285BA(5) notice period) is attracted, a call to show cause, the reply-by date, and the "
            "authority's designation."
        ),
    },
    "letter_everify": {
        "label": "e-Verification — AIS mismatch communication",
        "category": "Letter",
        "section": "135A scheme",
        "wings": ["ici"],
        "fields": _COMMON + [
            Field("mismatch", "Information mismatch", textarea=True,
                  placeholder="AIS shows interest income of Rs. 2,10,000 and securities sale of Rs. 18,00,000 not reflected in the return for AY 2024-25"),
            Field("respond_by", "Respond by (date)", placeholder="within 15 days on the compliance portal"),
        ],
        "structure": (
            "a communication under the e-Verification Scheme, 2021 (section 135A) seeking the taxpayer's "
            "explanation of a mismatch between the information available (AIS/SFT) and the return of "
            "income: heading of the office of the prescribed authority (e-Verification), reference number "
            "and date, the taxpayer + PAN + AY, the specific mismatch (source, amount and nature), a "
            "request to review the information and submit a response/feedback on the compliance portal by "
            "the stated date, a note that non-response may lead to further action including reopening, "
            "and the authority's designation. Use only the figures provided."
        ),
    },
    "letter_dissemination": {
        "label": "Information dissemination note to the AO",
        "category": "Letter",
        "section": "admin. (I&CI)",
        "wings": ["ici"],
        "fields": _COMMON + [
            Field("information", "Verified information", textarea=True,
                  placeholder="Verified high-value cash deposits of Rs. 45,00,000 (SFT) with no corresponding return; source unexplained on e-verification"),
        ],
        "structure": (
            "an information-dissemination note from the I&CI Directorate to the jurisdictional Assessing "
            "Officer: heading, reference number and date, the taxpayer + PAN + AY, a concise statement of "
            "the verified information / intelligence (the transaction, amount, source and the "
            "verification outcome), the potential escapement, and a request that the AO examine it and "
            "take appropriate action. For internal transmission — state the facts, do NOT direct the "
            "assessment."
        ),
    },

    # ==== Batch 6 — Prosecution ===============================================
    "sc_prosecution": {
        "label": "Pre-prosecution show-cause notice",
        "category": "Notice",
        "section": "276 series",
        "wings": ["officer"],
        "fields": _COMMON + [
            Field("offence", "Offence proposed", textarea=True,
                  placeholder="Wilful attempt to evade tax u/s 276C(1) — concealment of Rs. 1,20,00,000 detected in the assessment"),
            Field("reply_by", "Reply by (date)", placeholder="18.08.2026"),
        ],
        "structure": (
            "a pre-prosecution show-cause notice: heading, number and date, the person + PAN + AY, a "
            "statement of the offence proposed to be prosecuted (e.g. 276B failure to pay TDS, 276C(1)/"
            "(2) wilful evasion, 276CC failure to furnish return, 277 false statement) with the facts and "
            "amount, a call to show cause why prosecution should not be launched, the reply-by date, and "
            "the proposing authority's designation. State only the facts on record."
        ),
    },
    "sanction_279": {
        "label": "Sanction for prosecution u/s 279(1)",
        "category": "Approval",
        "section": "279(1)",
        "wings": ["officer"],
        "fields": _COMMON + [
            Field("offence", "Offence + facts", textarea=True,
                  placeholder="Offence u/s 276C(1) — wilful attempt to evade tax; concealment of Rs. 1,20,00,000 confirmed in appeal"),
            Field("proposal_ref", "Proposal / SCN reference", required=False, placeholder="Proposal of the AO dated 01.08.2026; show-cause reply considered"),
        ],
        "structure": (
            "a sanction for prosecution under section 279(1) by the specified sanctioning authority "
            "(Pr. CIT/CIT or higher): heading of the sanctioning authority's office, DIN, number and "
            "date, the person + PAN + AY, the offence and the facts constituting it, reference to the "
            "proposal and the show-cause reply considered, a reasoned satisfaction that it is a fit case "
            "for launching prosecution, the sanction accorded to institute the complaint, and the "
            "sanctioning authority's designation. Record application of mind — a bare 'sanctioned' will "
            "not do."
        ),
    },

    # ==== Batch 6 — Assessment (remaining) ====================================
    "notice_139_9": {
        "label": "Defective-return notice u/s 139(9)",
        "category": "Notice",
        "section": "139(9)",
        "wings": ["officer"],
        "fields": _COMMON + [
            Field("defect", "Defect(s)", textarea=True,
                  placeholder="Return filed without the audit report u/s 44AB / tax on returned income not paid / Part-A of the P&L not filled"),
            Field("rectify_by", "Rectify within", placeholder="15 days"),
        ],
        "structure": (
            "a notice under section 139(9) intimating a defective return: heading, DIN, number and date, "
            "assessee + PAN + AY, the specific defect(s) in the return, a direction to rectify the defect "
            "within 15 days (extendable) of service, a note that on failure the return shall be treated "
            "as invalid (as if no return had been furnished), and the officer's designation. Use only the "
            "particulars provided."
        ),
    },
    "order_142_2A": {
        "label": "Direction for special audit u/s 142(2A)",
        "category": "Order",
        "section": "142(2A)",
        "wings": ["officer"],
        "fields": _COMMON + [
            Field("reasons", "Reasons (complexity etc.)", textarea=True,
                  placeholder="Volume and complexity of the accounts, multiplicity of transactions and doubts on correctness warrant a special audit"),
            Field("auditor", "Nominated accountant", required=False, placeholder="M/s PQR & Co., Chartered Accountants, nominated by the PCIT"),
            Field("report_by", "Report by", placeholder="within 90 days"),
        ],
        "structure": (
            "a direction for special audit under section 142(2A): heading, DIN, number and date, assessee "
            "+ PAN + AY, the reasons (nature/complexity/volume of accounts, doubts about correctness, "
            "multiplicity of transactions, interests of revenue) after affording the assessee an "
            "opportunity, the prior approval of the PCCIT/CCIT/PCIT/CIT, the nominated accountant, the "
            "particulars to be reported and the time to furnish the report (90 days), and the officer's "
            "designation. Record the reasons — a special audit is not routine."
        ),
    },
    "sc_144": {
        "label": "Show-cause before best-judgment u/s 144",
        "category": "Notice",
        "section": "144",
        "wings": ["officer"],
        "fields": _COMMON + [
            Field("default", "Default", textarea=True,
                  placeholder="Non-compliance with the notices u/s 142(1)/143(2) despite repeated opportunities; no return furnished"),
            Field("reply_by", "Reply by (date)", placeholder="18.08.2026"),
        ],
        "structure": (
            "a show-cause notice under the proviso to section 144 before a best-judgment (ex-parte) "
            "assessment: heading, DIN, number and date, assessee + PAN + AY, a statement of the default "
            "(failure to file the return u/s 139/142(1), or to comply with 142(1)/143(2)/142(2A)), a "
            "call to show cause why the assessment should not be completed to the best of the AO's "
            "judgment u/s 144, the reply-by date, and the officer's designation. State only the facts on "
            "record."
        ),
    },
    "order_155": {
        "label": "Consequential-amendment order u/s 155",
        "category": "Order",
        "section": "155",
        "wings": ["officer"],
        "fields": _COMMON + [
            Field("event", "Event requiring amendment", textarea=True,
                  placeholder="Partner's share of firm income finally assessed; TDS credit later matched in 26AS; capital-gains recomputation"),
            Field("effect", "Recomputed effect", required=False, placeholder="Total income enhanced/reduced by Rs. ...; demand/refund revised"),
        ],
        "structure": (
            "an amendment order under section 155: heading, DIN, number and date, assessee + PAN + AY, "
            "reference to the completed assessment and the specified later event that requires amendment "
            "(partner's share, TDS credit, capital-gains recomputation, etc.), the amendment made and the "
            "recomputed income/tax (only as flowing from the event), the revised demand or refund, and "
            "the officer's designation. Do NOT reopen other issues — amend only for the specified event."
        ),
    },
}


# Function-group each template belongs to — the primary organising axis in the
# Drafting UI once the library grows past a handful. (Category — Notice/Order/
# etc. — becomes a secondary tag.) A template not listed falls into "Other".
_TEMPLATE_GROUP: dict[str, str] = {
    # Assessment & scrutiny
    "notice_142_1": "Assessment", "notice_143_2": "Assessment", "show_cause": "Assessment",
    "notice_156": "Assessment", "order_154": "Assessment", "notice_139_9": "Assessment",
    "order_142_2A": "Assessment", "sc_144": "Assessment", "order_155": "Assessment",
    # Reassessment & search
    "notice_148A": "Reassessment", "order_148A": "Reassessment", "notice_148": "Reassessment",
    "sanction_151": "Reassessment", "approval_153D": "Reassessment",
    # Penalty
    "sc_270A": "Penalty", "order_270A": "Penalty", "order_270AA": "Penalty",
    "sc_271AAC": "Penalty", "sc_271AAB": "Penalty", "sc_271AAD": "Penalty", "sc_271B": "Penalty",
    "sc_271D_E": "Penalty", "sc_271DA": "Penalty", "sc_272A": "Penalty", "order_273B": "Penalty",
    # Recovery & TRO
    "notice_226_3": "Recovery", "notice_221": "Recovery", "order_220_6": "Recovery",
    "order_281B": "Recovery", "notice_245": "Recovery", "order_stay_220": "Recovery",
    "order_179": "Recovery", "order_167C": "Recovery", "cert_222": "Recovery",
    "notice_226_2": "Recovery", "itcp1_demand": "Recovery", "itcp_attach": "Recovery",
    "itcp13_sale": "Recovery", "itcp25_arrest": "Recovery",
    # TDS / TCS
    "notice_201": "TDS", "order_201": "TDS", "sc_206C": "TDS", "sc_271C": "TDS",
    "order_271H": "TDS", "cert_197": "TDS", "notice_133A_2A": "TDS",
    # Exemptions (trusts & institutions)
    "notice_12AB_docs": "Exemptions", "sc_12AB_cancel": "Exemptions",
    "sc_115TD": "Exemptions", "sc_13": "Exemptions",
    # Transfer Pricing & DRP
    "show_cause_92ca": "Transfer Pricing", "order_92CA": "Transfer Pricing",
    "order_92CA_1": "Transfer Pricing", "notice_92D": "Transfer Pricing",
    "order_144C_1": "Transfer Pricing", "order_144C_5": "Transfer Pricing",
    # Appeals & Revision
    "notice_250": "Appeals & Revision", "sc_263": "Appeals & Revision",
    "notice_251": "Appeals & Revision", "letter_46A": "Appeals & Revision",
    "order_263": "Appeals & Revision", "order_264": "Appeals & Revision",
    "order_oge": "Appeals & Revision",
    # Investigation
    "summons_131": "Investigation", "summons_131_1A": "Investigation", "notice_133_6": "Investigation",
    "notice_133A": "Investigation", "statement_132_4": "Investigation",
    "order_132_3": "Investigation", "note_appraisal": "Investigation",
    # I&CI / e-Verification
    "notice_285BA5": "I&CI", "sc_271FA": "I&CI", "letter_everify": "I&CI",
    "letter_dissemination": "I&CI",
    # Prosecution
    "sc_prosecution": "Prosecution", "sanction_279": "Prosecution",
    # Assessee side
    "reply_notice": "Assessee replies",
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
                   "group": _TEMPLATE_GROUP.get(k, "Other"),
                   "fields": [f.as_dict() for f in t["fields"]]})
        for k, t in TEMPLATES.items()
    ]
    items.sort(key=lambda x: x[0])  # stable → preserves definition order within a rank
    return [d for _, d in items]


# --------------------------------------------------------------- grounding
#
# TOOL-AUGMENTED DRAFTING. Before we ask the LLM to write the notice/order we
# pre-fetch what it might not know reliably:
#
#   * The statutory text of the governing section    (Income-tax Act corpus)
#   * Two or three on-topic tribunal / HC judgments  (Case-law corpus)
#
# Both retrievals run IN PARALLEL and are cached per-section (LRU + 30-min
# TTL) so a repeat draft on the same section skips both hits entirely and
# the whole `generate()` finishes in about the time of one Vertex call —
# usually 2-3 seconds.
#
# A hard 2.5-second cap on each tool means a slow retrieval can never stall
# the draft; if the tool doesn't come back in time we just draft without it
# rather than making the user wait.

import concurrent.futures as _futures
import time as _time
from functools import lru_cache
from threading import Lock

# Small LRU + TTL cache per section. The corpus doesn't change on the scale
# of individual drafting sessions, so caching by (kind, section) for 30 min
# is safe and cuts the median draft time by ~1s.
_RETRIEVAL_CACHE: dict[tuple[str, str], tuple[float, str]] = {}
_RETRIEVAL_CACHE_LOCK = Lock()
_RETRIEVAL_TTL_S = 1800  # 30 minutes
_RETRIEVAL_MAX = 128


def _cache_get(key: tuple[str, str]) -> str | None:
    with _RETRIEVAL_CACHE_LOCK:
        entry = _RETRIEVAL_CACHE.get(key)
        if entry is None:
            return None
        ts, val = entry
        if _time.time() - ts > _RETRIEVAL_TTL_S:
            _RETRIEVAL_CACHE.pop(key, None)
            return None
        return val


def _cache_put(key: tuple[str, str], val: str) -> None:
    with _RETRIEVAL_CACHE_LOCK:
        if len(_RETRIEVAL_CACHE) >= _RETRIEVAL_MAX:
            # Evict the oldest entry; O(n) but n is small (≤128).
            oldest = min(_RETRIEVAL_CACHE.items(), key=lambda kv: kv[1][0])[0]
            _RETRIEVAL_CACHE.pop(oldest, None)
        _RETRIEVAL_CACHE[key] = (_time.time(), val)


def _governing_law(section: str) -> str:
    """Short excerpt of the governing provision so the draft cites it accurately.
    Best-effort — returns '' if retrieval is unavailable. Cached per section."""
    if not section:
        return ""
    cached = _cache_get(("law", section))
    if cached is not None:
        return cached
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
            out = f"[{p.breadcrumb}] {p.text[:900]}"
            _cache_put(("law", section), out)
            return out
    except Exception:  # noqa: BLE001
        pass
    _cache_put(("law", section), "")
    return ""


def _governing_cases(section: str, kind: str) -> str:
    """Top 2-3 tribunal / HC judgments on the governing section, so the draft
    cites accurately instead of inventing. Best-effort, cached per section."""
    if not section:
        return ""
    cached = _cache_get(("cases", section))
    if cached is not None:
        return cached
    try:
        from app.services.retrieval import retrieve
        from app.core.db import SessionLocal
        # Sec-anchored query — the retriever's section boost picks the
        # most on-point judgments over broad matches.
        q = f"Section {section} Income-tax Act — leading judgment / ratio / principle"
        db = SessionLocal()
        try:
            res = retrieve(db, q, domain=Domain.case_law)
        finally:
            db.close()
        picks = []
        for p in (res.passages or [])[:3]:
            head = getattr(p, "digest", None) or ""
            body = (p.text or "")[:500].strip()
            picks.append(f"• {p.breadcrumb}\n  {head or body}")
        out = "\n".join(picks)
        _cache_put(("cases", section), out)
        return out
    except Exception:  # noqa: BLE001
        _cache_put(("cases", section), "")
        return ""


def _parallel_research(section: str, kind: str, timeout_s: float = 2.5) -> tuple[str, str]:
    """Run both retrievals concurrently and return (law_excerpt, cases_block).
    Each call is capped at `timeout_s` — a slow tool never blocks the draft."""
    if not section:
        return "", ""
    with _futures.ThreadPoolExecutor(max_workers=2) as pool:
        f_law = pool.submit(_governing_law, section)
        f_cases = pool.submit(_governing_cases, section, kind)
        try:
            law = f_law.result(timeout=timeout_s)
        except Exception:  # noqa: BLE001
            law = ""
        try:
            cases = f_cases.result(timeout=timeout_s)
        except Exception:  # noqa: BLE001
            cases = ""
    return law, cases


_SYSTEM = (
    "You are an expert drafting assistant for officers of the Indian Income-Tax Department. "
    "You draft formal departmental documents (notices, orders, letters) in correct, dignified "
    "legal English, from the AUTHORITY's standpoint.\n\n"
    "STRICT RULES:\n"
    "1. FACTS: Use ONLY the facts, names, figures, dates and PAN provided. NEVER invent, "
    "   assume, extrapolate or estimate an amount, date, name, order reference, PAN, bank "
    "   account, address or any other fact. If a required detail is not in the FACTS block "
    "   write EXACTLY `[•]` — do NOT write phrases like 'assumed for calculation purposes', "
    "   'to be verified', 'as per record', 'if applicable', 'approximately' or any other "
    "   hedged filler. `[•]` is the ONLY permitted placeholder.\n"
    "2. LAW: Cite the governing section as given. When the AUTHORITIES block below supplies "
    "   the statutory text or a leading judgment, paraphrase the key words of the provision "
    "   in the body of the document (do not merely name the section). Cite consequential "
    "   provisions where the surface requires them (e.g. a demand u/s 156 mentions "
    "   interest u/s 220(2), penalty u/s 221 and the right of appeal u/s 246A/246; a "
    "   148A(1) notice references section 149 for the limitation window). Do NOT invent "
    "   case-law citations that are not in the AUTHORITIES block.\n"
    "3. STRUCTURE: Follow the structure specified for the template — office heading, `DIN: "
    "   [•]`, `F. No.` line with `[•]`, `Date: [•]`, addressee (name + PAN + AY), a `Sub:` "
    "   line where a subject is customary, numbered/lettered body paragraphs, consequence "
    "   or right-of-appeal clause where the template calls for one, and the officer's "
    "   designation and charge at the end.\n"
    "4. TONE: Formal legal English in the third person. No first-person 'I feel', no "
    "   colloquialisms, no markdown headings (`#`, `##`), no code fences, no emojis. "
    "   Underline / bold section headings are fine using plain UPPERCASE or `Sub:` — do "
    "   NOT wrap prose in markdown syntax.\n"
    "5. OUTPUT: Only the document text, ready to place on the office letterhead — no "
    "   preamble, no explanatory notes, no closing remarks about what you drafted."
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

    # Tool-augmented research: pull the statutory text + on-topic judgments IN
    # PARALLEL before the LLM call. Each hit is capped at 2.5s and cached per
    # section — a repeat draft on the same section skips both entirely.
    law, cases = _parallel_research(tmpl["section"], kind)

    authorities: list[str] = []
    if law:
        authorities.append(f"— STATUTE (governing provision) —\n{law}")
    if cases:
        authorities.append(f"— CASE LAW (leading judgments on this section) —\n{cases}")
    authorities_block = "\n\n".join(authorities)

    user_prompt = (
        f"Draft {tmpl['structure']}\n\n"
        f"=== FACTS ON RECORD (use ONLY these) ===\n{facts}\n\n"
        f"=== ISSUING OFFICER ===\n{_officer_block(user)}\n\n"
        + (f"=== AUTHORITIES (paraphrase / cite from these ONLY) ===\n"
           f"{authorities_block}\n\n" if authorities_block else "")
        + "=== REMINDER BEFORE YOU WRITE ===\n"
        "• Any figure, date, name, PAN, order number or bank detail NOT in "
        "the FACTS block above must appear as `[•]` in the draft. NEVER "
        "invent, assume, extrapolate, estimate, or write a hedged filler "
        "phrase like 'assumed for calculation purposes', 'to be verified', "
        "'as per record'.\n"
        "• If a COMPUTATION requires a figure you don't have (e.g. an "
        "Order-Giving-Effect needs the assessed income to recompute), do "
        "NOT invent a starting balance — write the computation table with "
        "`[•]` in the missing cells and continue. The office will fill in.\n"
        "• DO NOT perform arithmetic sums in your head to fill a TOTAL row. "
        "For any table with a `Total` / `Draft Assessed Income` / `Revised "
        "Total Income` / `Net Payable` row, write `[•]` in the total cell "
        "so the office arithmetic desk computes and enters it. This is a "
        "hard rule — LLMs slip on arithmetic; the office does not.\n"
        "• EXTRACT specifics (dates, section numbers, party names, order "
        "references, amounts) from every textarea field on the FACTS block "
        "— do not paraphrase them away or replace them with `[•]`.\n\n"
        "Now write the complete document."
    )
    # Output budget scaled to template length. Most notices are 500-800
    # tokens; orders and long approvals need a bit more. Keeping the cap
    # tight cuts Vertex latency by ~30-40% on the short templates.
    max_out = 1500 if tmpl["category"] in ("Order", "Approval", "Certificate") else 1000
    return _draft_llm().complete(_SYSTEM, user_prompt, max_tokens=max_out).strip()
