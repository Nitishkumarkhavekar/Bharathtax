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


def test_installment_plan_declining_balance():
    r = calc.installment_plan(120_000, 4, date(2024, 5, 1))
    assert len(r["schedule"]) == 4
    assert r["total_principal"] == 120_000
    # 1% on declining balance: 1200 + 900 + 600 + 300
    assert r["total_interest"] == 3_000
    assert r["total_payable"] == 123_000
    assert r["schedule"][0]["opening_balance"] == 120_000
    assert r["schedule"][-1]["closing_balance"] == 0


def test_installment_plan_rounding_remainder_in_last():
    r = calc.installment_plan(100_000, 3, date(2024, 4, 1))
    # Principals must sum exactly to the demand despite rounding.
    assert sum(row["principal"] for row in r["schedule"]) == 100_000
    assert r["schedule"][-1]["closing_balance"] == 0


def test_trust_application_11_shortfall():
    r = calc.trust_application_11(1_000_000, 700_000, 50_000)
    assert r["required_application_85pct"] == 850_000
    assert r["permitted_accumulation_15pct"] == 150_000
    assert r["shortfall_taxable"] == 100_000     # 850000 - (700000 + 50000)


def test_trust_application_11_no_shortfall_when_fully_applied():
    r = calc.trust_application_11(1_000_000, 900_000)
    assert r["shortfall_taxable"] == 0            # applied > 85%


def test_tax_115bbc_threshold_and_rate():
    r = calc.tax_115bbc(500_000, 2_000_000)
    assert r["exempt_threshold"] == 100_000       # max(5% of 20L, 1L)
    assert r["taxable_at_115bbc"] == 400_000
    assert r["tax"] == 120_000                    # 30%
    assert r["total_tax"] == 124_800              # + 4% cess


def test_tax_115bbc_5pct_threshold_dominates():
    r = calc.tax_115bbc(300_000, 10_000_000)
    assert r["exempt_threshold"] == 500_000       # 5% of 1cr > 1L
    assert r["taxable_at_115bbc"] == 0            # anon below threshold
    assert r["total_tax"] == 0


def test_peak_credit_rotating_fund():
    r = calc.peak_credit([
        {"date": "2016-11-10", "amount": 500_000, "kind": "credit"},
        {"date": "2016-11-15", "amount": 300_000, "kind": "debit"},
        {"date": "2016-11-20", "amount": 700_000, "kind": "credit"},
        {"date": "2016-11-25", "amount": 200_000, "kind": "debit"},
    ])
    assert r["peak_credit"] == 900_000          # 500 - 300 + 700 = 900 peak
    assert r["peak_date"] == "2016-11-20"
    assert r["total_credits"] == 1_200_000


def test_peak_credit_sorts_by_date():
    # Out-of-order input must be chronologically ordered before running balance.
    r = calc.peak_credit([
        {"date": "2016-12-05", "amount": 200_000, "kind": "credit"},
        {"date": "2016-11-01", "amount": 100_000, "kind": "credit"},
    ])
    assert r["peak_credit"] == 300_000
    assert r["schedule"][0]["date"] == "2016-11-01"


def test_peak_credit_debit_not_below_zero():
    r = calc.peak_credit([
        {"date": "2016-11-01", "amount": 100_000, "kind": "credit"},
        {"date": "2016-11-02", "amount": 500_000, "kind": "debit"},
        {"date": "2016-11-03", "amount": 50_000, "kind": "credit"},
    ])
    assert r["peak_credit"] == 100_000           # balance floors at 0, not -400000


def test_alp_range_outside_uses_median():
    r = calc.alp_range([4, 6, 8, 10, 12, 14, 16], tested_margin=3.0, base_amount=10_000_000)
    assert r["method"] == "range_35_65"
    assert r["lower_p35"] == 8.0 and r["median"] == 10.0 and r["upper_p65"] == 12.0
    assert r["at_arms_length"] is False
    assert r["adjustment"] == 700_000          # (10 - 3)% of 1cr


def test_alp_range_within_no_adjustment():
    r = calc.alp_range([4, 6, 8, 10, 12, 14, 16], tested_margin=10.0, base_amount=10_000_000)
    assert r["at_arms_length"] is True
    assert r["adjustment"] == 0


def test_alp_mean_method_when_fewer_than_six():
    r = calc.alp_range([8, 10, 12], tested_margin=6.0, base_amount=1_000_000)
    assert r["method"] == "mean"
    assert r["mean"] == 10.0
    assert r["adjustment"] == 40_000           # (10 - 6)% of 10L


def test_sft_analyze_aggregates_and_flags():
    r = calc.sft_analyze([
        {"pan": "AAAPL1234C", "name": "Ravi", "category": "cash_deposit_sb", "amount": 600_000},
        {"pan": "AAAPL1234C", "name": "Ravi", "category": "cash_deposit_sb", "amount": 700_000},
        {"pan": "BBBPL5678D", "name": "Sita", "category": "immovable_property", "amount": 2_500_000},
        {"pan": "CCCPL9999E", "name": "Amit", "category": "shares_mf_bonds", "amount": 1_500_000},
    ])
    assert r["summary"]["persons"] == 3
    assert r["summary"]["flagged"] == 2          # Ravi (13L SB) + Amit (15L shares)
    assert r["summary"]["grand_total"] == 5_300_000
    ravi = next(p for p in r["people"] if p["pan"] == "AAAPL1234C")
    assert ravi["total"] == 1_300_000 and ravi["flagged"] is True
    sita = next(p for p in r["people"] if p["pan"] == "BBBPL5678D")
    assert sita["flagged"] is False              # 25L property < 30L threshold


def test_sft_analyze_unknown_category_uses_default():
    r = calc.sft_analyze([{"pan": "X", "category": "misc", "amount": 1_200_000}])
    assert r["people"][0]["flagged"] is True     # >= 10L default threshold


def test_sft_analyze_ranks_by_total_desc():
    r = calc.sft_analyze([
        {"pan": "A", "category": "other", "amount": 100},
        {"pan": "B", "category": "other", "amount": 900},
    ])
    assert [p["pan"] for p in r["people"]] == ["B", "A"]
