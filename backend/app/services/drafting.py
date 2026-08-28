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
            "a Notice of Demand under section 156 of the Income-tax Act, 1961: office heading, notice "
            "number and date, assessee + PAN + AY, reference to the order under which the sum has become "
            "payable, the amount payable broken into tax / interest / penalty / fee as given, a direction "
            "to pay within 30 days of service (or the stated date) at the specified mode, the consequences "
            "of non-payment (interest u/s 220(2), penalty u/s 221 and recovery proceedings), the right of "
            "appeal, and the officer's designation and charge. Use ONLY the figures provided."
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
            "a show-cause notice under section 148A(1) (as substituted by the Finance (No. 2) Act, 2024) "
            "before issue of a notice u/s 148: heading, DIN, number and date, assessee + PAN + AY, a "
            "statement that information as per section 148/149 suggests income chargeable to tax has "
            "escaped assessment, the SUBSTANCE of that information and the amount, a call to show cause "
            "within the period specified why a notice u/s 148 should not be issued, a note that the reply "
            "and material will be considered before any order u/s 148A(3), and the officer's designation "
            "and charge. Use only the information provided; do NOT invent figures."
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
}


# Function-group each template belongs to — the primary organising axis in the
# Drafting UI once the library grows past a handful. (Category — Notice/Order/
# etc. — becomes a secondary tag.) A template not listed falls into "Other".
_TEMPLATE_GROUP: dict[str, str] = {
    # Assessment & scrutiny
    "notice_142_1": "Assessment", "notice_143_2": "Assessment", "show_cause": "Assessment",
    "notice_156": "Assessment", "order_154": "Assessment",
    # Reassessment & search
    "notice_148A": "Reassessment", "order_148A": "Reassessment", "notice_148": "Reassessment",
    "sanction_151": "Reassessment", "approval_153D": "Reassessment",
    # Penalty
    "sc_270A": "Penalty", "order_270A": "Penalty", "order_270AA": "Penalty",
    "sc_271AAC": "Penalty", "sc_271AAB": "Penalty", "sc_271AAD": "Penalty", "sc_271B": "Penalty",
    "sc_271D_E": "Penalty", "sc_271DA": "Penalty", "sc_272A": "Penalty", "order_273B": "Penalty",
    # Recovery & TRO
    "notice_226_3": "Recovery", "notice_221": "Recovery", "order_220_6": "Recovery",
    "order_281B": "Recovery", "notice_245": "Recovery",
    # TDS
    "notice_201": "TDS", "order_201": "TDS",
    # Transfer Pricing & DRP
    "show_cause_92ca": "Transfer Pricing", "order_92CA": "Transfer Pricing",
    # Appeals & Revision
    "notice_250": "Appeals & Revision", "sc_263": "Appeals & Revision",
    # Investigation
    "summons_131": "Investigation", "summons_131_1A": "Investigation", "notice_133_6": "Investigation",
    # I&CI / e-Verification
    "notice_285BA5": "I&CI",
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
