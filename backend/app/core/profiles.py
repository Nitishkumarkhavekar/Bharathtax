"""Workspace profiles — the user's PRIMARY function, used to tailor the
dashboard and sidebar. Keys align with the workspace `MatterCategory`
taxonomy (minus "other"). The rich per-profile config (which tools/tabs to
surface) lives in the frontend; the backend only stores and validates the key.
"""
from __future__ import annotations

WORKSPACE_PROFILES: list[dict] = [
    {"key": "officer", "label": "Assessing Officer"},
    {"key": "cita", "label": "CIT(A) / NFAC"},
    {"key": "drp", "label": "DRP"},
    {"key": "tp", "label": "Transfer Pricing (TPO)"},
    {"key": "investigation", "label": "Investigation"},
    {"key": "ici", "label": "I&CI"},
    {"key": "recovery", "label": "Recovery / TRO"},
    {"key": "tds", "label": "TDS / Exemptions"},
    {"key": "ca", "label": "CA / Advocate"},
]

WORKSPACE_PROFILE_KEYS = {p["key"] for p in WORKSPACE_PROFILES}
_LABEL_BY_KEY = {p["key"]: p["label"] for p in WORKSPACE_PROFILES}

# The standpoint each function argues from. Fed to the model (chat preamble) so
# an answer adopts the officer's perspective even when their free-text
# designation is blank — a TPO reasons as a TPO, a CA argues for the assessee.
WING_STANDPOINT: dict[str, str] = {
    "officer": "the Assessing Officer, framing the assessment on the material on record",
    "cita": "the first appellate authority (CIT(A) / NFAC), deciding the appeal ground-wise",
    "drp": "the Dispute Resolution Panel, issuing directions on a draft assessment order",
    "tp": "the Transfer Pricing Officer, determining the arm's-length price",
    "investigation": "the Investigation wing, appraising seized and gathered material",
    "ici": "the Intelligence & Criminal Investigation (I&CI) wing, verifying reported financial information",
    "recovery": "the Tax Recovery Officer, enforcing an outstanding demand",
    "tds": "the TDS / Exemptions officer, examining deduction compliance and exemption claims",
    "ca": "a Chartered Accountant / Advocate, representing the assessee",
}


def wing_label(profile: str | None, wings: list[str] | None = None) -> str | None:
    """Human label for a resolved profile — the single function's label, or the
    first chosen function for a 'custom' profile. None for all/none/unknown."""
    if not profile or profile in META_PROFILES:
        if profile == "custom" and wings:
            for k in wings:
                if k in _LABEL_BY_KEY:
                    return _LABEL_BY_KEY[k]
        return None
    return _LABEL_BY_KEY.get(profile)


def wing_standpoint(profile: str | None, wings: list[str] | None = None) -> str:
    """The perspective phrase for a resolved profile (or the first chosen
    function of a 'custom' profile). Empty string when there's nothing to add."""
    if not profile or profile in META_PROFILES:
        if profile == "custom" and wings:
            for k in wings:
                if k in WING_STANDPOINT:
                    return WING_STANDPOINT[k]
        return ""
    return WING_STANDPOINT.get(profile, "")

# Meta profile values (not a single function):
#   "all"    -> explicit "show everything" (no scoping, no first-run prompt)
#   "custom" -> the user picks several functions; the chosen keys live in
#               User.workspace_wings.
# None -> not chosen yet (the first-run prompt still shows).
META_PROFILES = {"all", "custom"}


def is_valid_profile(key: str | None) -> bool:
    return key is None or key in WORKSPACE_PROFILE_KEYS or key in META_PROFILES


def valid_wings(keys: list[str] | None) -> bool:
    """Every entry of a custom wing selection must be a real function key."""
    if not keys:
        return True
    return all(k in WORKSPACE_PROFILE_KEYS for k in keys)
