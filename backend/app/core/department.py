"""Canonical Income-Tax Department taxonomy — the single source of truth for
department- and role-customised dashboards (Phase 0 of the dashboard plan).

This module encodes, in machine-readable form, the research on the real
department structure:

  * WINGS         — every functional wing / directorate, its standpoint, the
                    sections it lives in, and its day-to-day activities + the
                    tools/templates/calculators/deadlines that serve them.
  * DESIGNATIONS  — the full rank ladder (executive + ministerial) with the
                    seniority TIER each rank sits in (drafts / reviews / sanctions).
  * APPROVALS     — which rank sanctions which statutory step (§151, §153D,
                    §144C, §263/264 …), including the §151 AY-dependence.

It is deliberately ADDITIVE: it does not rewire the existing 9-key
`core.profiles` personalisation. Later phases (capture, dashboard, approval
routing) read from here; nothing changes behaviour until they do.

Everything is plain JSON-serialisable dict/list so it can be served verbatim to
the frontend via the taxonomy endpoint.
"""
from __future__ import annotations

# --------------------------------------------------------------------------- #
# Seniority tiers — the axis that decides "drafts vs reviews vs sanctions".
# --------------------------------------------------------------------------- #
TIER_MINISTERIAL = "ministerial"   # MTS/TA/AO(admin)/PS — office, no assessment
TIER_FIELD = "field"               # Inspector/ITO/ACIT/DCIT — drafts
TIER_RANGE = "range"               # JCIT/Addl.CIT — reviews & approves (§153D/§144A)
TIER_COMMISSIONER = "commissioner" # CIT/Pr.CIT — revision & §151 sanction
TIER_APEX = "apex"                 # CCIT/Pr.CCIT — regional, §151 (>3yr) sanction

TIERS = [TIER_MINISTERIAL, TIER_FIELD, TIER_RANGE, TIER_COMMISSIONER, TIER_APEX]


# --------------------------------------------------------------------------- #
# WINGS — the functional verticals. `key` overlaps the existing profile keys
# where they already exist (officer/cita/drp/tp/investigation/ici/recovery/
# tds/ca) and ADDS the ones the flat model was missing.
# --------------------------------------------------------------------------- #
WINGS: list[dict] = [
    {
        "key": "officer", "label": "Assessing Officer (Faceless / NaFAC)",
        "group": "Assessment", "line": "commissioner", "faceless": True,
        "standpoint": "the Assessing Officer framing the assessment on the material on record",
        "sections": ["143", "147", "148", "148A", "68", "69", "115BBE", "271AAC", "270A", "142"],
        "activities": [
            "Draft 143(3)/147/144 assessment orders",
            "Issue 142(1)/143(2)/148 notices",
            "Respond to NaFAC allocations; seek VU verification / TU technical input",
            "Watch §153 time-barring dates",
        ],
        "tools": ["/drafting", "/calculators", "/rulings", "/workspace"],
        "template_groups": ["Assessment", "Reassessment", "Penalty"],
        "calc_tabs": ["interest", "234c", "bbe", "slab", "capgains", "penalty"],
        "deadlines": ["153", "149", "275"],
    },
    {
        "key": "cita", "label": "CIT(A) / NFAC (Appeals)",
        "group": "Appeals", "line": "commissioner", "faceless": True,
        "standpoint": "the first appellate authority (CIT(A) / NFAC) deciding the appeal ground-wise",
        "sections": ["246A", "250", "251", "270A", "271", "68", "69", "143"],
        "activities": [
            "Dispose appeals (Form 35); draft ground-wise appellate orders u/s 250",
            "Admit/decline additional evidence (Rule 46A)",
            "Meet disposal targets; issue CSR on adverse orders",
        ],
        "tools": ["/drafting", "/rulings", "/templates"],
        "template_groups": ["Appeals & Revision"],
        "calc_tabs": ["interest", "bbe", "penalty"],
        "deadlines": ["appeal_cita", "250"],
    },
    {
        "key": "drp", "label": "Dispute Resolution Panel (DRP)",
        "group": "Appeals", "line": "commissioner", "faceless": False,
        "standpoint": "the Dispute Resolution Panel issuing directions on a draft assessment order",
        "sections": ["144C", "92CA", "143", "147"],
        "activities": [
            "Take up objections to draft orders (foreign co. / TP)",
            "Watch the §144C 9-month clock",
            "Issue binding directions (confirm/reduce/enhance)",
        ],
        "tools": ["/drafting", "/calculators", "/rulings"],
        "template_groups": ["Transfer Pricing", "Appeals & Revision"],
        "calc_tabs": ["alp", "interest"],
        "deadlines": ["144C"],
    },
    {
        "key": "tp", "label": "Transfer Pricing Officer (TPO)",
        "group": "Transfer Pricing", "line": "commissioner", "faceless": False,
        "standpoint": "the Transfer Pricing Officer determining the arm's-length price",
        "sections": ["92C", "92CA", "92D", "92E", "144C"],
        "activities": [
            "Determine the ALP on a §92CA reference from the AO",
            "Issue §92D documentation notices; propose adjustments (→ DRP)",
        ],
        "tools": ["/drafting", "/calculators", "/rulings"],
        "template_groups": ["Transfer Pricing"],
        "calc_tabs": ["alp"],
        "deadlines": ["92CA"],
    },
    {
        "key": "inttax", "label": "International Taxation",
        "group": "Transfer Pricing", "line": "commissioner", "faceless": False,
        "standpoint": "the International Taxation officer assessing non-residents and treaty issues",
        "sections": ["9", "90", "195", "115A", "144C", "92CA"],
        "activities": [
            "Assess non-residents / foreign companies (draft order → DRP)",
            "Withholding on foreign remittances (§195); DTAA/treaty application",
        ],
        "tools": ["/drafting", "/calculators", "/rulings"],
        "template_groups": ["Transfer Pricing", "Assessment"],
        "calc_tabs": ["alp", "interest"],
        "deadlines": ["144C", "153"],
    },
    {
        "key": "investigation", "label": "Investigation (Search & Survey)",
        "group": "Investigation", "line": "director", "faceless": False,
        "standpoint": "the Investigation wing appraising seized and gathered material",
        "sections": ["132", "132A", "133A", "153A", "153C", "68", "69", "115BBE"],
        "activities": [
            "Conduct searches (§132) and surveys (§133A)",
            "Record §132(4) statements; prepare the appraisal report",
            "Hand cases to Central charges for §153A/153C assessment",
        ],
        "tools": ["/drafting", "/calculators", "/reconcile"],
        "template_groups": ["Investigation", "I&CI"],
        "calc_tabs": ["peak", "bbe", "interest"],
        "deadlines": ["153B"],
    },
    {
        "key": "central", "label": "Central Charges (Search Assessment)",
        "group": "Investigation", "line": "commissioner", "faceless": False,
        "standpoint": "the Central Circle officer framing search assessments on seized material",
        "sections": ["153A", "153C", "153D", "158BC", "68", "69", "115BBE", "271AAB"],
        "activities": [
            "Frame §153A (searched person, +6 yrs) / §153C assessments",
            "Route the draft order for §153D approval to the Range Head",
        ],
        "tools": ["/drafting", "/calculators", "/rulings"],
        "template_groups": ["Investigation", "Assessment", "Penalty"],
        "calc_tabs": ["peak", "bbe", "interest", "penalty"],
        "deadlines": ["153B"],
    },
    {
        "key": "ici", "label": "Intelligence & Criminal Investigation (I&CI)",
        "group": "Investigation", "line": "director", "faceless": False,
        "standpoint": "the I&CI wing verifying reported financial information",
        "sections": ["285BA", "271FA", "139A", "133", "277"],
        "activities": [
            "Collect/collate/disseminate SFT (§285BA r/w Rule 114E; Form 61A)",
            "Verify high-value transactions; e-verification",
            "Run criminal investigation & coordinate prosecution",
        ],
        "tools": ["/drafting", "/reconcile", "/calculators"],
        "template_groups": ["I&CI", "Investigation"],
        "calc_tabs": ["peak"],
        "deadlines": [],
    },
    {
        "key": "tds", "label": "TDS / TRACES",
        "group": "TDS", "line": "commissioner", "faceless": False,
        "standpoint": "the TDS officer examining deduction compliance",
        "sections": ["192", "194", "194A", "194J", "194C", "201", "40", "234E", "271C", "197"],
        "activities": [
            "Process deductor defaults (§201/201(1A)); §234E fees",
            "Conduct TDS surveys; issue §197 lower-deduction certificates",
        ],
        "tools": ["/drafting", "/calculators", "/templates"],
        "template_groups": ["TDS"],
        "calc_tabs": ["tds", "interest"],
        "deadlines": ["201"],
    },
    {
        "key": "exemptions", "label": "Exemptions (Trusts & Institutions)",
        "group": "Exemptions", "line": "commissioner", "faceless": False,
        "standpoint": "the Exemptions officer examining charitable/religious institutions",
        "sections": ["12AB", "12A", "80G", "13", "11", "10", "115TD"],
        "activities": [
            "Register/approve trusts (§12AB / §80G); provisional → final",
            "Assess trusts; act on §13 violations; §115TD accreted-income",
        ],
        "tools": ["/drafting", "/calculators", "/rulings"],
        "template_groups": ["Exemptions"],
        "calc_tabs": ["interest"],
        "deadlines": ["12AB"],
    },
    {
        "key": "recovery", "label": "Recovery / Tax Recovery Officer (TRO)",
        "group": "Recovery", "line": "commissioner", "faceless": False,
        "standpoint": "the Tax Recovery Officer enforcing an outstanding demand",
        "sections": ["220", "221", "222", "226", "156", "179", "167C", "281B"],
        "activities": [
            "Recover arrears (§222 certificate; Second Schedule)",
            "Attach/sell property; §226(3) garnishee; §220(6) stay/instalments",
        ],
        "tools": ["/drafting", "/calculators", "/templates"],
        "template_groups": ["Recovery"],
        "calc_tabs": ["interest", "recovery", "penalty"],
        "deadlines": ["220"],
    },
    {
        "key": "audit", "label": "Internal Audit",
        "group": "Audit", "line": "commissioner", "faceless": False,
        "standpoint": "the Internal Audit officer checking the quality of assessments",
        "sections": ["143", "263"],
        "activities": [
            "Audit completed assessments (Internal/Special Audit Parties)",
            "Raise & settle internal audit objections before C&AG review",
        ],
        "tools": ["/rulings", "/calculators", "/drafting"],
        "template_groups": ["Assessment"],
        "calc_tabs": ["interest", "bbe"],
        "deadlines": [],
    },
    {
        "key": "hq", "label": "Headquarters / Administration",
        "group": "HQ", "line": "commissioner", "faceless": False,
        "standpoint": "the Headquarters office coordinating administration and monitoring",
        "sections": [],
        "activities": [
            "Establishment/DDO/accounts; dak & monitoring",
            "Statistics/MIS (CAP-I/II, disposal); RTI/grievance; coordination",
        ],
        "tools": ["/workspace", "/rulings"],
        "template_groups": [],
        "calc_tabs": [],
        "deadlines": [],
    },
    {
        "key": "ca", "label": "CA / Advocate (Assessee side)",
        "group": "Assessee", "line": "commissioner", "faceless": False,
        "standpoint": "a Chartered Accountant / Advocate representing the assessee",
        "sections": ["139", "143", "80C", "54", "44AB", "234B", "270A"],
        "activities": [
            "Draft replies to notices (§142(1)/143(2)); grounds of appeal",
            "Prepare written submissions; compute tax/relief",
        ],
        "tools": ["/drafting", "/calculators", "/rulings", "/reconcile"],
        "template_groups": ["Assessee replies"],
        "calc_tabs": ["interest", "slab", "capgains", "tds"],
        "deadlines": ["appeal_cita"],
    },
]

WINGS_BY_KEY = {w["key"]: w for w in WINGS}
WING_KEYS = [w["key"] for w in WINGS]


# --------------------------------------------------------------------------- #
# DESIGNATIONS — the full ladder (executive + ministerial), each mapped to a
# seniority tier and its functional "line". `directorate` marks the Director-
# line label used inside directorates (Investigation/I&CI/Systems).
# --------------------------------------------------------------------------- #
DESIGNATIONS: list[dict] = [
    # --- ministerial / clerical (Group C, no assessment powers) ---
    {"key": "mts", "label": "Multi-Tasking Staff (MTS)", "tier": TIER_MINISTERIAL, "cadre": "ministerial"},
    {"key": "notice_server", "label": "Notice Server", "tier": TIER_MINISTERIAL, "cadre": "ministerial"},
    {"key": "ta", "label": "Tax Assistant (TA)", "tier": TIER_MINISTERIAL, "cadre": "ministerial"},
    {"key": "sta", "label": "Senior Tax Assistant", "tier": TIER_MINISTERIAL, "cadre": "ministerial"},
    {"key": "steno", "label": "Stenographer", "tier": TIER_MINISTERIAL, "cadre": "steno"},
    {"key": "os", "label": "Office Superintendent / Executive Assistant", "tier": TIER_MINISTERIAL, "cadre": "ministerial"},
    # --- Administrative Officer cadre (gazetted ministerial — NOT the AO) ---
    {"key": "ao3", "label": "Administrative Officer Grade III", "tier": TIER_MINISTERIAL, "cadre": "admin"},
    {"key": "ao2", "label": "Administrative Officer Grade II", "tier": TIER_MINISTERIAL, "cadre": "admin"},
    {"key": "ao1", "label": "Administrative Officer Grade I / Sr. AO", "tier": TIER_MINISTERIAL, "cadre": "admin"},
    {"key": "pao", "label": "Principal Administrative Officer", "tier": TIER_MINISTERIAL, "cadre": "admin"},
    # --- Private Secretary cadre ---
    {"key": "ps", "label": "Private Secretary", "tier": TIER_MINISTERIAL, "cadre": "steno"},
    {"key": "pps", "label": "Principal Private Secretary (PPS)", "tier": TIER_MINISTERIAL, "cadre": "steno"},
    # --- executive / assessment line ---
    {"key": "inspector", "label": "Inspector of Income Tax", "tier": TIER_FIELD, "cadre": "executive"},
    {"key": "ito", "label": "Income Tax Officer (ITO)", "tier": TIER_FIELD, "cadre": "executive"},
    {"key": "tro", "label": "Tax Recovery Officer (TRO)", "tier": TIER_FIELD, "cadre": "executive"},
    {"key": "acit", "label": "Assistant Commissioner (ACIT)", "tier": TIER_FIELD, "cadre": "irs",
     "directorate": "ADIT — Assistant Director"},
    {"key": "dcit", "label": "Deputy Commissioner (DCIT)", "tier": TIER_FIELD, "cadre": "irs",
     "directorate": "DDIT — Deputy Director"},
    {"key": "jcit", "label": "Joint Commissioner (JCIT) — Range", "tier": TIER_RANGE, "cadre": "irs",
     "directorate": "JDIT — Joint Director"},
    {"key": "addl_cit", "label": "Additional Commissioner (Addl. CIT) — Range", "tier": TIER_RANGE, "cadre": "irs",
     "directorate": "Addl. DIT — Additional Director"},
    {"key": "cit", "label": "Commissioner (CIT)", "tier": TIER_COMMISSIONER, "cadre": "irs",
     "directorate": "DIT — Director"},
    {"key": "pr_cit", "label": "Principal Commissioner (Pr. CIT)", "tier": TIER_COMMISSIONER, "cadre": "irs",
     "directorate": "Pr. DIT — Principal Director"},
    {"key": "ccit", "label": "Chief Commissioner (CCIT)", "tier": TIER_APEX, "cadre": "irs",
     "directorate": "DGIT — Director General"},
    {"key": "pr_ccit", "label": "Principal Chief Commissioner (Pr. CCIT)", "tier": TIER_APEX, "cadre": "irs",
     "directorate": "Pr. DGIT — Principal Director General"},
]

DESIGNATIONS_BY_KEY = {d["key"]: d for d in DESIGNATIONS}
DESIGNATION_KEYS = [d["key"] for d in DESIGNATIONS]


def designation_tier(designation_key: str | None) -> str | None:
    """The seniority tier for a designation key, or None if unknown."""
    d = DESIGNATIONS_BY_KEY.get((designation_key or "").strip().lower())
    return d["tier"] if d else None


# Fold the 5 canonical tiers onto the 3 COARSE seniority buckets the drafting /
# approval layers reason in (ministerial → '', apex → 'commissioner'). One
# definition, shared by profiles.role_tier and the approval-routing.
COARSE_TIER = {
    TIER_MINISTERIAL: "", TIER_FIELD: "field", TIER_RANGE: "range",
    TIER_COMMISSIONER: "commissioner", TIER_APEX: "commissioner",
}


# --------------------------------------------------------------------------- #
# APPROVALS — which rank sanctions which statutory step. Feeds the review/
# approval routing (Phase 4) and lets the product show "who signs this off".
# --------------------------------------------------------------------------- #
APPROVALS: list[dict] = [
    {"section": "151", "what": "Sanction to reopen (notice u/s 148)", "ay_dependent": True,
     "authority": {"within_3y": ["pr_cit", "cit"], "beyond_3y": ["pr_ccit", "ccit"]},
     "note": "Post Finance Act 2021; pre-2021 the JCIT sanctioned within 4 years. Finance (No.2) Act 2024 overhauled the machinery — key off the notice date/AY."},
    {"section": "153D", "what": "Approval of search assessment (§153A/153C)", "ay_dependent": False,
     "authority": ["jcit", "addl_cit"],
     "note": "Range Head; must be a genuine application of mind."},
    {"section": "144C", "what": "Draft order → DRP (foreign co. / TP)", "ay_dependent": False,
     "authority": ["cit"], "note": "DRP = collegium of three Commissioners."},
    {"section": "144A", "what": "Directions on the AO's line of assessment", "ay_dependent": False,
     "authority": ["jcit", "addl_cit"], "note": "Range Head."},
    {"section": "263", "what": "Revision prejudicial to revenue (suo motu)", "ay_dependent": False,
     "authority": ["pr_cit", "cit"], "note": ""},
    {"section": "264", "what": "Revision (on assessee application; not prejudicial)", "ay_dependent": False,
     "authority": ["pr_cit", "cit"], "note": ""},
]

APPROVALS_BY_SECTION = {a["section"]: a for a in APPROVALS}


def approver_for(section: str, *, years_elapsed: float | None = None) -> list[str] | None:
    """The designation keys that can sanction a step under `section`.

    For AY-dependent §151, pass `years_elapsed` (years from the end of the
    relevant AY) to resolve the ≤3yr vs >3yr split. Returns None if the section
    has no mapped approval.
    """
    a = APPROVALS_BY_SECTION.get((section or "").strip().upper().lstrip("S").strip())
    if not a:
        return None
    auth = a["authority"]
    if a.get("ay_dependent") and isinstance(auth, dict):
        if years_elapsed is None:
            # unknown timing — return the union so the caller can still show options
            return sorted(set(auth.get("within_3y", []) + auth.get("beyond_3y", [])))
        return auth["within_3y"] if years_elapsed <= 3 else auth["beyond_3y"]
    return list(auth) if isinstance(auth, list) else None


# --------------------------------------------------------------------------- #
# Serialisation — the whole taxonomy as one payload for the frontend.
# --------------------------------------------------------------------------- #
def taxonomy() -> dict:
    """The full department taxonomy, JSON-serialisable, for the /meta endpoint."""
    return {
        "tiers": TIERS,
        "wings": WINGS,
        "designations": DESIGNATIONS,
        "approvals": APPROVALS,
    }
