"""Statutory tax calculators — pure functions, no DB, unit-tested.

Covers the interest provisions that share the "1% per month or part of a month"
mechanic (Sec. 234A, 234B, 220(2)) and the special-rate tax under Sec. 115BBE.
Every result carries its ``workings`` so an officer can verify the figure
rather than trust a black box.

The month count follows the "every month or part of a month" rule: any
commenced month is charged in full. Edge cases at exact day boundaries are
approximated — results are labelled as estimates for the user to confirm
against the assessment.
"""
from __future__ import annotations

from datetime import date

MONTHLY_RATE = 1.0  # % per month for Sec. 234A / 234B / 220(2)


def months_or_part(start: date, end: date) -> int:
    """Whole months between two dates, counting any part-month as a full month."""
    if end <= start:
        return 0
    m = (end.year - start.year) * 12 + (end.month - start.month)
    if end.day > start.day:
        m += 1
    return max(m, 1)


def simple_interest(section: str, principal: float, start: date, end: date,
                    rate_pct_per_month: float = MONTHLY_RATE) -> dict:
    """1%-per-month interest on ``principal`` for the period start→end.

    Serves Sec. 234A (default-return interest), Sec. 234B (advance-tax
    shortfall) and Sec. 220(2) (delayed demand) — the caller picks the section
    and supplies the right principal + dates.
    """
    principal = max(0.0, round(principal))
    months = months_or_part(start, end)
    interest = round(principal * (rate_pct_per_month / 100.0) * months)
    return {
        "section": section,
        "principal": principal,
        "from_date": start.isoformat(),
        "to_date": end.isoformat(),
        "rate_pct_per_month": rate_pct_per_month,
        "months": months,
        "interest": interest,
        "total_payable": principal + interest,
        "workings": f"{principal:,.0f} × {rate_pct_per_month:g}% × {months} month(s) = {interest:,.0f}",
    }


def tax_115bbe(income: float, surcharge_pct: float = 25.0, cess_pct: float = 4.0) -> dict:
    """Tax on unexplained income u/s 115BBE: 60% + 25% surcharge + 4% cess
    (≈ 78% effective). No deduction / set-off is allowed against such income."""
    income = max(0.0, round(income))
    base = round(income * 0.60)
    surcharge = round(base * surcharge_pct / 100.0)
    subtotal = base + surcharge
    cess = round(subtotal * cess_pct / 100.0)
    total = subtotal + cess
    return {
        "income": income,
        "base_rate_pct": 60.0,
        "base_tax": base,
        "surcharge_pct": surcharge_pct,
        "surcharge": surcharge,
        "cess_pct": cess_pct,
        "cess": cess,
        "total_tax": total,
        "effective_rate_pct": round(total / income * 100, 2) if income else 0.0,
        "workings": (f"60% = {base:,.0f}; +{surcharge_pct:g}% surcharge = {surcharge:,.0f}; "
                     f"+{cess_pct:g}% cess = {cess:,.0f}; total = {total:,.0f}"),
    }


# --- Sec. 234C: deferment of advance tax (quarterly) -------------------------
# (cut-off, required %, safe-harbour % that waives interest, months of interest)
# The proviso waives interest for 15 Jun / 15 Sep if >= 12% / 36% is paid, even
# though 15% / 45% is the nominal requirement.
_234C_SCHEDULE = [("15 Jun", 0.15, 0.12, 3), ("15 Sep", 0.45, 0.36, 3),
                  ("15 Dec", 0.75, 0.75, 3), ("15 Mar", 1.00, 1.00, 1)]


def interest_234c(tax_liability: float, cum_paid: list[float]) -> dict:
    """Interest u/s 234C on advance-tax installment shortfalls.

    ``cum_paid`` = advance tax paid CUMULATIVELY by [15 Jun, 15 Sep, 15 Dec,
    15 Mar]. Interest is 1% for 3 months on each of the first three shortfalls
    and 1% for 1 month on the last. Applies the 12% / 36% safe-harbour proviso
    for the first two installments (no interest if the threshold is met).
    """
    tax_liability = max(0.0, round(tax_liability))
    cum_paid = (list(cum_paid) + [0, 0, 0, 0])[:4]
    rows, total = [], 0
    for i, (label, req_pct, safe_pct, months) in enumerate(_234C_SCHEDULE):
        required = tax_liability * req_pct
        safe_amt = tax_liability * safe_pct
        paid = max(0.0, float(cum_paid[i] or 0))
        if paid >= safe_amt:                       # safe-harbour met → no interest
            shortfall = 0.0
        else:
            shortfall = max(0.0, round(required - paid))
        interest = round(shortfall * 0.01 * months)
        total += interest
        rows.append({"installment": label, "required": round(required), "paid": round(paid),
                     "shortfall": shortfall, "months": months, "interest": interest})
    return {"section": "234C", "tax_liability": tax_liability, "installments": rows, "interest": total}


# --- slab tax (FY 2024-25 / AY 2025-26) --------------------------------------
_NEW_SLABS = [(300000, 0), (700000, 5), (1000000, 10), (1200000, 15), (1500000, 20), (float("inf"), 30)]
_OLD_SLABS = [(250000, 0), (500000, 5), (1000000, 20), (float("inf"), 30)]


def _slab_tax(income: float, slabs: list) -> float:
    tax, lower = 0.0, 0.0
    for upper, rate in slabs:
        if income <= lower:
            break
        taxable = min(income, upper) - lower
        tax += taxable * rate / 100.0
        lower = upper
    return tax


def _surcharge_rate(income: float, regime: str) -> float:
    """Surcharge % on the income-tax for individuals (FY 2024-25)."""
    if income <= 5_000_000:
        return 0.0
    if income <= 10_000_000:
        return 10.0
    if income <= 20_000_000:
        return 15.0
    if income <= 50_000_000:
        return 25.0
    return 25.0 if regime == "new" else 37.0        # new regime caps surcharge at 25%


def slab_tax(income: float, regime: str = "new") -> dict:
    """Income-tax on slab income (FY 2024-25): slab tax + Sec. 87A rebate (with
    marginal relief) + surcharge for income > 50L + 4% cess. Surcharge marginal
    relief at the 50L/1cr/2cr/5cr thresholds is NOT modelled — verify near a
    threshold."""
    income = max(0.0, round(income))
    slabs = _NEW_SLABS if regime == "new" else _OLD_SLABS
    base = round(_slab_tax(income, slabs))
    rebate_limit = 700000 if regime == "new" else 500000
    if income <= rebate_limit:
        after = 0                                    # full 87A rebate
    else:
        # 87A marginal relief: tax just above the limit can't exceed the excess.
        after = min(base, income - rebate_limit)
    reduction = base - after                         # rebate and/or marginal relief
    sur_rate = _surcharge_rate(income, regime)
    surcharge = round(after * sur_rate / 100.0)
    cess = round((after + surcharge) * 0.04)
    total = after + surcharge + cess
    return {"income": income, "regime": regime, "tax_before_rebate": base,
            "rebate_87a": reduction, "surcharge_pct": sur_rate, "surcharge": surcharge,
            "cess": cess, "total_tax": total,
            "effective_rate_pct": round(total / income * 100, 2) if income else 0.0}


# --- penalties ---------------------------------------------------------------
# kind -> (label, default rate % of the base tax)
_PENALTY = {
    "270a_under": ("Sec. 270A — under-reporting", 50.0),
    "270a_mis": ("Sec. 270A — mis-reporting", 200.0),
    "271aac": ("Sec. 271AAC — tax u/s 115BBE", 10.0),
    "271_1c": ("Sec. 271(1)(c) — concealment", 100.0),
}


def penalty(kind: str, base_tax: float, pct: float | None = None) -> dict:
    """Penalty amount as a % of the base tax (tax on the under-reported / 115BBE
    / evaded amount). 270A is 50% (under) / 200% (mis); 271AAC is 10%; 271(1)(c)
    ranges 100–300% (caller may set ``pct``)."""
    label, default_pct = _PENALTY.get(kind, ("Penalty", 100.0))
    rate = float(pct) if (pct is not None and kind == "271_1c") else default_pct
    rate = min(300.0, max(0.0, rate))
    base_tax = max(0.0, round(base_tax))
    amount = round(base_tax * rate / 100.0)
    return {"kind": kind, "label": label, "base_tax": base_tax, "rate_pct": rate,
            "penalty": amount,
            "note": "Base = the tax on the under-reported / 115BBE / evaded amount."}


# --- TDS: default computation + section rate reference -----------------------
# section -> (nature of payment, default resident rate %). Rates are the common
# residents' rates; thresholds and special cases (e.g. no-PAN 206AA @ 20%) are
# noted for the officer to confirm against the year's Finance Act.
TDS_SECTIONS: list[dict] = [
    {"section": "192", "nature": "Salary", "rate": None, "note": "At the average rate on estimated salary."},
    {"section": "192A", "nature": "Premature EPF withdrawal", "rate": 10.0, "note": "20% if no PAN. Threshold Rs. 50,000."},
    {"section": "193", "nature": "Interest on securities", "rate": 10.0, "note": ""},
    {"section": "194", "nature": "Dividend", "rate": 10.0, "note": "Threshold Rs. 5,000."},
    {"section": "194A", "nature": "Interest other than securities", "rate": 10.0, "note": "Bank threshold Rs. 40,000 (Rs. 50,000 senior)."},
    {"section": "194C", "nature": "Payment to contractor", "rate": 1.0, "note": "1% individual/HUF, 2% others. Threshold Rs. 30,000 single / Rs. 1,00,000 aggregate."},
    {"section": "194H", "nature": "Commission or brokerage", "rate": 2.0, "note": "Threshold Rs. 20,000 (FY 2024-25)."},
    {"section": "194I(a)", "nature": "Rent — plant & machinery", "rate": 2.0, "note": "Threshold Rs. 2,40,000."},
    {"section": "194I(b)", "nature": "Rent — land / building", "rate": 10.0, "note": "Threshold Rs. 2,40,000."},
    {"section": "194J", "nature": "Professional / technical fees", "rate": 10.0, "note": "2% for technical services & call-centres."},
    {"section": "194Q", "nature": "Purchase of goods", "rate": 0.1, "note": "On value above Rs. 50,00,000."},
    {"section": "195", "nature": "Payment to non-resident", "rate": None, "note": "Rate per Act / DTAA — depends on the income."},
    {"section": "206AA", "nature": "No PAN furnished", "rate": 20.0, "note": "Higher of the specified rate or 20%."},
]


def tds_default(amount: float, rate_pct: float, deduction_due: date,
                deducted_on: date | None, deposited_on: date | None,
                due_date_for_deposit: date | None = None) -> dict:
    """Compute a TDS short-/non-deduction default: the TDS itself, the interest
    u/s 201(1A) and the late-filing fee u/s 234E.

    - Interest 201(1A): 1% per month (or part) from the date tax was DEDUCTIBLE
      to the date it was actually DEDUCTED (failure/late DEDUCTION); plus 1.5%
      per month from the date DEDUCTED to the date DEPOSITED (late PAYMENT).
    - Fee 234E: Rs. 200 per day of delay in filing the TDS statement, capped at
      the TDS amount. Charged only when a ``due_date_for_deposit`` (the statement
      due date) and a later ``deposited_on`` are given.
    All results carry ``workings`` for verification. Estimate — confirm dates.
    """
    amount = max(0.0, round(amount))
    rate_pct = max(0.0, float(rate_pct))
    tds = round(amount * rate_pct / 100.0)

    # 201(1A)(i): 1%/month, deductible -> deducted (or -> deposited if never deducted)
    end_deduct = deducted_on or deposited_on or deduction_due
    m1 = months_or_part(deduction_due, end_deduct) if end_deduct > deduction_due else 0
    int_deduct = round(tds * 0.01 * m1)

    # 201(1A)(ii): 1.5%/month, deducted -> deposited
    int_deposit = 0
    m2 = 0
    if deducted_on and deposited_on and deposited_on > deducted_on:
        m2 = months_or_part(deducted_on, deposited_on)
        int_deposit = round(tds * 0.015 * m2)

    interest = int_deduct + int_deposit

    # 234E: Rs. 200/day of delay in filing the statement, capped at the TDS.
    fee_234e = 0
    days_late = 0
    if due_date_for_deposit and deposited_on and deposited_on > due_date_for_deposit:
        days_late = (deposited_on - due_date_for_deposit).days
        fee_234e = min(tds, days_late * 200)

    return {
        "amount": amount,
        "rate_pct": rate_pct,
        "tds": tds,
        "interest_201_1a": interest,
        "interest_deduction_leg": {"months": m1, "rate_pct_per_month": 1.0, "interest": int_deduct},
        "interest_deposit_leg": {"months": m2, "rate_pct_per_month": 1.5, "interest": int_deposit},
        "fee_234e": fee_234e,
        "fee_234e_days": days_late,
        "total_payable": tds + interest + fee_234e,
        "workings": (
            f"TDS = {amount:,.0f} × {rate_pct:g}% = {tds:,.0f}; "
            f"201(1A)(i) {tds:,.0f} × 1% × {m1} = {int_deduct:,.0f}; "
            f"201(1A)(ii) {tds:,.0f} × 1.5% × {m2} = {int_deposit:,.0f}; "
            f"234E {days_late} day(s) × 200 (cap {tds:,.0f}) = {fee_234e:,.0f}"
        ),
        "note": "201(1A)(i) 1%/mth deductible→deducted; (ii) 1.5%/mth deducted→deposited; "
                "234E Rs.200/day capped at the TDS. Estimate — verify the dates and current rates.",
    }


# --- I&CI: SFT / AIS high-value transaction analytics ------------------------
# Rule 114E reporting thresholds (per person, per year) — the annual aggregate
# at or above which a transaction category is a "specified financial transaction".
SFT_THRESHOLDS: list[dict] = [
    {"key": "cash_deposit_sb", "label": "Cash deposits — savings account", "threshold": 1000000},
    {"key": "cash_deposit_ca", "label": "Cash deposits/withdrawals — current account", "threshold": 5000000},
    {"key": "time_deposit", "label": "Time deposits (FD)", "threshold": 1000000},
    {"key": "credit_card", "label": "Credit-card payments", "threshold": 1000000},
    {"key": "cc_cash", "label": "Credit-card payments in cash", "threshold": 100000},
    {"key": "immovable_property", "label": "Purchase/sale of immovable property", "threshold": 3000000},
    {"key": "shares_mf_bonds", "label": "Shares / mutual funds / bonds / debentures", "threshold": 1000000},
    {"key": "foreign_currency", "label": "Foreign-currency sale / forex card", "threshold": 1000000},
]
_SFT_BY_KEY = {t["key"]: t for t in SFT_THRESHOLDS}
_SFT_DEFAULT_THRESHOLD = 1000000


def sft_analyze(rows: list[dict]) -> dict:
    """Aggregate a set of AIS/SFT transaction rows by person (PAN) and flag those
    whose per-category annual aggregate meets or exceeds the Rule 114E reporting
    threshold — the I&CI first-cut for high-value transactions and potential
    non-/under-reporting.

    ``rows`` = list of {pan, name, category, amount}. ``category`` should match an
    SFT key (see SFT_THRESHOLDS); unknown categories use a default Rs. 10L
    threshold. Returns a per-PAN summary (ranked by total) with the flagged
    categories, plus portfolio stats. Estimate — the flag is a lead for
    verification, not a finding.
    """
    people: dict[str, dict] = {}
    for r in rows:
        pan = (str(r.get("pan") or "").strip().upper()) or "UNKNOWN"
        name = str(r.get("name") or "").strip()
        cat = str(r.get("category") or "other").strip()
        amt = max(0.0, float(r.get("amount") or 0))
        p = people.setdefault(pan, {"pan": pan, "name": name, "total": 0.0,
                                    "count": 0, "by_category": {}})
        if name and not p["name"]:
            p["name"] = name
        p["total"] += amt
        p["count"] += 1
        p["by_category"][cat] = p["by_category"].get(cat, 0.0) + amt

    results = []
    flagged_count = 0
    grand_total = 0.0
    for p in people.values():
        flags = []
        for cat, total in p["by_category"].items():
            thr = _SFT_BY_KEY.get(cat, {}).get("threshold", _SFT_DEFAULT_THRESHOLD)
            if total >= thr:
                flags.append({"category": cat,
                              "label": _SFT_BY_KEY.get(cat, {}).get("label", cat),
                              "amount": round(total), "threshold": thr})
        grand_total += p["total"]
        if flags:
            flagged_count += 1
        results.append({
            "pan": p["pan"], "name": p["name"], "total": round(p["total"]),
            "count": p["count"], "flags": flags, "flagged": bool(flags),
        })
    results.sort(key=lambda x: x["total"], reverse=True)
    return {
        "people": results,
        "summary": {
            "persons": len(results),
            "flagged": flagged_count,
            "transactions": sum(p["count"] for p in results),
            "grand_total": round(grand_total),
        },
        "note": "Flag = per-category annual aggregate at/above the Rule 114E threshold — a lead "
                "for verification (source, disclosure in the return, non-filer check), not a finding.",
    }


# --- transfer pricing: ALP range / mean (TNMM etc.) --------------------------
# The five prescribed methods (Sec. 92C r.w. Rule 10B) for the picker/reference.
TP_METHODS: list[dict] = [
    {"key": "CUP", "name": "Comparable Uncontrolled Price", "use": "A reliable comparable uncontrolled price exists (same product/terms) — the most direct method."},
    {"key": "RPM", "name": "Resale Price Method", "use": "Distributor/reseller adding little value; benchmarks the gross resale margin."},
    {"key": "CPM", "name": "Cost Plus Method", "use": "Manufacturer/service provider; benchmarks the gross mark-up on costs."},
    {"key": "TNMM", "name": "Transactional Net Margin Method", "use": "Most common; benchmarks a net-profit-level indicator (OP/OC, OP/Sales, Berry ratio) against comparables."},
    {"key": "PSM", "name": "Profit Split Method", "use": "Highly integrated transactions or unique intangibles on both sides; splits the combined profit."},
]


def _percentile_10ca(sorted_vals: list[float], frac: float) -> float:
    """Percentile per the Rule 10CA data-set convention: position = n*frac; if it
    is a whole number take the mean of that value and the next, else take the
    value at the next higher place."""
    n = len(sorted_vals)
    pos = n * frac
    import math
    if abs(pos - round(pos)) < 1e-9:
        i = int(round(pos))
        # i-th and (i+1)-th (1-indexed) -> 0-indexed i-1 and i
        return (sorted_vals[i - 1] + sorted_vals[min(i, n - 1)]) / 2.0
    i = math.ceil(pos)
    return sorted_vals[min(i, n) - 1]


def alp_range(comparables: list[float], tested_margin: float, base_amount: float = 0.0) -> dict:
    """Arm's-length benchmarking for a net-margin method (e.g. TNMM).

    ``comparables`` = the comparables' margins (%). With 6 or more, applies the
    Rule 10CA inter-quartile-style RANGE (35th–65th percentile): if the tested
    margin lies within [P35, P65] it is at arm's length; otherwise the MEDIAN is
    the ALP and the adjustment is computed. With fewer than 6, the arithmetic
    MEAN is the benchmark. ``base_amount`` (operating cost or sales) turns a
    margin gap into a money adjustment. Estimate — Rule 10CA/10CB have detail
    (multiple-year data, tolerance band) the officer must apply.
    """
    vals = sorted(float(x) for x in comparables)
    n = len(vals)
    base = max(0.0, float(base_amount or 0))
    tested = float(tested_margin)
    if n == 0:
        return {"method": "range", "count": 0, "at_arms_length": None, "note": "No comparables supplied."}
    if n >= 6:
        lower = _percentile_10ca(vals, 0.35)
        upper = _percentile_10ca(vals, 0.65)
        median = _percentile_10ca(vals, 0.50)
        within = lower <= tested <= upper
        alp_margin = tested if within else median
        adjustment = 0.0 if within else round((median - tested) / 100.0 * base)
        return {
            "method": "range_35_65", "count": n,
            "lower_p35": round(lower, 2), "upper_p65": round(upper, 2), "median": round(median, 2),
            "tested_margin": round(tested, 2), "at_arms_length": within,
            "alp_margin": round(alp_margin, 2), "adjustment": adjustment,
            "note": "6+ comparables: Rule 10CA 35th–65th percentile range; median is the ALP if "
                    "outside. Estimate — apply multiple-year data and the tolerance band.",
        }
    mean = sum(vals) / n
    within = abs(tested - mean) < 1e-9
    adjustment = round((mean - tested) / 100.0 * base)
    return {
        "method": "mean", "count": n, "mean": round(mean, 2),
        "tested_margin": round(tested, 2), "at_arms_length": within,
        "alp_margin": round(mean, 2), "adjustment": adjustment,
        "note": "Fewer than 6 comparables: arithmetic mean is the benchmark; the ±3% (or notified) "
                "tolerance under the 2nd proviso to 92C(2) applies to the price. Estimate — verify.",
    }


# --- investigation: peak credit of unexplained deposits ----------------------
def peak_credit(entries: list[dict]) -> dict:
    """Peak-credit theory for unexplained cash deposits/credits.

    ``entries`` = list of {date: 'YYYY-MM-DD', amount: float, kind: 'credit'|'debit'}.
    Arranged chronologically, deposits (credits) build a rotating fund and
    withdrawals (debits) draw it down (not below zero — a withdrawal is assumed
    available for redeposit). The PEAK of the running balance is the maximum
    unexplained investment rotated, and is the defensible quantum of the
    addition (rather than the gross of all deposits). Returns the peak, its
    date, and the running schedule. Estimate — the AO must still establish that
    the credits are unexplained and that telescoping/rotation applies.
    """
    def _key(e):
        return str(e.get("date") or "")
    ordered = sorted(entries, key=_key)
    balance = 0.0
    peak = 0.0
    peak_date = None
    rows = []
    total_credit = 0.0
    total_debit = 0.0
    for e in ordered:
        amt = max(0.0, float(e.get("amount") or 0))
        kind = (e.get("kind") or "credit").lower()
        if kind == "debit":
            total_debit += amt
            balance = max(0.0, balance - amt)
        else:
            total_credit += amt
            balance += amt
        if balance > peak:
            peak = balance
            peak_date = e.get("date")
        rows.append({"date": e.get("date"), "kind": kind, "amount": round(amt),
                     "running_balance": round(balance)})
    return {
        "peak_credit": round(peak),
        "peak_date": peak_date,
        "total_credits": round(total_credit),
        "total_debits": round(total_debit),
        "entries": len(ordered),
        "schedule": rows,
        "note": "Peak credit = the maximum rotating balance of the credits, the defensible "
                "quantum vs the gross of all deposits. The AO must establish the credits are "
                "unexplained and that rotation/telescoping applies. Estimate — verify.",
    }


# --- trust / charity: 11 application shortfall & 115BBC anonymous donations --
def trust_application_11(gross_income: float, amount_applied: float,
                         accumulated_11_2: float = 0.0) -> dict:
    """Sec. 11 application test for a charitable/religious trust.

    A trust may accumulate up to 15% of its income unconditionally; it must
    APPLY at least 85% of income to its objects. Any part of that 85% that is
    neither applied nor validly set apart u/s 11(2) (Form 10, up to 5 years) is
    taxable. Returns the permitted 15% accumulation, the 85% application
    requirement, and the taxable shortfall. Estimate — verify against the
    accounts and Form 10.
    """
    gross = max(0.0, round(gross_income))
    applied = max(0.0, round(amount_applied))
    form10 = max(0.0, round(accumulated_11_2))
    permitted_15 = round(gross * 0.15)
    required_85 = round(gross * 0.85)
    covered = min(required_85, applied + form10)
    shortfall = max(0.0, round(required_85 - covered))
    return {
        "gross_income": gross,
        "permitted_accumulation_15pct": permitted_15,
        "required_application_85pct": required_85,
        "amount_applied": applied,
        "accumulated_11_2_form10": form10,
        "shortfall_taxable": shortfall,
        "workings": (f"85% of {gross:,.0f} = {required_85:,.0f} to be applied; "
                     f"applied {applied:,.0f} + Form 10 {form10:,.0f} = {applied + form10:,.0f}; "
                     f"shortfall taxable = {shortfall:,.0f}"),
        "note": "15% may be accumulated freely; 85% must be applied or set apart u/s 11(2). "
                "Estimate — verify the accounts, corpus donations and Form 10.",
    }


def tax_115bbc(anonymous_donations: float, total_donations: float,
               rate_pct: float = 30.0, cess_pct: float = 4.0) -> dict:
    """Tax on anonymous donations u/s 115BBC: 30% on the anonymous donations
    that EXCEED the higher of 5% of total donations or Rs. 1,00,000. The
    exempt slice is taxed at normal trust rates; only the excess bears 30%."""
    anon = max(0.0, round(anonymous_donations))
    total = max(0.0, round(total_donations))
    threshold = round(max(0.05 * total, 100000))
    taxable = max(0.0, round(anon - threshold))
    tax = round(taxable * rate_pct / 100.0)
    cess = round(tax * cess_pct / 100.0)
    return {
        "anonymous_donations": anon,
        "total_donations": total,
        "exempt_threshold": threshold,
        "taxable_at_115bbc": taxable,
        "rate_pct": rate_pct,
        "tax": tax,
        "cess": cess,
        "total_tax": tax + cess,
        "workings": (f"threshold = max(5% of {total:,.0f}, 1,00,000) = {threshold:,.0f}; "
                     f"taxable = {anon:,.0f} − {threshold:,.0f} = {taxable:,.0f}; "
                     f"30% + cess = {tax + cess:,.0f}"),
        "note": "Only anonymous donations above the threshold bear 30%. Wholly-religious "
                "trusts and certain institutions are outside 115BBC — verify eligibility.",
    }


# --- recovery: demand installment plan with 220(2) interest ------------------
def installment_plan(demand: float, n_installments: int, first_due: date,
                     monthly_rate_pct: float = 1.0) -> dict:
    """Split an outstanding demand into ``n_installments`` equal monthly principal
    installments and accrue Sec. 220(2) interest at 1% per month on the balance
    OUTSTANDING at the start of each month.

    Each row is a month: the equal principal slice, the 220(2) interest on the
    opening balance for that month, the total due that month, and the closing
    balance. Grand totals let the officer see the interest cost of the plan.
    Estimate — verify against the demand notice and the actual 30-day default
    date under Sec. 220(1)/(2).
    """
    demand = max(0.0, round(demand))
    n = max(1, int(n_installments))
    slice_principal = round(demand / n)
    rows = []
    balance = demand
    total_interest = 0
    due = first_due
    for i in range(n):
        # Last installment mops up any rounding remainder.
        principal = balance if i == n - 1 else min(slice_principal, balance)
        interest = round(balance * monthly_rate_pct / 100.0)
        total_interest += interest
        closing = round(balance - principal)
        rows.append({
            "n": i + 1,
            "due_date": due.isoformat(),
            "opening_balance": round(balance),
            "principal": round(principal),
            "interest_220_2": interest,
            "total_due": round(principal + interest),
            "closing_balance": max(0, closing),
        })
        balance = closing
        due = _add_months_date(due, 1)
    return {
        "section": "220(2)",
        "demand": demand,
        "installments": n,
        "monthly_rate_pct": monthly_rate_pct,
        "total_principal": demand,
        "total_interest": total_interest,
        "total_payable": demand + total_interest,
        "schedule": rows,
        "note": "220(2) interest at 1%/month on the outstanding balance. Estimate — "
                "verify the 30-day default date and any part-month rounding.",
    }


def _add_months_date(d: date, months: int) -> date:
    """Add whole months to a date, clamping the day to the month's length."""
    import calendar
    m0 = d.month - 1 + months
    year = d.year + m0 // 12
    month = m0 % 12 + 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


# --- capital gains (post 23-Jul-2024 rates) ----------------------------------
def capital_gains(amount: float, kind: str = "ltcg_equity") -> dict:
    """Tax on capital gains (rates effective 23 Jul 2024). Estimate — verify."""
    amount = max(0.0, round(amount))
    if kind == "ltcg_equity":            # Sec. 112A
        exemption, taxable, rate, label = 125000, max(0.0, amount - 125000), 12.5, "LTCG on listed equity (Sec. 112A)"
    elif kind == "stcg_equity":          # Sec. 111A
        exemption, taxable, rate, label = 0, amount, 20.0, "STCG on listed equity (Sec. 111A)"
    else:                                # Sec. 112 (other LTCG)
        exemption, taxable, rate, label = 0, amount, 12.5, "LTCG (Sec. 112)"
    tax = round(taxable * rate / 100.0)
    cess = round(tax * 0.04)
    return {"kind": kind, "label": label, "gain": amount, "exemption": exemption,
            "taxable": round(taxable), "rate_pct": rate, "tax": tax, "cess": cess,
            "total_tax": tax + cess}
