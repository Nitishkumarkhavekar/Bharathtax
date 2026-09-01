"""Live probe: hit VertexLLM with the real _COMPOSER_SYSTEM prompt on the
two failure-mode questions from the developer feedback screenshots.
Regression check for:
  1. GST-as-CA — must NOT deflect with "scope is income-tax only".
  2. Finance-Act mapping for AY 2026-27 — must cite Part III of FA 2025 AND
     Part I of FA 2026, not just Part I of FA 2025.
  3. Tax Year 2026-27 — must route to Income-tax Act 2025 (Tax Year
     framework), not AY 2027-28 under the 1961 Act.

Run from inside the api container:
  docker exec taxmedha-api-1 python /app/scripts/quality/probe_scope_and_finance.py
"""
from __future__ import annotations

import re
import sys

sys.path.insert(0, "/app")

from app.services.multi_agent import _COMPOSER_SYSTEM
from app.services.llm import VertexLLM

llm = VertexLLM("gemini-2.5-flash")

DEFLECT = re.compile(
    r"(strictly limited|expertise is (?:strictly )?limited"
    r"|only.{0,20}income-tax|cannot provide.{0,10}GST"
    r"|cannot advise.{0,10}GST|not equipped.{0,10}GST"
    r"|out of (?:my )?scope|outside my scope)",
    re.I,
)

CASES = [
    ("GST-as-CA",
     "I am a CA advising a client whose ITC has been questioned because "
     "of a mismatch with GSTR-2B. Explain the legal position, the "
     "possible reasons for the mismatch, and the documents I should "
     "review before responding to the GST department."),
    ("Finance-Act-mapping",
     "What Act and Finance Act govern income earned on 15 March 2026? "
     "Be specific about which Part of which Schedule of which Finance Act."),
    ("Tax-Year-2026-27",
     "For a Tax Year 2026-27 case, which Act applies — old (1961) or "
     "new (2025)? Which specific provisions govern?"),
]

results = []
for label, q in CASES:
    print(f"\n===== {label} =====")
    try:
        ans = llm.complete(_COMPOSER_SYSTEM, q, max_tokens=900)
    except Exception as e:
        print(f"LLM ERROR: {e!r}")
        results.append((label, False, str(e)))
        continue
    print(ans[:1200])
    print("---")
    checks = []
    if DEFLECT.search(ans):
        checks.append(("no-deflection", False, "scope-deflection language present"))
    else:
        checks.append(("no-deflection", True, "clean"))
    if label == "Finance-Act-mapping":
        cites_2026 = "finance act, 2026" in ans.lower()
        cites_part_iii_2025 = "part iii" in ans.lower() and "2025" in ans.lower()
        ok = cites_2026 and cites_part_iii_2025
        checks.append(("cites-FA-2025-partIII+FA-2026-partI", ok,
                       f"FA2026={cites_2026}, Part-III-of-2025={cites_part_iii_2025}"))
    if label == "Tax-Year-2026-27":
        cites_2025_act = "income-tax act, 2025" in ans.lower() or "income tax act, 2025" in ans.lower()
        bad_1961 = ("ay 2027-28" in ans.lower()
                    and "1961" in ans.lower()
                    and "2025" not in ans.lower())
        ok = cites_2025_act and not bad_1961
        checks.append(("routes-to-2025-Act", ok,
                       f"cites 2025 Act={cites_2025_act}, wrongly on 1961={bad_1961}"))
    for name, ok, note in checks:
        prefix = "PASS" if ok else "FAIL"
        print(f"  [{prefix}] {name}: {note}")
    results.append((label, all(ok for _, ok, _ in checks), checks))

print("\n===== SUMMARY =====")
for label, ok, _ in results:
    print(f"  {'PASS' if ok else 'FAIL'}  {label}")
