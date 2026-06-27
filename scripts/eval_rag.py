"""Evaluation harness for the BharathTax RAG chatbot (hybrid retrieval).

Measures retrieval hit-rate, top-1, grounding, refusal correctness, key-fact
presence, and latency over a labeled test set. Smoke eval, not a benchmark.
"""
from __future__ import annotations

import statistics as st
import time

import rag_core

# (question, expected_section_or_rule | None=out-of-corpus, expected_fact | None)
TESTS = [
    # --- Chapter VIA deductions ---
    ("What is the maximum deduction under section 80C?", "80C", "1,50,000"),
    ("What deduction is allowed for contribution to pension fund under section 80CCC?", "80CCC", None),
    ("What is the additional NPS deduction under section 80CCD(1B)?", "80CCD", None),
    ("What deduction is allowed for medical insurance premium under section 80D?", "80D", None),
    ("What deduction is allowed for a dependant with disability under section 80DD?", "80DD", None),
    ("What deduction is allowed for medical treatment of specified diseases under section 80DDB?", "80DDB", None),
    ("What deduction is allowed for interest on education loan under section 80E?", "80E", None),
    ("What is the deduction for interest on housing loan for first-time buyers under section 80EE?", "80EE", None),
    ("What is the deduction for donations to charitable institutions under section 80G?", "80G", None),
    ("What is the deduction for rent paid under section 80GG?", "80GG", None),
    ("What deduction is available for new employment under section 80JJAA?", "80JJAA", None),
    ("What is the deduction on interest on savings account under section 80TTA?", "80TTA", None),
    ("What is the deduction for senior citizens on deposits under section 80TTB?", "80TTB", None),
    ("What is the deduction for a person with disability under section 80U?", "80U", None),
    # --- Heads of income / computation ---
    ("What are the heads of income under section 14?", "14", None),
    ("What is the standard deduction from salary income under section 16?", "16", None),
    ("What is included in salary perquisites under section 17?", "17", None),
    ("How is annual value of house property determined under section 23?", "23", None),
    ("What deductions are allowed from house property income under section 24?", "24", None),
    ("What is charged as profits and gains of business or profession under section 28?", "28", None),
    ("How is depreciation on assets computed under section 32?", "32", None),
    ("What expenses are allowed under section 37 of the Income-tax Act?", "37", None),
    ("What disallowance applies to cash payments under section 40A?", "40A", None),
    ("What deductions are allowed only on actual payment under section 43B?", "43B", None),
    ("Who is required to get accounts audited under section 44AB?", "44AB", None),
    ("What is the presumptive taxation scheme for small businesses under section 44AD?", "44AD", "8"),
    ("What is the presumptive taxation scheme for professionals under section 44ADA?", "44ADA", "50"),
    ("How are capital gains charged under section 45?", "45", None),
    ("Which transactions are not regarded as transfer under section 47?", "47", None),
    ("How is capital gain computed under section 48?", "48", None),
    ("What is the exemption on capital gains from sale of a residential house under section 54?", "54", None),
    ("What is the capital gains exemption for investment in bonds under section 54EC?", "54EC", None),
    ("What is the exemption under section 54F for investment in a residential house?", "54F", None),
    ("What is taxed as income from other sources under section 56?", "56", None),
    # --- Exemptions / charge / residence ---
    ("On what income is income-tax charged under section 4?", "4", None),
    ("What is the scope of total income under section 5?", "5", None),
    ("How is residential status of an individual determined under section 6?", "6", None),
    ("What income is deemed to accrue or arise in India under section 9?", "9", None),
    ("Is agricultural income exempt and under which provision of section 10?", "10", None),
    ("What is the tax treatment of gratuity exemption under section 10?", "10", None),
    # --- Clubbing / set-off ---
    ("How is income of other persons clubbed under section 64?", "64", None),
    ("How is inter-head set-off of losses done under section 71?", "71", None),
    ("What losses can be carried forward and for how many years under section 72?", "72", None),
    ("How are speculation business losses treated under section 73?", "73", None),
    # --- TDS / TCS ---
    ("At what rate is tax deducted at source on salary under section 192?", "192", None),
    ("What is the TDS on interest other than interest on securities under section 194A?", "194A", None),
    ("What is the TDS on payments to contractors under section 194C?", "194C", None),
    ("What is the TDS on commission or brokerage under section 194H?", "194H", None),
    ("What is the rate of TDS on rent of plant and machinery under section 194-I?", "194-I", "2"),
    ("What is the TDS on transfer of immovable property under section 194-IA?", "194-IA", None),
    ("What is the TDS on fees for professional or technical services under section 194J?", "194J", None),
    ("What is the TDS on payments to non-residents under section 195?", "195", None),
    ("What is tax collected at source under section 206C?", "206C", None),
    # --- Returns / assessment / interest / penalty ---
    ("Who is required to furnish a return of income under section 139?", "139", None),
    ("How is assessment made under section 143?", "143", None),
    ("When can income escaping assessment be reassessed under section 147?", "147", None),
    ("What is rectification of mistake under section 154?", "154", None),
    ("What interest is charged for default in furnishing return under section 234A?", "234A", None),
    ("What interest is charged for default in payment of advance tax under section 234B?", "234B", None),
    ("What interest is charged for deferment of advance tax under section 234C?", "234C", None),
    ("What is the fee for default in furnishing return of income under section 234F?", "234F", None),
    ("What is the penalty for under-reporting of income under section 270A?", "270A", None),
    # --- Advance tax ---
    ("Who is liable to pay advance tax under section 208?", "208", None),
    ("What are the due dates and instalments of advance tax under section 211?", "211", None),
    # --- Rules ---
    ("How are perquisites valued under Rule 3 of the Income-tax Rules?", "3", None),
    ("How is house rent allowance exemption computed under Rule 2A?", "2A", None),
    ("How is disallowance under section 14A computed under Rule 8D?", "8D", None),
    ("What forms are prescribed for the return of income under Rule 12?", "12", None),
    # --- New Income-tax Act 2025 (version-specific concept) ---
    ("Under the Income-tax Act 2025, what is the scope of total income for a resident?", "5", None),
    # --- Out-of-corpus (must refuse) ---
    ("What is the GST rate on restaurant services?", None, None),
    ("What is the basic customs duty on imported cars?", None, None),
    ("What are the provisions of the Companies Act 2013 for board meetings?", None, None),
    ("What is the repo rate set by the RBI?", None, None),
    ("What is the capital of France?", None, None),
    ("Who won the 2018 FIFA World Cup?", None, None),
    ("What is the weather forecast for Mumbai tomorrow?", None, None),
    ("Can you write a Python function to sort a list?", None, None),
    ("What is the stamp duty on property registration in Karnataka?", None, None),
    ("How do I file a passport application in India?", None, None),
]


def main() -> None:
    store = rag_core.Store_singleton()
    n_inq = sum(1 for _, s, _ in TESTS if s is not None)
    n_ooc = len(TESTS) - n_inq
    n_fact = sum(1 for _, s, f in TESTS if s and f)
    ret_hit = top1 = grounded_inq = fact_hit = refused = false_ooc = 0
    ret_lat, llm_lat, detail = [], [], []

    for q, exp, fact in TESTS:
        t0 = time.time()
        passages = store.retrieve(q)
        ret_lat.append(time.time() - t0)

        def sec(p):
            r = p["row"]
            return (r.get("section_number") or r.get("rule_number") or "").upper()

        grounded = len(passages) > 0
        if exp is not None:
            hit = any(sec(p) == exp.upper() for p in passages)
            t1 = bool(passages) and sec(passages[0]) == exp.upper()
            ret_hit += hit; top1 += t1; grounded_inq += grounded
            ans = ""
            if grounded:
                t0 = time.time()
                try:
                    ans = rag_core.generate(q, passages); llm_lat.append(time.time() - t0)
                except Exception as e:
                    ans = f"[LLM ERROR {e}]"
            fh = bool(fact) and fact.replace(",", "") in ans.replace(",", "")
            fact_hit += fh
            detail.append(("IN", q, grounded, hit, t1, fh if fact else "-",
                           [sec(p) for p in passages[:3]]))
        else:
            if grounded: false_ooc += 1
            else: refused += 1
            detail.append(("OOC", q, grounded, "-", "-", "-", [sec(p) for p in passages[:3]]))

    print("=" * 80)
    for kind, q, g, hit, t1, fh, secs in detail:
        print(f"[{kind}] g={int(bool(g))} hit={hit} top1={t1} fact={fh}  {q[:50]:50} ret={secs}")
    print("=" * 80)
    print("METRICS")
    print(f"  in-corpus questions    : {n_inq}")
    print(f"  retrieval hit-rate     : {ret_hit}/{n_inq} = {ret_hit/n_inq*100:.0f}%")
    print(f"  top-1 hit-rate         : {top1}/{n_inq} = {top1/n_inq*100:.0f}%")
    print(f"  grounding (answerable) : {grounded_inq}/{n_inq} = {grounded_inq/n_inq*100:.0f}%")
    print(f"  key-fact present       : {fact_hit}/{n_fact} = {fact_hit/n_fact*100:.0f}%")
    print(f"  out-of-corpus refusals : {refused}/{n_ooc} = {refused/n_ooc*100:.0f}%")
    print(f"  false-answer on OOC    : {false_ooc}/{n_ooc}")
    print(f"  retrieve+rerank latency: median {st.median(ret_lat)*1000:.0f} ms")
    if llm_lat:
        print(f"  LLM generation latency : median {st.median(llm_lat)*1000:.0f} ms (max {max(llm_lat)*1000:.0f} ms)")


if __name__ == "__main__":
    main()
