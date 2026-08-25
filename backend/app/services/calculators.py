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
