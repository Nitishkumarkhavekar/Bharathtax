"""Statutory limitation-date engine — rules as DATA, computation as code.

Given a *trigger event* and its date, compute the downstream statutory
deadlines (each with its governing section) an officer or CA must not miss.

Design
------
* Rules live in :data:`LIMITATION_RULES` so a tax SME can add or adjust periods
  without touching the compute logic. A later iteration can move this list into
  a ``limitation_rule`` table verbatim (same fields) — the engine won't change.
* Every computed date carries the **governing section**, so the officer can
  verify it rather than trust a black box.
* Periods that have varied across Finance Acts (notably Sec. 153 time-barring)
  are expressed per-rule and can be overridden per assessment year later.

This module is pure (no DB, no I/O) and unit-tested in
``app/tests/test_limitation.py``.
"""
from __future__ import annotations

import calendar
from datetime import date, timedelta

# --- trigger events the caller can raise -------------------------------------
# The UI presents these; each maps to zero-or-more rules below.
TRIGGERS: dict[str, str] = {
    "order_served": "Assessment / penalty order served on the assessee",
    "cita_order_served": "CIT(A) / NFAC order served",
    "itat_order_served": "ITAT order served",
    "draft_order_144c": "Draft assessment order forwarded (TP / international)",
    "order_passed": "Any order passed (for rectification window)",
    "end_of_ay": "End of the assessment year (31 March) — for time-barring",
    "return_filed": "Return of income filed — for the 143(2) window",
    "penalty_initiated": "Penalty proceedings initiated — for the Sec. 275 order limitation",
}

# --- the rule catalogue (DATA) -----------------------------------------------
# offset.base: absent -> trigger_date | "end_of_month" | "end_of_fy" (31 Mar).
# Then days/months/years are added in that order.
LIMITATION_RULES: list[dict] = [
    {"id": "appeal_cita", "trigger": "order_served",
     "label": "Appeal to CIT(A)", "section": "Sec. 249",
     "offset": {"days": 30}},
    {"id": "appeal_itat", "trigger": "cita_order_served",
     "label": "Appeal to ITAT", "section": "Sec. 253",
     "offset": {"days": 60}},
    {"id": "appeal_hc", "trigger": "itat_order_served",
     "label": "Appeal to High Court", "section": "Sec. 260A",
     "offset": {"days": 120}},
    {"id": "drp_objection", "trigger": "draft_order_144c",
     "label": "File objections before the DRP", "section": "Sec. 144C(2)",
     "offset": {"days": 30}},
    {"id": "drp_directions", "trigger": "draft_order_144c",
     "label": "DRP directions due (9-month clock)", "section": "Sec. 144C(12)",
     "offset": {"months": 9, "base": "end_of_month"}},
    {"id": "rectification", "trigger": "order_passed",
     "label": "Rectification window closes", "section": "Sec. 154",
     "offset": {"years": 4, "base": "end_of_fy"}},
    {"id": "time_barring_153", "trigger": "end_of_ay",
     "label": "Assessment time-barring", "section": "Sec. 153(1)",
     "offset": {"months": 12}},
    {"id": "notice_143_2", "trigger": "return_filed",
     "label": "Last date to issue a 143(2) notice", "section": "Sec. 143(2)",
     "offset": {"months": 3, "base": "end_of_fy"}},
    {"id": "penalty_275", "trigger": "penalty_initiated",
     "label": "Penalty order limitation", "section": "Sec. 275",
     "offset": {"months": 6, "base": "end_of_month"}},
    {"id": "revision_263", "trigger": "order_passed",
     "label": "Revision order limitation (erroneous & prejudicial)", "section": "Sec. 263(2)",
     "offset": {"years": 2, "base": "end_of_fy"}},
    {"id": "revision_264_application", "trigger": "order_served",
     "label": "Last date for the assessee to apply for revision", "section": "Sec. 264(3)",
     "offset": {"years": 1}},
    {"id": "reassessment_149", "trigger": "end_of_ay",
     "label": "Reopening time-limit (3 yrs; 10 yrs if escaped income >= Rs.50L)",
     "section": "Sec. 149(1)", "offset": {"years": 3}},
]

_RULES_BY_TRIGGER: dict[str, list[dict]] = {}
for _r in LIMITATION_RULES:
    _RULES_BY_TRIGGER.setdefault(_r["trigger"], []).append(_r)


# --- date helpers ------------------------------------------------------------
def _end_of_month(d: date) -> date:
    return date(d.year, d.month, calendar.monthrange(d.year, d.month)[1])


def _end_of_fy(d: date) -> date:
    """31 March of the Indian financial year (1 Apr – 31 Mar) containing ``d``."""
    end_year = d.year + 1 if d.month >= 4 else d.year
    return date(end_year, 3, 31)


def _add_months(d: date, months: int) -> date:
    m = d.month - 1 + months
    y = d.year + m // 12
    m = m % 12 + 1
    last = calendar.monthrange(y, m)[1]
    return date(y, m, min(d.day, last))


def _add_years(d: date, years: int) -> date:
    try:
        return d.replace(year=d.year + years)
    except ValueError:            # 29 Feb in a non-leap target year
        return d.replace(year=d.year + years, day=28)


def _apply(trigger_date: date, offset: dict) -> date:
    b = offset.get("base")
    # "end_of_fy" anchors BEFORE adding the period (4 yrs from the FY end);
    # "end_of_month" snaps AFTER (9 months later, then to that month's end).
    d = _end_of_fy(trigger_date) if b == "end_of_fy" else trigger_date
    if "years" in offset:
        d = _add_years(d, offset["years"])
    if "months" in offset:
        d = _add_months(d, offset["months"])
    if "days" in offset:
        d = d + timedelta(days=offset["days"])
    if b == "end_of_month":
        d = _end_of_month(d)
    return d


# Sec. 153(1) time-barring has varied across Finance Acts. trigger_date is the
# 31 March ending the AY, so AY-start = year - 1.
def _months_153(trigger_date: date) -> int:
    ay_start = trigger_date.year - 1
    if ay_start <= 2017:      # up to AY 2017-18
        return 21
    if ay_start == 2018:      # AY 2018-19
        return 18
    return 12                 # AY 2019-20 onwards


# --- public API --------------------------------------------------------------
def compute_deadlines(trigger: str, trigger_date: date) -> list[dict]:
    """Return the deadlines a trigger produces.

    Each item: ``{rule_id, label, section, due_date}``. Empty list for an
    unknown trigger (caller may still record a purely manual deadline).
    """
    out: list[dict] = []
    for r in _RULES_BY_TRIGGER.get(trigger, []):
        if r["id"] == "time_barring_153":
            due = _add_months(trigger_date, _months_153(trigger_date))
        else:
            due = _apply(trigger_date, r["offset"])
        out.append({
            "rule_id": r["id"],
            "label": r["label"],
            "section": r["section"],
            "due_date": due,
        })
    return out


def rule_catalogue() -> dict:
    """Expose triggers + rules for the UI (what a trigger will compute)."""
    return {
        "triggers": [{"id": k, "label": v} for k, v in TRIGGERS.items()],
        "rules": [{"id": r["id"], "trigger": r["trigger"], "label": r["label"],
                   "section": r["section"]} for r in LIMITATION_RULES],
    }
