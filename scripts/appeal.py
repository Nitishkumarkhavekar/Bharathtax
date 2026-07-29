"""CIT(A) / NFAC appellate-order drafting (model side).

Takes the appeal's documents (assessment order, Form 35, grounds, statement of
facts, submissions, remand report, etc. as text) and produces a structured draft
appellate order in formal CIT(A)/NFAC style — like the sample 'RAJU Order'.

Generated SECTION BY SECTION so long orders fit the model context and stay
well-structured. Exposed to the web app as the gateway model 'bharattax-appeal'.
Mirrors the 6-module spec in docs/source-material/Appeal Order tool.docx
(Module 5 Drafting Engine is the core; Modules 1-2 surfaced as a preliminary check).
"""
from __future__ import annotations

import rag_core

DOC_CAP = 16000          # chars of case material passed per section call (~4k tokens)

SYSTEM = (
    "You are an expert legal AI that drafts appellate orders under the Indian Income-tax "
    "Act for the Commissioner of Income-tax (Appeals) / NFAC. Write in formal, precise, "
    "impersonal CIT(A) style. Use ONLY the facts, figures, dates, names and grounds present "
    "in the provided case documents — never invent figures, dates, party names, section "
    "numbers, or case citations. Refer to the appellant as 'the appellant' and the assessing "
    "officer as 'the AO'. If a specific date, figure, or detail is not stated in the documents, "
    "write '[not on record]' instead of inventing it. Do not add preamble or meta commentary; "
    "output only the requested section text."
)

# (heading shown in the order, drafting instruction)
SECTIONS = [
    ("1. INTRODUCTION",
     "Draft the introduction: when and against which order the appeal was instituted (give the "
     "section under which the assessment/penalty order was passed, its date, the AO and ward/"
     "jurisdiction), the date of service of the impugned order as declared in Form 35, and then "
     "compute the delay in filing (days) and state whether condonation of delay is required and "
     "whether sufficient cause is shown."),
    ("2. GROUNDS OF APPEAL",
     "Reproduce the grounds of appeal raised by the appellant, cleaned up, grouped issue-wise and "
     "clearly numbered, without changing their substance."),
    ("3. FACTS OF THE CASE",
     "State the facts of the case in chronological order, including the nature of the assessment/"
     "penalty, the key figures (returned income, assessed income, additions, demand) and the "
     "procedural history (notices issued, replies, rectification, etc.)."),
    ("4. SUBMISSIONS OF THE APPELLANT",
     "Summarise the appellant's written submissions, organised ground-wise / issue-wise, "
     "capturing the legal and factual arguments made."),
    ("5. DISCUSSION AND FINDINGS",
     "Write the discussion and findings issue-wise. For EACH issue/ground present, give these "
     "labelled parts: Facts; Submissions; AO's view; Legal position (relevant sections/principles "
     "from the documents); Analysis; Finding; and Decision on that ground."),
    ("6. RESULT",
     "State the result: for each ground state whether it is Allowed / Partly Allowed / Dismissed / "
     "Set Aside, give the overall outcome of the appeal, and any clear directions to the AO."),
]

# Per-section output ceilings (the discussion is the longest part).
_MAXTOK = {"5. DISCUSSION AND FINDINGS": 1700, "4. SUBMISSIONS OF THE APPELLANT": 1300}


def deficiency_check(documents: str) -> str:
    """Module 1-2 quick pre-check: deficiencies, limitation, appealability, scope."""
    return rag_core.complete(
        SYSTEM,
        "CASE DOCUMENTS:\n" + documents[:DOC_CAP] + "\n\nTASK: Produce a short preliminary check "
        "with these headings: (a) Deficiency Report — completeness of Form 35, appeal fee, tax on "
        "returned income, clarity of grounds, mandatory attachments, and any Rule 46A (new "
        "evidence) issue; (b) Limitation — date of order, date of service, date of filing, delay in "
        "days, and whether condonation is needed; (c) Scope — the section appealed against, whether "
        "it is appealable u/s 246A, and whether it appears within the Faceless Appeal Scheme. Note "
        "anything missing. Keep it crisp.",
        max_tokens=700)


def draft_order(documents: str) -> str:
    docs = (documents or "").strip()
    if not docs:
        return "No appeal documents were provided. Please supply the assessment/penalty order, Form 35, grounds, and the appellant's submissions."
    docs = docs[:DOC_CAP]

    header = rag_core.complete(
        SYSTEM,
        "From the documents, output ONLY a one-line case header exactly in the form "
        "'NAME (PAN: XXXXXXXXXX) A.Y. YYYY-YY'. If a detail is missing leave it blank. "
        "Documents:\n" + docs[:4000],
        max_tokens=40).splitlines()[0].strip()

    parts = [header, ""]
    for heading, instruction in SECTIONS:
        body = rag_core.complete(
            SYSTEM,
            "CASE DOCUMENTS:\n" + docs + "\n\nTASK: " + instruction +
            "\nWrite ONLY this section, in formal CIT(A) style. Do not repeat the other sections.",
            max_tokens=_MAXTOK.get(heading, 1100))
        parts.append(heading)
        parts.append(body.strip())
        parts.append("")
    return "\n".join(parts).strip()
