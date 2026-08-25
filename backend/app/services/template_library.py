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

_SANCTION_151 = """OFFICE OF THE [PRINCIPAL COMMISSIONER / PRINCIPAL CHIEF COMMISSIONER]

Sanction u/s 151 of the Income-tax Act, 1961 — approval for issue of notice u/s 148

Assessee: {{ASSESSEE}}                 PAN: {{PAN}}                 AY: {{AY}}

1. The Assessing Officer, {{AO}}, has, after following the procedure u/s 148A, recorded that income chargeable to tax has escaped assessment for AY {{AY}} to the extent of Rs. [____], on the basis of the following information: [describe the information / material].

2. The order u/s 148A(d) dated [date] and the material on record have been perused. The case is within the time-limit u/s 149 [3 years / beyond 3 years but within 10 years as escaped income represented in the form of an asset is Rs. 50 lakh or more].

3. I am satisfied, on the reasons recorded and the material, that this is a fit case for issue of notice u/s 148. Approval u/s 151 is hereby accorded for issue of notice u/s 148 for AY {{AY}}.

                                                    ([Specified Authority u/s 151])
Date: {{TODAY}}
"""

_APPROVAL_153D = """OFFICE OF THE [ADDITIONAL / JOINT COMMISSIONER OF INCOME-TAX], RANGE [__]

Approval u/s 153D of the Income-tax Act, 1961 — search / requisition assessments

Assessee: {{ASSESSEE}}                 PAN: {{PAN}}                 AY(s): {{AY}}

1. The Assessing Officer has forwarded the draft assessment order(s) u/s 153A / 153C / 143(3) r.w.s. 153A for the above assessee for the assessment year(s) noted, arising out of the search / requisition conducted on [date].

2. The draft order(s), the appraisal report, the seized material and the assessment records have been examined. The additions proposed [and the AO's reasoning] are found to be [supported by the seized material / require the following modification: [___]].

3. Approval is hereby accorded u/s 153D to the draft assessment order(s) for AY {{AY}} [subject to the modifications indicated]. The AO may finalise the assessment(s) accordingly within the limitation.

                                                    ([Addl./Joint CIT])
Date: {{TODAY}}
"""

_PROSECUTION_SCN = """OFFICE OF THE {{AO}}

To,
{{ASSESSEE}}
PAN: {{PAN}}                       AY: {{AY}}

Show-cause notice — proposed prosecution under Chapter XXII of the Income-tax Act, 1961

1. Proceedings for AY {{AY}} disclose the following: [e.g. wilful attempt to evade tax u/s 276C / failure to furnish return u/s 276CC / false statement in verification u/s 277 / failure to pay TDS u/s 276B], particulars being [state the facts, amount and the provision].

2. The above prima facie constitutes an offence punishable under the said section(s). You are hereby required to show cause, on or before [date], as to why prosecution should not be launched against you (and the persons responsible u/s 278B/278C). You may also state whether you wish to apply for compounding of the offence u/s 279(2).

3. Your written explanation with supporting evidence may be furnished by the date fixed; failing which the matter will be referred for sanction of prosecution.

                                                    ({{AO}})
Date: {{TODAY}}
"""

_SANCTION_279 = """OFFICE OF THE [PRINCIPAL COMMISSIONER / COMMISSIONER OF INCOME-TAX]

Sanction u/s 279(1) of the Income-tax Act, 1961 — for launching prosecution

Assessee: {{ASSESSEE}}                 PAN: {{PAN}}                 AY: {{AY}}

1. The Assessing Officer has proposed prosecution of the above assessee for the offence(s) u/s [276C / 276CC / 277 / 276B] for AY {{AY}}, on the facts: [brief facts, amount of tax sought to be evaded / default].

2. The show-cause notice dated [date] was issued; the reply, if any, has been considered [and is found unsatisfactory for the reasons: [___]]. The ingredients of the offence are prima facie made out on the material on record.

3. Sanction is hereby accorded u/s 279(1) for launching prosecution against the assessee [and the principal officer / persons responsible u/s 278B] before the competent court for the offence(s) noted above.

                                                    (PCIT / CIT)
Date: {{TODAY}}
"""

_COMPOUNDING_APPLICATION = """To,
The [Principal Commissioner / Chief Commissioner] of Income-tax,
[Jurisdiction]

Sub: Application for compounding of offence u/s 279(2) — {{ASSESSEE}}, PAN {{PAN}}, AY {{AY}}

Respected Sir/Madam,

1. The applicant is [being prosecuted / show-caused] for the offence u/s [276C(1)/276CC/276B/277] for AY {{AY}}. The applicant applies for compounding of the said offence u/s 279(2) in accordance with the Guidelines for Compounding of Offences in force.

2. The applicant submits: (a) the tax, interest and penalty in respect of the default have been paid [particulars and challans enclosed]; (b) the offence is compoundable and not excluded under the Guidelines; (c) this is [the first / a permitted] occasion for compounding; (d) the applicant undertakes to pay the compounding charges as computed.

3. It is prayed that the offence be compounded on payment of the applicable compounding charges, and that prosecution [proposed / pending] be dropped / withdrawn accordingly.

Yours faithfully,
{{ASSESSEE}} / Authorised Representative
Date: {{TODAY}}
Enclosures: proof of payment of tax, interest, penalty; computation.
"""

_COMPOUNDING_ORDER = """OFFICE OF THE [PRINCIPAL COMMISSIONER / CHIEF COMMISSIONER OF INCOME-TAX]

Compounding order u/s 279(2) of the Income-tax Act, 1961

Assessee: {{ASSESSEE}}                 PAN: {{PAN}}                 AY: {{AY}}

1. The assessee applied on [date] for compounding of the offence u/s [section] for AY {{AY}}. The application has been examined with reference to the Compounding Guidelines.

2. The pre-conditions are satisfied: the tax, interest and penalty stand paid; the offence is compoundable; and the case is not in the excluded category. The compounding charges are computed as under: [compounding fee + establishment expenses + litigation expenses] = Rs. [____].

3. The offence u/s [section] is hereby COMPOUNDED u/s 279(2), subject to payment of the compounding charges of Rs. [____] within [time]. On payment, the prosecution proposed / pending shall be withdrawn / not be launched. Default in payment will render this order void.

                                                    (PCIT / CCIT)
Date: {{TODAY}}
"""

_STMT_132_4 = """STATEMENT u/s 132(4) of the Income-tax Act, 1961

Statement of Shri/Smt. {{ASSESSEE}} (PAN {{PAN}}) recorded on oath during the course of search & seizure action u/s 132 at [premises] on [date] before [designation of the authorised officer].

Preliminary:
Q1. Please identify yourself — name, father's name, address, PAN, and your relationship to the premises/entity searched.
Q2. What is your role in [entity]? Since when? Please describe your business/profession and sources of income.
Q3. Do you maintain books of account? Where? Who maintains them? Please identify the accountant / person in charge.

On the material found:
Q4. During the search, [cash of Rs. ____ / jewellery of ____ gms / documents marked Annexure __] were found at [location]. Please explain the source and ownership of each.
Q5. [Refer to a specific seized document/entry] — please explain the entries at page/para [__]: the nature of the transaction, the parties, the amounts, and whether they are recorded in the regular books.
Q6. [Digital data / whatsapp / excel] found on [device] shows [___]. Please explain.
Q7. Do these transactions find place in your returned income? If not, please explain why.

Disclosure:
Q8. In view of the above, do you wish to make any disclosure of undisclosed income? If so, for which year(s), of what amount, and on what account? Please specify how it will be substantiated and taxes paid.
Q9. Is this statement being given voluntarily, without any threat, coercion or inducement? Have you been allowed to consult the material?

Deponent: ____________________            Recorded before: ____________________
Date: {{TODAY}}
(The statement was read over to the deponent, who admitted it to be correct.)
"""

_SUMMONS_131_Q = """OFFICE OF THE {{AO}} / [INVESTIGATION WING]

Questionnaire annexed to summons u/s 131 of the Income-tax Act, 1961

To: {{ASSESSEE}}, PAN {{PAN}}  —  Attendance on [date] at [time] at [place]

You are required to attend and give evidence / produce the following, and to answer the following on oath:
   1. Your identity, address, PAN, occupation and connection with [entity/person].
   2. Details and documentary evidence of the transaction(s) with [party] during FY [____]: nature, amount, mode, dates, and the books in which recorded.
   3. Bank statements of all accounts for the period [____] with explanation of credits aggregating Rs. [____].
   4. Confirmation, PAN and creditworthiness of the parties from whom [loans/share capital/advances] of Rs. [____] were received.
   5. [Issue-specific queries].

Documents to produce: [list]. Non-compliance attracts consequences u/s 131 and penalty u/s 272A.

                                                    ({{AO}})
Date: {{TODAY}}
"""

_APPRAISAL_REPORT = """APPRAISAL REPORT — Search & Seizure u/s 132 / Requisition u/s 132A

Group: [name]                        Lead PAN: {{PAN}}                 Search date: [date]

1. Introduction & warrant
   - Persons/premises covered; date(s) of search; officers; period of authorisation.

2. Group profile
   - Entities, key persons, nature of business, control/network chart.

3. Seizure & inventory summary
   - Cash seized Rs. [____]; jewellery [gms/Rs. ____]; documents Annexures [__]; digital devices [__]; stock/valuables.

4. Statements recorded (u/s 132(4)/131)
   - Deponent, date, key admissions, disclosures, retractions (if any) and corroboration.

5. Issue-wise findings (per entity / per year)
   For each issue: the seized material relied on -> the transaction -> the undisclosed income worked out -> the section (68/69/69A-D, 115BBE) -> corroboration.
   - Issue 1: [___]  — quantum Rs. [____]  — evidence: Annexure [__]
   - Issue 2: [___]

6. Undisclosed income computation (AY-wise)
   - Peak credit / telescoping applied where credits rotate; year-wise table of additions.

7. Recommendations
   - Assessment u/s 153A/153C for AY(s) [__]; protective/substantive; 153D approval; penalty/prosecution; references to other wings/parties.

Prepared by: ____________________
Date: {{TODAY}}
"""

_UNACCOUNTED_NOTE = """WORKING NOTE — Computation of undisclosed / unaccounted income

Assessee: {{ASSESSEE}}       PAN: {{PAN}}       AY: {{AY}}

1. Basis: [seized document Annexure __ / bank credits / statement u/s 132(4) para __].

2. Credits considered (chronological) — see peak-credit working:
      Total credits examined            Rs. [____]
      Less: explained / recorded         Rs. [____]
      Unexplained credits                Rs. [____]
      Peak credit (rotating fund)        Rs. [____]   <- quantum of addition
   [Where each deposit is independently unexplained and rotation is not established, the gross may be added instead — state the basis.]

3. Telescoping: earlier addition of Rs. [____] is set off against the later application/investment of Rs. [____] to avoid double addition, to the extent [____].

4. Head & section: addition of Rs. [____] u/s [68/69/69A-D]; tax u/s 115BBE; penalty u/s 271AAC / 270A initiated.

Prepared by: ____________________
Date: {{TODAY}}
"""

_TPO_ORDER = """OFFICE OF THE TRANSFER PRICING OFFICER, [__]

Assessee: {{ASSESSEE}}                 PAN: {{PAN}}                 AY: {{AY}}

ORDER u/s 92CA(3) of the Income-tax Act, 1961 — determination of arm's length price

1. Reference: The case was referred u/s 92CA(1) by the AO for determination of the ALP of the international transactions / specified domestic transactions reported in Form 3CEB. Notice u/s 92CA(2) / 92D(3) was issued and the assessee's TP study and submissions considered.

2. International transactions examined:
      (i)  [nature of transaction] with [AE], value Rs. [____]
      (ii) [nature] with [AE], value Rs. [____]

3. Method & PLI: The assessee adopted [TNMM/CUP/…] with [OP/OC] as the PLI. [Accepted / rejected because [___]]. The most appropriate method is held to be [____].

4. Comparables & benchmarking: On applying the filters [turnover / functional / RPT / persistent-loss], the accepted set yields a margin range/median of [____]% (Rule 10CA — 35th–65th percentile). The tested party's margin is [____]%.

5. Determination: As the tested margin falls OUTSIDE the arm's length range, the ALP is taken at the median [____]%. The adjustment to the total income on account of the international transaction(s) is worked out as under:
      Operating cost / sales base            Rs. [____]
      ALP margin                             [____]%
      Arm's length operating profit          Rs. [____]
      Less: operating profit shown           Rs. [____]
      Transfer pricing ADJUSTMENT u/s 92CA   Rs. [____]

6. The adjustment of Rs. [____] is proposed to the income of the assessee for AY {{AY}}. A copy of this order is sent to the AO for passing the draft order u/s 143(3) r.w.s. 144C.

                                                    (Transfer Pricing Officer)
Date: {{TODAY}}
"""

_CHECKLIST_3CEB = """FORM 3CEB — REVIEW CHECKLIST (transfer pricing)

Assessee: {{ASSESSEE}}       PAN: {{PAN}}       AY: {{AY}}

A. Completeness
   [ ] Form 3CEB filed by the due date; accountant's report (CA) signed.
   [ ] All Associated Enterprises (Sec. 92A) identified; relationship disclosed.
   [ ] Every international transaction (Sec. 92B) & SDT (Sec. 92BA) reported clause-wise.

B. Transactions & value
   [ ] Nature, quantum and terms of each transaction match the books / agreements.
   [ ] Loans/guarantees, royalty, management fees, cost allocations captured.
   [ ] Any transaction NOT reported in 3CEB but seen in the accounts? [flag]

C. Method & benchmarking
   [ ] Most appropriate method stated with reasons; PLI appropriate.
   [ ] Comparables: filters (turnover, functional, RPT%, persistent loss) reasonable.
   [ ] Current-year vs multiple-year data; Rule 10CA range/median applied correctly.
   [ ] Tested party correctly chosen; segmental accounts where needed.

D. Adjustments & risk
   [ ] Working capital / risk adjustments claimed — justified?
   [ ] Margin within the arm's length range? If not, quantify the proposed adjustment.
   [ ] Consider reference to the TPO u/s 92CA where value/So risk is significant.

Reviewed by: ____________________
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
    # --- approvals (supervisory) ---
    {"id": "sanction_151", "name": "Sanction u/s 151 (approve 148 notice)", "category": "order", "side": "officer", "body": _SANCTION_151},
    {"id": "approval_153d", "name": "Approval u/s 153D (search assessment)", "category": "order", "side": "officer", "body": _APPROVAL_153D},
    # --- prosecution / compounding ---
    {"id": "prosecution_scn", "name": "SCN — proposed prosecution (Ch. XXII)", "category": "notice", "side": "officer", "body": _PROSECUTION_SCN},
    {"id": "sanction_279", "name": "Sanction for prosecution u/s 279(1)", "category": "order", "side": "officer", "body": _SANCTION_279},
    {"id": "compounding_application", "name": "Compounding application u/s 279(2)", "category": "other", "side": "assessee", "body": _COMPOUNDING_APPLICATION},
    {"id": "compounding_order", "name": "Compounding order u/s 279(2)", "category": "order", "side": "officer", "body": _COMPOUNDING_ORDER},
    # --- investigation (search & seizure) ---
    {"id": "stmt_132_4", "name": "Statement questionnaire u/s 132(4)", "category": "notice", "side": "officer", "body": _STMT_132_4},
    {"id": "summons_131", "name": "Summons questionnaire u/s 131", "category": "notice", "side": "officer", "body": _SUMMONS_131_Q},
    {"id": "appraisal_report", "name": "Appraisal report skeleton (search)", "category": "other", "side": "officer", "body": _APPRAISAL_REPORT},
    {"id": "unaccounted_note", "name": "Undisclosed-income working note", "category": "other", "side": "officer", "body": _UNACCOUNTED_NOTE},
    # --- transfer pricing ---
    {"id": "tpo_order", "name": "TPO order u/s 92CA(3) (ALP adjustment)", "category": "order", "side": "officer", "body": _TPO_ORDER},
    {"id": "checklist_3ceb", "name": "Form 3CEB review checklist", "category": "other", "side": "officer", "body": _CHECKLIST_3CEB},
]


def library() -> list[dict]:
    return [dict(t) for t in LIBRARY]
