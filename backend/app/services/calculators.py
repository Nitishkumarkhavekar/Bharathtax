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
