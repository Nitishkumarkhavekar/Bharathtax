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
# (percent of tax due by the cut-off, months of interest on the shortfall)
_234C_SCHEDULE = [("15 Jun", 0.15, 3), ("15 Sep", 0.45, 3),
                  ("15 Dec", 0.75, 3), ("15 Mar", 1.00, 1)]


def interest_234c(tax_liability: float, cum_paid: list[float]) -> dict:
    """Interest u/s 234C on advance-tax installment shortfalls.

    ``cum_paid`` = advance tax paid CUMULATIVELY by [15 Jun, 15 Sep, 15 Dec,
    15 Mar]. Interest is 1% for 3 months on each of the first three shortfalls
    and 1% for 1 month on the last. (Standard 15/45/75/100% schedule; the
    12%/36% safe-harbour for the first two is not applied — verify.)
    """
    tax_liability = max(0.0, round(tax_liability))
    cum_paid = (list(cum_paid) + [0, 0, 0, 0])[:4]
    rows, total = [], 0
    for i, (label, pct, months) in enumerate(_234C_SCHEDULE):
        required = tax_liability * pct
        paid = max(0.0, float(cum_paid[i] or 0))
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


def slab_tax(income: float, regime: str = "new") -> dict:
    """Income-tax on slab income (FY 2024-25). Includes Sec. 87A rebate and 4%
    cess; surcharge / marginal relief not modelled — an estimate to verify."""
    income = max(0.0, round(income))
    slabs = _NEW_SLABS if regime == "new" else _OLD_SLABS
    base = round(_slab_tax(income, slabs))
    rebate_limit = 700000 if regime == "new" else 500000
    rebate = base if income <= rebate_limit else 0
    after = base - rebate
    cess = round(after * 0.04)
    total = after + cess
    return {"income": income, "regime": regime, "tax_before_rebate": base,
            "rebate_87a": rebate, "cess": cess, "total_tax": total,
            "effective_rate_pct": round(total / income * 100, 2) if income else 0.0}


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
