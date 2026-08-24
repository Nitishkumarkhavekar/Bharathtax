"""Tests for the statutory calculators (app.services.calculators)."""
from __future__ import annotations

from datetime import date

from app.services import calculators as calc


def test_months_or_part():
    assert calc.months_or_part(date(2024, 4, 1), date(2024, 4, 1)) == 0
    assert calc.months_or_part(date(2024, 4, 1), date(2024, 7, 1)) == 3
    assert calc.months_or_part(date(2024, 4, 1), date(2024, 7, 15)) == 4   # part of Jul
    assert calc.months_or_part(date(2024, 4, 10), date(2024, 4, 20)) == 1  # part month → 1


def test_simple_interest_1pct_per_month():
    r = calc.simple_interest("234B", 100_000, date(2024, 4, 1), date(2024, 7, 15))
    assert r["months"] == 4
    assert r["interest"] == 4_000            # 100000 × 1% × 4
    assert r["total_payable"] == 104_000
    assert r["section"] == "234B"


def test_simple_interest_zero_when_not_overdue():
    r = calc.simple_interest("220(2)", 50_000, date(2024, 5, 1), date(2024, 5, 1))
    assert r["months"] == 0
    assert r["interest"] == 0


def test_115bbe_effective_78pct():
    r = calc.tax_115bbe(1_000_000)
    assert r["base_tax"] == 600_000          # 60%
    assert r["surcharge"] == 150_000         # 25% of base
    assert r["cess"] == 30_000               # 4% of (600000+150000)
    assert r["total_tax"] == 780_000
    assert r["effective_rate_pct"] == 78.0


def test_115bbe_zero_income():
    r = calc.tax_115bbe(0)
    assert r["total_tax"] == 0
    assert r["effective_rate_pct"] == 0.0
