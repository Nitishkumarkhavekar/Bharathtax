"""Built-in starter templates — notice responses (assessee side) and common
applications. Pure data; users copy a library item into their own editable
templates. Placeholders: {{ASSESSEE}} {{PAN}} {{AY}} {{NOTICE_DATE}} {{AO}}
{{TODAY}} {{DEMAND}}.
"""
from __future__ import annotations

_REPLY_142_1 = """To,
The Assessing Officer,
{{AO}}

Sub: Reply to notice u/s 142(1) dated {{NOTICE_DATE}} — {{ASSESSEE}}, PAN {{PAN}}, AY {{AY}}

Respected Sir/Madam,

With reference to the above notice, the assessee respectfully submits as under:

1. The assessee has duly furnished the return of income for AY {{AY}}. The details/documents called for are furnished point-wise below.

2. Point-wise reply to the queries raised:
   (i)  [Query 1] — [reply + reference to enclosure]
   (ii) [Query 2] — [reply + reference to enclosure]

3. The requisite documents are enclosed:
   (a) [document]
   (b) [document]

4. It is prayed that the above submissions and documents may kindly be considered and the proceedings concluded accordingly. The assessee remains available for any further information required.

Yours faithfully,
{{ASSESSEE}} / Authorised Representative
Date: {{TODAY}}
Enclosures: as above
"""

_REPLY_143_2 = """To,
The Assessing Officer,
{{AO}}

Sub: Reply to scrutiny notice u/s 143(2) dated {{NOTICE_DATE}} — {{ASSESSEE}}, PAN {{PAN}}, AY {{AY}}

Respected Sir/Madam,

1. The assessee acknowledges the notice u/s 143(2) for AY {{AY}} and submits the following in support of the return of income filed.

2. Issue-wise submissions:
   (i)  [Issue identified in the notice] — [factual + legal submission, with citations]
   (ii) [Issue] — [submission]

3. Supporting evidence enclosed: [list].

4. The additions/observations proposed, if any, are not warranted for the reasons stated above. It is prayed that the assessment be completed accepting the returned income.

Yours faithfully,
{{ASSESSEE}} / Authorised Representative
Date: {{TODAY}}
"""

_REPLY_148A = """To,
The Assessing Officer,
{{AO}}

Sub: Reply to show-cause notice u/s 148A(b) dated {{NOTICE_DATE}} — {{ASSESSEE}}, PAN {{PAN}}, AY {{AY}}

Respected Sir/Madam,

1. The assessee has received the notice u/s 148A(b) proposing reopening of assessment for AY {{AY}} on the ground that income chargeable to tax has escaped assessment.

2. Objections to the proposed reopening:
   (i)  The information relied upon does not constitute "information which suggests that income has escaped assessment" within the meaning of Explanation 1 to Sec. 148.
   (ii) [Factual explanation of the transaction — genuineness, source, disclosure in the return].
   (iii) The reopening is barred by limitation / the monetary threshold u/s 149 is not met [as applicable].

3. In view of the above, it is prayed that it is not a fit case for issue of notice u/s 148 and the proceedings may be dropped.

Yours faithfully,
{{ASSESSEE}} / Authorised Representative
Date: {{TODAY}}
"""

_REPLY_PENALTY = """To,
The Assessing Officer,
{{AO}}

Sub: Reply to penalty show-cause notice — {{ASSESSEE}}, PAN {{PAN}}, AY {{AY}}

Respected Sir/Madam,

1. With reference to the penalty show-cause notice dated {{NOTICE_DATE}}, the assessee submits that penalty is not exigible for the following reasons:

2. Submissions:
   (i)  There is no under-reporting/mis-reporting of income within the meaning of Sec. 270A; the difference arises from a bona fide difference of opinion.
   (ii) The assessee had disclosed all material facts; the conditions of Sec. 270A(6) [immunity] are satisfied.
   (iii) [Where 271AAC] the income was offered/explained and the ingredients of Sec. 115BBE are not attracted.

3. It is prayed that the penalty proceedings be dropped.

Yours faithfully,
{{ASSESSEE}} / Authorised Representative
Date: {{TODAY}}
"""

_ADJOURNMENT = """To,
The Assessing Officer,
{{AO}}

Sub: Request for adjournment — {{ASSESSEE}}, PAN {{PAN}}, AY {{AY}}

Respected Sir/Madam,

With reference to the hearing/compliance fixed for {{NOTICE_DATE}}, the assessee is unable to comply on the said date owing to [reason]. It is respectfully prayed that a short adjournment of [X] days be granted to enable the assessee to compile and furnish the required details. The assessee undertakes to comply on the adjourned date.

Yours faithfully,
{{ASSESSEE}} / Authorised Representative
Date: {{TODAY}}
"""

_STAY_220_6 = """To,
The Assessing Officer / [Jurisdictional PCIT],
{{AO}}

Sub: Application for stay of demand u/s 220(6) — {{ASSESSEE}}, PAN {{PAN}}, AY {{AY}}

Respected Sir/Madam,

1. Pursuant to the assessment order for AY {{AY}}, a demand of Rs. {{DEMAND}} has been raised. An appeal against the said order has been filed before the CIT(A)/NFAC and is pending.

2. It is prayed that the assessee be treated as not being in default u/s 220(6) and recovery of the disputed demand be stayed pending disposal of the appeal, for the following reasons:
   (i)  The additions are prima facie unsustainable [brief grounds].
   (ii) Balance of convenience and financial hardship favour the assessee.
   (iii) The issue is covered in the assessee's favour by [citation], as applicable.

3. The assessee is willing to comply with any reasonable conditions the office may impose.

Yours faithfully,
{{ASSESSEE}} / Authorised Representative
Date: {{TODAY}}
"""

# ----------------------------------------------------------------- officer side
_ASSESSMENT_143_3 = """OFFICE OF THE {{AO}}

PAN: {{PAN}}                       Assessment Year: {{AY}}
Name & address of the assessee: {{ASSESSEE}}

ASSESSMENT ORDER u/s 143(3) of the Income-tax Act, 1961

1. The assessee filed the return of income for AY {{AY}} on [date] declaring total income of Rs. [____]. The case was selected for scrutiny under CASS for the reason(s): [reason for selection]. Notice u/s 143(2) was issued on {{NOTICE_DATE}} and notice(s) u/s 142(1) with questionnaire were issued and served. In response, [AR] attended and filed the details, which have been examined and placed on record.

2. Issue-wise discussion:

   Issue 1 — [description of the issue]
   (a) Facts: [___]
   (b) Show-cause: The assessee was required to explain [___] vide notice dated [date].
   (c) Assessee's submission: [___]
   (d) Discussion & finding: [reasoning; distinguish assessee's case law; cite the provision]. In view of the above, an addition of Rs. [____] is made u/s [section].

   Issue 2 — [___]  (repeat the (a)-(d) structure)

3. Computation of total income:
      Returned income                              Rs. __________
      Add: [addition 1] u/s [section]              Rs. __________
      Add: [addition 2] u/s [section]              Rs. __________
      Assessed total income                        Rs. __________

4. Tax computed as per ITNS-150 enclosed. Charge interest u/s 234A / 234B / 234C as applicable; credit prepaid taxes. Where any addition is sustained u/s 68/69/69A-D, tax is charged u/s 115BBE.

5. Penalty proceedings u/s 270A (under-/mis-reporting) / 271AAC are initiated separately. Issue demand notice u/s 156 and challan.

                                                    ({{AO}})
Date: {{TODAY}}
"""

_PENALTY_ORDER_270A = """OFFICE OF THE {{AO}}

PAN: {{PAN}}                       Assessment Year: {{AY}}
{{ASSESSEE}}

PENALTY ORDER u/s 270A of the Income-tax Act, 1961

1. Assessment u/s 143(3)/147 for AY {{AY}} was completed on [date] determining additions of Rs. [____]. Penalty proceedings u/s 270A were initiated for under-reporting / mis-reporting of income.

2. A show-cause notice was issued on {{NOTICE_DATE}}. The assessee's reply dated [date] has been considered and is found [not acceptable — reasons].

3. Finding: The case is one of [under-reporting u/s 270A(2) / mis-reporting u/s 270A(9)]. The tax payable on the under-reported income works out to Rs. [____]. Penalty @ [50% / 200%] of such tax is leviable.

4. Penalty of Rs. [____] is levied u/s 270A. Issue notice of demand u/s 156 and challan.

                                                    ({{AO}})
Date: {{TODAY}}
"""

_NOTICE_142_1 = """OFFICE OF THE {{AO}}

To,
{{ASSESSEE}}
PAN: {{PAN}}                       AY: {{AY}}

Notice u/s 142(1) of the Income-tax Act, 1961

In connection with the assessment for AY {{AY}}, you are required to furnish, on or before [date], the following accounts/documents/information (questionnaire annexed):
   1. [___]
   2. [___]

You may comply electronically through the e-proceeding facility. Non-compliance may lead to best-judgment assessment u/s 144 and penalty u/s 272A(1)(d).

                                                    ({{AO}})
Date: {{TODAY}}
"""

_SCN_148A = """OFFICE OF THE {{AO}}

To,
{{ASSESSEE}}
PAN: {{PAN}}                       AY: {{AY}}

Show-cause notice u/s 148A(b) of the Income-tax Act, 1961

1. Information has been received / flagged suggesting that income chargeable to tax has escaped assessment for AY {{AY}}, namely: [describe the information and the amount].

2. You are requested to show cause, on or before [date], as to why a notice u/s 148 should not be issued. You may furnish your explanation with supporting evidence.

Enclosure: material relied upon (subject to Sec. 148A).

                                                    ({{AO}})
Date: {{TODAY}}
"""

_NOTICE_156 = """OFFICE OF THE {{AO}}

To,
{{ASSESSEE}}
PAN: {{PAN}}                       AY: {{AY}}

Notice of demand u/s 156 of the Income-tax Act, 1961

This is to give you notice that a sum of Rs. {{DEMAND}} has been determined to be payable by you in respect of AY {{AY}} as per the order dated [date]. The amount is payable within 30 days of service of this notice to the credit of the Central Government.

If you do not pay within the time allowed, you shall be liable to interest u/s 220(2) and recovery proceedings u/s 222-226, in addition to any penalty u/s 221.

                                                    ({{AO}})
Date: {{TODAY}}
"""

_NOTICE_221 = """OFFICE OF THE {{AO}}

To,
{{ASSESSEE}}
PAN: {{PAN}}                       AY: {{AY}}

Show-cause notice u/s 221(1) of the Income-tax Act, 1961 — penalty for default in payment of tax

1. A demand of Rs. {{DEMAND}} was raised against you for AY {{AY}} vide notice of demand u/s 156 dated [date]. The amount was payable within 30 days of service. The demand remains unpaid / partly unpaid and you are in default u/s 220(4).

2. You are hereby required to show cause, on or before [date], as to why a penalty u/s 221(1) (not exceeding the amount of tax in arrears) should not be levied for the default. Interest u/s 220(2) continues to accrue at 1% per month on the outstanding amount.

3. If no cause is shown, penalty will be levied and recovery proceedings u/s 222-226 initiated without further notice.

                                                    ({{AO}})
Date: {{TODAY}}
"""

_NOTICE_226_3 = """OFFICE OF THE {{AO}} / TAX RECOVERY OFFICER

To,
[Name of the garnishee — bank / debtor / employer]
[Address]

Notice u/s 226(3) of the Income-tax Act, 1961 — recovery from a person holding money for the assessee

1. A sum of Rs. {{DEMAND}} is due from {{ASSESSEE}} (PAN {{PAN}}) for AY {{AY}} and is in arrears.

2. You are hereby required to pay to the credit of the Central Government forthwith, and in any case within [time], any amount due from you to, or held by you for or on account of, the said assessee, up to the amount of the arrears stated above. This includes amounts that may subsequently become due or be held.

3. Any payment made by you in compliance discharges you to that extent. If you fail to comply, you shall be deemed to be an assessee in default u/s 226(3)(x) and the amount shall be recoverable from you. A copy is sent to the assessee.

                                                    ({{AO}} / TRO)
Date: {{TODAY}}
"""

_TRO_222 = """OFFICE OF THE {{AO}}

To,
The Tax Recovery Officer,
[Jurisdiction]

Sub: Drawing up of statement / certificate u/s 222 r.w. Sch. II — arrears of {{ASSESSEE}}, PAN {{PAN}}, AY {{AY}}

1. The following demand is in arrears against the above defaulter and recovery is requested by attachment and sale u/s 222 read with the Second Schedule:
      AY {{AY}}                Rs. {{DEMAND}}   (plus interest u/s 220(2))

2. The assessee has been served notice of demand u/s 156 and is in default u/s 220(4). No stay is in operation [confirm]. The defaulter's known assets / bank accounts are: [particulars].

3. A certificate u/s 222 may kindly be drawn up and recovery proceedings under the Second Schedule initiated.

                                                    ({{AO}})
Date: {{TODAY}}
"""

_INSTALMENT_ORDER = """OFFICE OF THE {{AO}}

To,
{{ASSESSEE}}
PAN: {{PAN}}                       AY: {{AY}}

Order u/s 220(3) — grant of instalments for payment of demand

1. With reference to your application dated [date] seeking time to pay the outstanding demand of Rs. {{DEMAND}} for AY {{AY}}, and having considered the circumstances, the demand is permitted to be paid in [N] monthly instalments as under:

      Instalment 1 — Rs. [____] by [date]
      Instalment 2 — Rs. [____] by [date]
      … (as scheduled)

2. Interest u/s 220(2) at 1% per month on the amount outstanding will continue to accrue and is payable in addition. Default in any instalment will render the whole of the then-outstanding demand immediately due and recovery u/s 222-226 will follow. You will not be treated as in default so long as the instalments are paid on the due dates.

                                                    ({{AO}})
Date: {{TODAY}}
"""

_FORM10_ACCUM = """To,
The Assessing Officer / [Jurisdictional AO — Exemptions],
{{AO}}

Sub: Intimation of accumulation of income u/s 11(2) r.w. Rule 17 (Form No. 10) — {{ASSESSEE}}, PAN {{PAN}}, AY {{AY}}

Respected Sir/Madam,

1. {{ASSESSEE}}, a trust/institution registered u/s 12AB, hereby gives notice u/s 11(2) of its intention to accumulate or set apart the following income for application to its charitable/religious objects:

      Amount to be accumulated/set apart:  Rs. [____]
      Period of accumulation (not exceeding 5 years): FY [__] to FY [__]
      Specific purpose(s) of accumulation: [state the objects]

2. The amount so accumulated has been / will be invested in the modes specified u/s 11(5). Form No. 10 is filed electronically within the due date u/s 139(1). The audit report in Form 10B is enclosed/filed.

3. It is submitted that on the above accumulation being validly set apart, no part of the said income is chargeable to tax for AY {{AY}}.

Yours faithfully,
For {{ASSESSEE}}
(Managing Trustee / Authorised Signatory)
Date: {{TODAY}}
"""

_FORM10AB_80G = """To,
The Principal Commissioner / Commissioner of Income-tax (Exemptions),
[Jurisdiction]

Sub: Application for renewal/approval u/s 80G(5) (Form No. 10AB) — {{ASSESSEE}}, PAN {{PAN}}

Respected Sir/Madam,

1. {{ASSESSEE}} holds provisional/regular approval u/s 80G(5) [registration no. ____ dated ____] and applies for renewal/regular approval in Form No. 10AB within the time allowed.

2. Enclosures: (a) self-certified copy of the instrument of creation; (b) 12AB registration; (c) audited accounts for the last [3] years; (d) note on activities; (e) details of donations and application to objects.

3. It is submitted that the trust has carried out genuine charitable activities in accordance with its objects and has complied with the conditions of Sec. 80G(5). Renewal of approval is prayed for.

Yours faithfully,
For {{ASSESSEE}}
(Authorised Signatory)
Date: {{TODAY}}
"""

_SCN_12AB4 = """OFFICE OF THE PRINCIPAL COMMISSIONER / COMMISSIONER OF INCOME-TAX (EXEMPTIONS)

To,
{{ASSESSEE}}
PAN: {{PAN}}

Show-cause notice u/s 12AB(4)/(5) of the Income-tax Act, 1961 — proposed cancellation of registration

1. Registration u/s 12AB was granted to the trust/institution vide order dated [date]. Information/material on record indicates the occurrence of a "specified violation", namely: [e.g. application of income for non-charitable purposes / activities not genuine / income applied for the benefit of a person referred to in Sec. 13(3) / Sec. 13 violation / non-compliance with other law material to the objects].

2. You are hereby required to show cause, on or before [date], as to why the registration u/s 12AB should not be cancelled for the previous year(s) [__] in view of the above. You may furnish a written reply with supporting evidence and avail an opportunity of being heard.

3. In the absence of a satisfactory explanation, registration will be cancelled and the consequences u/s 115TD (tax on accreted income) considered.

                                                    (PCIT/CIT (Exemptions))
Date: {{TODAY}}
"""

_SCN_263 = """OFFICE OF THE PRINCIPAL COMMISSIONER / COMMISSIONER OF INCOME-TAX

To,
{{ASSESSEE}}
PAN: {{PAN}}                       AY: {{AY}}

Show-cause notice u/s 263 of the Income-tax Act, 1961 — proposed revision of an erroneous order prejudicial to the interests of revenue

1. The assessment order u/s [143(3)/147] for AY {{AY}} was passed by the Assessing Officer on [date] determining total income of Rs. [____].

2. On examination of the record, the said order appears to be ERRONEOUS in so far as it is PREJUDICIAL to the interests of revenue, for the following reason(s):
   (i)  [The AO allowed [claim] without any enquiry / verification of [___]] — no enquiry was made though the facts called for it (Explanation 2 to Sec. 263).
   (ii) [The AO failed to add / disallow [amount] u/s [section] though the material on record required it].
   (iii)[The order was passed without applying mind to [issue] / contrary to [provision / binding decision]].

3. You are hereby required to show cause, on or before [date], as to why the assessment should not be revised u/s 263 by setting aside / modifying the order and directing the AO to make the addition / disallowance / enquiry indicated above. You may appear in person or through an authorised representative and file a written reply with supporting evidence.

4. The revision, if made, will be within the limitation u/s 263(2) [2 years from the end of the FY in which the order sought to be revised was passed].

                                                    (PCIT / CIT)
Date: {{TODAY}}
"""

_ORDER_263 = """OFFICE OF THE PRINCIPAL COMMISSIONER / COMMISSIONER OF INCOME-TAX

PAN: {{PAN}}                       AY: {{AY}}
{{ASSESSEE}}

ORDER u/s 263 of the Income-tax Act, 1961

1. The assessment for AY {{AY}} was completed u/s [143(3)/147] on [date]. A notice u/s 263 dated [date] was issued proposing revision on the ground that the order is erroneous and prejudicial to the interests of revenue in respect of [issue(s)].

2. The assessee's reply dated [date] has been considered. [Summary of the submissions and why they are / are not accepted.]

3. Findings: For the reasons discussed, the assessment order is held to be erroneous in so far as it is prejudicial to the interests of revenue, as [the AO made no enquiry into [___] / failed to [___] — Explanation 2 to Sec. 263 is attracted].

4. In exercise of the powers u/s 263, the assessment order dated [date] is SET ASIDE / MODIFIED to the extent indicated, and the Assessing Officer is directed to [make the addition/disallowance of Rs. [____] u/s [section] / make a fresh assessment on the issue of [___] after affording the assessee an opportunity of being heard], and pass a fresh order in accordance with law.

                                                    (PCIT / CIT)
Date: {{TODAY}}
"""

_ORDER_264 = """OFFICE OF THE PRINCIPAL COMMISSIONER / COMMISSIONER OF INCOME-TAX

PAN: {{PAN}}                       AY: {{AY}}
{{ASSESSEE}}

ORDER u/s 264 of the Income-tax Act, 1961 (on the assessee's application)

1. The assessee filed an application u/s 264 dated [date] seeking revision of the order u/s [section] for AY {{AY}} passed on [date], on the ground(s) that [grievance]. The application is within time / delay is condoned for the reasons stated.

2. The record has been examined and the assessee heard. [Discussion of the grievance and the material.]

3. Findings: [The grievance is found to be justified / not justified because [___].]

4. In exercise of the powers u/s 264, the order dated [date] is revised / modified as under: [relief granted — e.g. the addition of Rs. [____] is deleted / the credit for Rs. [____] is allowed], and the AO is directed to give effect to this order. [Or: the application is rejected for the reasons above.] It is clarified that an order u/s 264 is not prejudicial to the assessee.

                                                    (PCIT / CIT)
Date: {{TODAY}}
"""

LIBRARY = [
    # --- assessee side ---
    {"id": "reply_142_1", "name": "Reply to notice u/s 142(1)", "category": "notice", "side": "assessee", "body": _REPLY_142_1},
    {"id": "reply_143_2", "name": "Reply to scrutiny notice u/s 143(2)", "category": "notice", "side": "assessee", "body": _REPLY_143_2},
    {"id": "reply_148a", "name": "Reply to SCN u/s 148A(b) (reopening)", "category": "notice", "side": "assessee", "body": _REPLY_148A},
    {"id": "reply_penalty", "name": "Reply to penalty SCN (270A / 271AAC)", "category": "notice", "side": "assessee", "body": _REPLY_PENALTY},
    {"id": "adjournment", "name": "Adjournment request", "category": "other", "side": "assessee", "body": _ADJOURNMENT},
    {"id": "stay_220_6", "name": "Stay application u/s 220(6)", "category": "other", "side": "assessee", "body": _STAY_220_6},
    # --- officer side ---
    {"id": "assessment_143_3", "name": "Assessment order u/s 143(3)", "category": "order", "side": "officer", "body": _ASSESSMENT_143_3},
    {"id": "penalty_order_270a", "name": "Penalty order u/s 270A", "category": "order", "side": "officer", "body": _PENALTY_ORDER_270A},
    {"id": "notice_142_1", "name": "Notice u/s 142(1) (enquiry)", "category": "notice", "side": "officer", "body": _NOTICE_142_1},
    {"id": "scn_148a", "name": "Show-cause u/s 148A(b) (reopening)", "category": "notice", "side": "officer", "body": _SCN_148A},
    {"id": "notice_156", "name": "Notice of demand u/s 156", "category": "notice", "side": "officer", "body": _NOTICE_156},
    # --- officer side: recovery / TRO ---
    {"id": "notice_221", "name": "SCN u/s 221(1) (penalty for default)", "category": "notice", "side": "officer", "body": _NOTICE_221},
    {"id": "notice_226_3", "name": "Garnishee notice u/s 226(3)", "category": "notice", "side": "officer", "body": _NOTICE_226_3},
    {"id": "tro_222", "name": "Reference to TRO u/s 222 (recovery certificate)", "category": "order", "side": "officer", "body": _TRO_222},
    {"id": "instalment_order", "name": "Instalment order u/s 220(3)", "category": "order", "side": "officer", "body": _INSTALMENT_ORDER},
    # --- trust / charity (exemptions) ---
    {"id": "form10_accum", "name": "Form 10 — accumulation u/s 11(2)", "category": "other", "side": "assessee", "body": _FORM10_ACCUM},
    {"id": "form10ab_80g", "name": "Form 10AB — 80G renewal application", "category": "other", "side": "assessee", "body": _FORM10AB_80G},
    {"id": "scn_12ab4", "name": "SCN u/s 12AB(4) (cancel registration)", "category": "notice", "side": "officer", "body": _SCN_12AB4},
    # --- revision (263 / 264) ---
    {"id": "scn_263", "name": "SCN u/s 263 (erroneous & prejudicial)", "category": "notice", "side": "officer", "body": _SCN_263},
    {"id": "order_263", "name": "Revision order u/s 263", "category": "order", "side": "officer", "body": _ORDER_263},
    {"id": "order_264", "name": "Revision order u/s 264 (assessee application)", "category": "order", "side": "officer", "body": _ORDER_264},
]


def library() -> list[dict]:
    return [dict(t) for t in LIBRARY]
