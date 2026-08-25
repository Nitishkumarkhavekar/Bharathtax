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


def is_valid_profile(key: str | None) -> bool:
    return key is None or key in WORKSPACE_PROFILE_KEYS
