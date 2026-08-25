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


def test_234c_all_unpaid():
    r = calc.interest_234c(100_000, [0, 0, 0, 0])
    # 450 + 1350 + 2250 + 1000
    assert r["interest"] == 5_050


def test_234c_fully_paid():
    r = calc.interest_234c(100_000, [15_000, 45_000, 75_000, 100_000])
    assert r["interest"] == 0


def test_234c_safe_harbour_12_36():
    # Paying 12% by 15 Jun and 36% by 15 Sep meets the safe-harbour → no interest.
    r = calc.interest_234c(100_000, [12_000, 36_000, 75_000, 100_000])
    assert r["interest"] == 0


def test_slab_new_regime_rebate_nil():
    assert calc.slab_tax(700_000, "new")["total_tax"] == 0


def test_slab_new_regime_above_rebate():
    r = calc.slab_tax(1_000_000, "new")
    assert r["tax_before_rebate"] == 50_000
    assert r["total_tax"] == 52_000        # + 4% cess


def test_slab_87a_marginal_relief():
    # Income just over 7L: tax must not exceed the excess over 7L (marginal relief).
    r = calc.slab_tax(705_000, "new")
    assert r["tax_before_rebate"] == 20_500
    assert r["total_tax"] == 5_200         # after=5000 (=705000-700000) + 4% cess


def test_slab_surcharge_over_50l():
    r = calc.slab_tax(6_000_000, "new")
    assert r["tax_before_rebate"] == 1_490_000
    assert r["surcharge_pct"] == 10.0      # 50L–1cr band
    assert r["surcharge"] == 149_000


def test_penalties():
    assert calc.penalty("270a_under", 100_000)["penalty"] == 50_000
    assert calc.penalty("270a_mis", 100_000)["penalty"] == 200_000
    assert calc.penalty("271aac", 100_000)["penalty"] == 10_000
    assert calc.penalty("271_1c", 100_000, pct=300)["penalty"] == 300_000


def test_capital_gains_ltcg_equity_exemption():
    r = calc.capital_gains(225_000, "ltcg_equity")
    assert r["taxable"] == 100_000         # after 1.25L exemption
    assert r["tax"] == 12_500              # 12.5%
    assert r["total_tax"] == 13_000        # + 4% cess


def test_tds_default_full():
    r = calc.tds_default(100_000, 10.0, date(2024, 5, 10),
                         date(2024, 6, 20), date(2024, 8, 10), date(2024, 7, 31))
    assert r["tds"] == 10_000
    assert r["interest_deduction_leg"]["interest"] == 200    # 1% × 2 months
    assert r["interest_deposit_leg"]["interest"] == 300      # 1.5% × 2 months
    assert r["interest_201_1a"] == 500
    assert r["fee_234e_days"] == 10
    assert r["fee_234e"] == 2_000                            # 10 × 200, under the cap
    assert r["total_payable"] == 12_500


def test_tds_234e_capped_at_tds():
    # Tiny TDS, long delay → 234E fee is capped at the TDS amount.
    r = calc.tds_default(10_000, 1.0, date(2024, 4, 1),
                         date(2024, 4, 1), date(2025, 4, 1), date(2024, 5, 31))
    assert r["tds"] == 100
    assert r["fee_234e"] == 100                              # capped, not 200/day


def test_tds_no_default_no_charges():
    # Deducted and deposited on time → no interest, no fee.
    r = calc.tds_default(50_000, 10.0, date(2024, 4, 10),
                         date(2024, 4, 10), date(2024, 4, 10), date(2024, 5, 7))
    assert r["tds"] == 5_000
    assert r["interest_201_1a"] == 0
    assert r["fee_234e"] == 0
    assert r["total_payable"] == 5_000
