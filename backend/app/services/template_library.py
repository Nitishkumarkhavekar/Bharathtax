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

LIBRARY = [
    {"id": "reply_142_1", "name": "Reply to notice u/s 142(1)", "category": "notice", "side": "assessee", "body": _REPLY_142_1},
    {"id": "reply_143_2", "name": "Reply to scrutiny notice u/s 143(2)", "category": "notice", "side": "assessee", "body": _REPLY_143_2},
    {"id": "reply_148a", "name": "Reply to SCN u/s 148A(b) (reopening)", "category": "notice", "side": "assessee", "body": _REPLY_148A},
    {"id": "reply_penalty", "name": "Reply to penalty SCN (270A / 271AAC)", "category": "notice", "side": "assessee", "body": _REPLY_PENALTY},
    {"id": "adjournment", "name": "Adjournment request", "category": "other", "side": "assessee", "body": _ADJOURNMENT},
    {"id": "stay_220_6", "name": "Stay application u/s 220(6)", "category": "other", "side": "assessee", "body": _STAY_220_6},
]


def library() -> list[dict]:
    return [dict(t) for t in LIBRARY]
