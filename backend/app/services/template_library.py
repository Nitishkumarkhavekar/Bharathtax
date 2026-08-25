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
]


def library() -> list[dict]:
    return [dict(t) for t in LIBRARY]
