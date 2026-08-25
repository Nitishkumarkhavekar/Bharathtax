"""Tests for the statutory limitation-date engine (app.services.limitation).

Pure function, no DB — asserts the computed due dates and governing sections
for each trigger the daily-workspace calendar relies on.
"""
from __future__ import annotations

from datetime import date, timedelta

from app.services import limitation


def _one(trigger, d):
    out = limitation.compute_deadlines(trigger, d)
    assert len(out) == 1, out
    return out[0]


def _by_id(trigger, d, rule_id):
    out = limitation.compute_deadlines(trigger, d)
    match = [r for r in out if r["rule_id"] == rule_id]
    assert len(match) == 1, out
    return match[0]


def test_appeal_cita_is_30_days_sec_249():
    r = _by_id("order_served", date(2026, 8, 1), "appeal_cita")
    assert r["section"] == "Sec. 249"
    assert r["due_date"] == date(2026, 8, 31)


def test_revision_263_two_years_from_fy_end():
    # order passed 15 Dec 2023 -> FY ends 31 Mar 2024 -> +2 years
    r = _by_id("order_passed", date(2023, 12, 15), "revision_263")
    assert r["section"] == "Sec. 263(2)"
    assert r["due_date"] == date(2026, 3, 31)


def test_revision_264_one_year_from_order():
    # assessee's window: 1 year from the order served
    r = _by_id("order_served", date(2024, 5, 10), "revision_264_application")
    assert r["section"] == "Sec. 264(3)"
    assert r["due_date"] == date(2025, 5, 10)


def test_itat_is_60_days_sec_253():
    r = _one("cita_order_served", date(2026, 1, 1))
    assert r["section"] == "Sec. 253"
    assert r["due_date"] == date(2026, 1, 1) + timedelta(days=60)


def test_high_court_is_120_days_sec_260a():
    r = _one("itat_order_served", date(2026, 1, 1))
    assert r["section"] == "Sec. 260A"
    assert r["due_date"] == date(2026, 1, 1) + timedelta(days=120)


def test_drp_produces_two_deadlines():
    out = limitation.compute_deadlines("draft_order_144c", date(2026, 4, 15))
    by_id = {o["rule_id"]: o for o in out}
    assert set(by_id) == {"drp_objection", "drp_directions"}
    assert by_id["drp_objection"]["due_date"] == date(2026, 5, 15)          # +30 days
    # end of month (Apr 2026) + 9 months, snapped to month-end -> 31 Jan 2027
    assert by_id["drp_directions"]["due_date"] == date(2027, 1, 31)


def test_time_barring_153_twelve_months():
    # end_of_ay for AY 2023-24 is 31 Mar 2024; +12 months
    r = _by_id("end_of_ay", date(2024, 3, 31), "time_barring_153")
    assert r["section"] == "Sec. 153(1)"
    assert r["due_date"] == date(2025, 3, 31)


def test_time_barring_153_ay_aware_periods():
    # AY 2016-17 (ends 31 Mar 2017) → 21 months
    assert _by_id("end_of_ay", date(2017, 3, 31), "time_barring_153")["due_date"] == date(2018, 12, 31)
    # AY 2018-19 (ends 31 Mar 2019) → 18 months
    assert _by_id("end_of_ay", date(2019, 3, 31), "time_barring_153")["due_date"] == date(2020, 9, 30)


def test_reassessment_149_three_years():
    # AY ends 31 Mar 2024 -> normal reopening window 3 years
    r = _by_id("end_of_ay", date(2024, 3, 31), "reassessment_149")
    assert r["section"] == "Sec. 149(1)"
    assert r["due_date"] == date(2027, 3, 31)


def test_rectification_four_years_from_fy_end():
    # order passed 10 Aug 2026 -> FY ends 31 Mar 2027 -> +4 years
    r = _by_id("order_passed", date(2026, 8, 10), "rectification")
    assert r["section"] == "Sec. 154"
    assert r["due_date"] == date(2031, 3, 31)


def test_143_2_window_three_months_from_fy_end():
    # return filed 20 Jul 2026 -> FY ends 31 Mar 2027 -> +3 months
    r = _one("return_filed", date(2026, 7, 20))
    assert r["section"] == "Sec. 143(2)"
    assert r["due_date"] == date(2027, 6, 30)


def test_penalty_275_order_limitation():
    # initiated 10 Aug 2026 → 6 months from end of that month → 28 Feb 2027
    r = _one("penalty_initiated", date(2026, 8, 10))
    assert r["section"] == "Sec. 275"
    assert r["due_date"] == date(2027, 2, 28)


def test_unknown_trigger_returns_empty():
    assert limitation.compute_deadlines("does_not_exist", date(2026, 1, 1)) == []


def test_rule_catalogue_shape():
    cat = limitation.rule_catalogue()
    assert {t["id"] for t in cat["triggers"]} >= {"order_served", "draft_order_144c"}
    assert any(r["id"] == "appeal_cita" for r in cat["rules"])


def test_final_order_144c13_one_month_end_of_month():
    # DRP directions received 12 May 2026 -> final order by end of the next month
    r = _by_id("drp_directions_received", date(2026, 5, 12), "final_order_144c_13")
    assert r["section"] == "Sec. 144C(13)"
    assert r["due_date"] == date(2026, 6, 30)


def test_time_barring_153_ay_2021_22_is_nine_months():
    # AY 2021-22 ends 31 Mar 2022 -> Finance Act 2021 set 9 months -> 31 Dec 2022
    r = _by_id("end_of_ay", date(2022, 3, 31), "time_barring_153")
    assert r["due_date"] == date(2022, 12, 31)
    # AY 2022-23 ends 31 Mar 2023 -> back to 12 months -> 31 Mar 2024
    r2 = _by_id("end_of_ay", date(2023, 3, 31), "time_barring_153")
    assert r2["due_date"] == date(2024, 3, 31)
    # AY 2020-21 ends 31 Mar 2021 -> 12 months -> 31 Mar 2022
    r3 = _by_id("end_of_ay", date(2021, 3, 31), "time_barring_153")
    assert r3["due_date"] == date(2022, 3, 31)
