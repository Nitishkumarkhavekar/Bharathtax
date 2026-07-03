"""Shared RAG core for the BharathTax chatbot — HYBRID retrieval + generation.

Mirrors the production design (backend/app/services/retrieval.py + rag.py):
  dense (bge-m3 cosine) + sparse (BM25 lexical) + exact-citation lookup
  -> union -> bge-reranker cross-encoder -> grounding gate (min_score)
  -> grounded prompt -> Llama (vLLM) -> answer + citations.

Used by rag_chat.py (interactive) and eval_rag.py (evaluation).
"""
from __future__ import annotations

import json
import re
import urllib.request
from datetime import date
from pathlib import Path

import numpy as np
from rank_bm25 import BM25Okapi

REPO = Path(__file__).resolve().parents[1]
DATA = REPO / "data/corpus_dataset"
ML = "http://127.0.0.1:8001"
LLM = "http://127.0.0.1:8002/v1"
LLM_MODEL = "llama-3.1-8b-instruct"

DENSE_K = 12
SPARSE_K = 12
MAX_CANDIDATES = 24          # cap union before the cross-encoder (GPU memory bound)
RERANK_K = 8
MIN_SCORE = 0.30
# Context packing: fill a total token budget with COMPLETE chunks (in rerank
# order) instead of truncating every chunk to a fixed char cap. Only the chunk
# that would overflow the budget is trimmed. Budget leaves room under the 6144
# context window for the system prompt, question, and the answer.
CONTEXT_TOKEN_BUDGET = 4000
GEN_MAX_TOKENS = 768         # enough to finish slab tables / step-by-step calculations
_CHARS_PER_TOKEN = 4         # cheap estimate for legal English (no per-chunk tokenize)
MAX_PASSAGE_CHARS = CONTEXT_TOKEN_BUDGET * _CHARS_PER_TOKEN  # single-chunk hard ceiling

SYSTEM_PROMPT = (
    "You are BharathTax, a warm, professional AI assistant specialising in Indian "
    "income-tax law. You help taxpayers and tax officers, from the most basic concepts "
    "to specific statutory provisions. Sound like a knowledgeable, polite human expert.\n\n"
    "How to respond:\n"
    "1. ANSWER DIRECTLY — NO PREAMBLE. For any real question, your VERY FIRST sentence must be "
    "the substantive answer itself. NEVER open with a self-introduction or pleasantry — do NOT "
    "begin with 'I'm BharathTax', 'your go-to expert', \"I'd be happy to help\", 'I must clarify', "
    "'However', 'Sure', 'Certainly', 'Thank you for your question', or any similar lead-in. Only "
    "when the message is a PURE greeting / small talk with no question ('hi', 'thanks', 'who are "
    "you') may you briefly introduce yourself and invite their question.\n"
    "2. UNDERSTAND MESSY INPUT: users make typos, use short forms, Hinglish, ALL CAPS or no "
    "punctuation. Infer the real intent and answer it (e.g. 'wat is incom tax'->what is income "
    "tax; 'salry'->salary; '80c'->section 80C; '80C ki limit kitni hai'->what is the 80C limit; "
    "'tds on salry rate'->the TDS rate on salary). Always reply in clear English. Do not ask "
    "the user to rephrase unless the message is truly empty of meaning.\n"
    "3. ANSWERING INCOME-TAX QUESTIONS:\n"
    "   - Use the numbered PASSAGES when relevant and cite inline as [1], [2]. Quote exact "
    "figures, rates, limits, dates and section numbers ONLY from the passages.\n"
    "   - For BASIC concepts (what is income tax / TDS / a deduction), give a SHORT, plain-language "
    "answer (2-3 sentences). If the retrieved sections are not directly about the concept, ignore "
    "them — do not quote, list, or cite tangential provisions just because they were retrieved.\n"
    "   - CITE SPECIFICS: when you state a specific figure, rate, limit, date or rule taken from a "
    "section, add an inline [n] citation so its source is shown. For general explanations or basic "
    "concepts, don't force a citation. Never cite a section that doesn't directly support the point.\n"
    "   - CORRECT MISTAKES ONLY WHEN THERE IS ONE: if the user states a wrong figure, rate, "
    "limit, section, date or misconception, gently correct it ('Just to clarify—') then give the "
    "right answer. But if the question is straightforward with NO wrong premise (e.g. 'what is the "
    "maximum deduction under 80C?'), just answer it directly and naturally — do NOT use 'Just to "
    "clarify', 'You're asking about', or any corrective/meta lead-in. Never contradict yourself.\n"
    "   - REGIME / YEAR: do NOT invent regime-specific (old vs new) or year-specific figures. "
    "State a regime/year distinction ONLY if a passage explicitly says so; otherwise just give the "
    "single figure the law provides (e.g. the 80C limit is simply Rs 1,50,000).\n"
    "4. NEVER FABRICATE:\n"
    "   - Do NOT invent the existence or text of a section, rule, or provision. If a section/rule "
    "the user names is not in the passages, or a SYSTEM NOTE says it was not found, tell the user "
    "you could not find that section and suggest they re-check the number — do NOT make up its "
    "contents, and do NOT silently substitute a different number.\n"
    "   - Do NOT invent year-wise changes, amendments, increases, case names, or assessment years "
    "that are not in the passages.\n"
    "5. OFF-TOPIC (weather, sports, other countries, coding, etc.): politely say you focus on "
    "Indian income-tax matters and offer to help with that.\n"
    "6. FORMATTING: write in plain text with short paragraphs or simple '- ' bullet points. Do NOT "
    "use Markdown tables or the '|' (pipe) character anywhere. Always finish your answer fully — "
    "never stop mid-sentence or leave a dangling symbol, dash, or pipe on a line.\n"
    "7. TAX CALCULATIONS (e.g. 'how much tax on 8.5 lakh'): give ONE consistent set of slab rates "
    "from the retrieved current law and clearly state the regime and year you are using (the new "
    "regime under the Income-tax Act, 2025 is the default). Compute tier by tier (tax applies only "
    "to the part of income within each slab), keep the arithmetic correct, then note 4% health & "
    "education cess and mention the section 87A rebate, which can reduce or fully remove the tax for "
    "lower incomes. If you are not certain of the exact current figures, explain the method and "
    "advise the user to confirm — do not state a precise number you are unsure of.\n\n"
    "Tone: talk like a friendly, knowledgeable human expert having a conversation — warm, natural "
    "and easy to read, NOT stiff, robotic or textbook-like. Lead straight with the answer in a "
    "natural sentence, use everyday words, and keep it concise (usually 1-4 sentences). Avoid "
    "formulaic openers ('Just to clarify', 'You're asking about', 'According to the provided...'). "
    "Never mention 'passages', 'context' or 'system note'; just answer naturally."
)

# Greetings / small talk -> answer conversationally, skip retrieval.
_SMALLTALK = re.compile(
    r"^\s*(hi|hii+|hey+|hello|hlo|yo|namaste|namaskar|greetings|"
    r"good\s*(morning|afternoon|evening|day)|"
    r"thanks?|thank\s*you|thx|ok(ay)?|cool|nice|great|"
    r"how\s*(are|r)\s*(you|u)|how'?s\s*it\s*going|what'?s\s*up|wassup|"
    r"who\s*(are|r)\s*(you|u)|what\s*(can|do)\s*you\s*do|what\s*are\s*you|"
    r"bye|good\s*bye|see\s*you|tata)"
    r"[\s!.,?]*$", re.I)


def is_smalltalk(text: str) -> bool:
    return bool(_SMALLTALK.match(text.strip()))


# --- Deterministic income-tax calculator (the LLM cannot do slab arithmetic reliably) ---
# New regime, resident individual, Income-tax Act 2025 / current year (the default regime).
_NEW_REGIME_SLABS = [(400000, 0.0), (800000, 0.05), (1200000, 0.10),
                     (1600000, 0.15), (2000000, 0.20), (2400000, 0.25), (float("inf"), 0.30)]
_REBATE_87A_LIMIT = 1200000        # new regime: total income up to 12L -> tax rebated to nil
_CESS = 0.04
_CALC_INTENT = re.compile(r"\b(how\s*much\s*(tax|income\s*tax)|tax\s*(on|for|do i|would i|will i)|"
                          r"pay\s*(as|in)?\s*(income\s*)?tax|calculate\s*(my)?\s*tax|tax\s*liability)\b", re.I)
_INCOME_AMT = re.compile(r"(\d+(?:\.\d+)?)\s*(crore|cr|lakh|lakhs|lac|lacs|l\b)|"
                         r"(?:rs\.?|inr|₹)\s*([\d,]{5,})", re.I)


def _parse_income(q: str):
    m = _INCOME_AMT.search(q)
    if not m:
        return None
    if m.group(1):
        val = float(m.group(1)); unit = (m.group(2) or "").lower()
        return val * (1e7 if unit in ("crore", "cr") else 1e5)
    try:
        return float(m.group(3).replace(",", ""))
    except (TypeError, ValueError):
        return None


def compute_new_regime_tax(income: float) -> dict:
    tax, prev, steps = 0.0, 0.0, []
    for cap, rate in _NEW_REGIME_SLABS:
        if income <= prev:
            break
        amt = min(income, cap) - prev
        if rate > 0:
            steps.append((prev, min(income, cap), rate, amt * rate))
        tax += amt * rate
        prev = cap
    rebate = tax if income <= _REBATE_87A_LIMIT else 0.0
    after = tax - rebate
    cess = round(after * _CESS)
    return {"income": income, "slab_tax": round(tax), "rebate": round(rebate),
            "after": round(after), "cess": cess, "total": round(after) + cess, "steps": steps}


def _calc_answer(income: float) -> str:
    """Fully-formatted, correct answer for a tax-computation question. Returned
    verbatim (NOT through the LLM, which mis-transcribes the arithmetic)."""
    r = compute_new_regime_tax(income)
    steps = "\n".join(f"• Rs {a:,.0f} to Rs {b:,.0f} @ {int(rt*100)}% = Rs {t:,.0f}"
                      for a, b, rt, t in r["steps"]) or "• Your entire income falls in the 0% slab."
    out = [f"For a total income of Rs {income:,.0f}, under the new tax regime (the default under the "
           "Income-tax Act, 2025) and assuming no deductions, the tax works out as follows:", "", steps, "",
           f"Tax as per slabs: Rs {r['slab_tax']:,.0f}"]
    if r["rebate"]:
        out.append(f"Less Section 87A rebate (income up to Rs 12,00,000 is fully rebated): Rs {r['rebate']:,.0f}")
        out.append(f"Tax after rebate: Rs {r['after']:,.0f}")
    out.append(f"Add 4% health & education cess: Rs {r['cess']:,.0f}")
    out.append("")
    out.append(f"Total income tax payable: Rs {r['total']:,.0f}" + (" — i.e. Nil." if r["total"] == 0 else "."))
    out.append("")
    out.append("Note: this is under the new regime before any deductions. The old regime has different "
               "slabs but allows deductions, so your actual liability can differ — do confirm for your "
               "exact situation.")
    return "\n".join(out)
REFUSAL = (
    "I could not find this in the available primary sources (Income Tax Act, "
    "Rules, and the ingested CBDT circulars/notifications). I will not answer "
    "from outside that material. Try rephrasing, or widen the corpus."
)

_WORD = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)?")
# Distinguish "section 80C / u/s 194-I" from "rule 2A" so a bare number like "3"
# doesn't match both section 3 AND rule 3.
_CITE_SEC = re.compile(r"\b(?:section|sec\.?|u/s)\s+(\d{1,3}(?:-?[a-z]{1,4})?)\b", re.I)
_CITE_RULE = re.compile(r"\brule\s+(\d{1,3}(?:-?[a-z]{1,4})?)\b", re.I)
EXACT_K = 4        # exact-citation is a safety net, not a flood — cap it
CITE_BOOST = 1.0   # rerank boost for a passage whose section/rule the query names


def _post(url, payload, timeout=180):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        return json.load(urllib.request.urlopen(req, timeout=timeout))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code}: {e.read().decode()[:200]}") from None


def _tok(s: str) -> list[str]:
    return _WORD.findall(s.lower())


class Store:
    def __init__(self) -> None:
        self.rows = [json.loads(l) for l in (DATA / "chunks.jsonl").read_text().splitlines()]
        embs = np.load(DATA / "embeddings.npy")
        self.embs = embs / (np.linalg.norm(embs, axis=1, keepdims=True) + 1e-9)
        self.bm25 = BM25Okapi([_tok(r["text"]) for r in self.rows])
        # number -> row indices, kept SEPARATE for section vs rule exact-citation.
        self.by_sec: dict[str, list[int]] = {}
        self.by_rule: dict[str, list[int]] = {}
        for i, r in enumerate(self.rows):
            if r.get("section_number"):
                self.by_sec.setdefault(r["section_number"].upper(), []).append(i)
            if r.get("rule_number"):
                self.by_rule.setdefault(r["rule_number"].upper(), []).append(i)

    def cited_missing(self, query: str) -> list[str]:
        """Section/rule numbers the user explicitly named that do NOT exist in the
        corpus — so the model can say 'not found' instead of fabricating them."""
        miss = []
        for m in _CITE_SEC.finditer(query):
            if m.group(1).upper() not in self.by_sec:
                miss.append(f"section {m.group(1)}")
        for m in _CITE_RULE.finditer(query):
            if m.group(1).upper() not in self.by_rule:
                miss.append(f"rule {m.group(1)}")
        return miss

    def _filter(self, version: str | None, source: str | None) -> np.ndarray:
        idx = np.arange(len(self.rows))
        if version:
            idx = np.array([i for i in idx if str(self.rows[i].get("version")) == str(version)])
        if source:
            idx = np.array([i for i in idx if self.rows[i]["source_key"] == source])
        return idx

    def retrieve(self, query: str, *, version=None, source=None, query_emb=None) -> list[dict]:
        idx = self._filter(version, source)
        allow = set(int(i) for i in idx)

        # dense (reuse a precomputed embedding when available)
        if query_emb is None:
            query_emb = _post(ML + "/embed", {"texts": [query]})["embeddings"][0]
        q = np.asarray(query_emb, dtype=np.float32)
        q /= (np.linalg.norm(q) + 1e-9)
        sims = self.embs @ q
        dense = [i for i in np.argsort(-sims) if int(i) in allow][:DENSE_K]

        # sparse (BM25)
        bm = self.bm25.get_scores(_tok(query))
        sparse = [i for i in np.argsort(-bm) if int(i) in allow][:SPARSE_K]

        # exact-citation: "section N" -> by_sec, "rule N" -> by_rule. Capped (EXACT_K)
        # so a named provision is guaranteed present without flooding the candidates.
        exact: list[int] = []
        target_sec: set[str] = set()
        target_rule: set[str] = set()
        for m in _CITE_SEC.finditer(query):
            target_sec.add(m.group(1).upper())
            exact += [i for i in self.by_sec.get(m.group(1).upper(), []) if i in allow]
        for m in _CITE_RULE.finditer(query):
            target_rule.add(m.group(1).upper())
            exact += [i for i in self.by_rule.get(m.group(1).upper(), []) if i in allow]
        exact = list(dict.fromkeys(exact))[:EXACT_K]

        # exact (capped) first as a safety net, then dense, then sparse; dedup + cap.
        cand = list(dict.fromkeys([int(i) for i in exact] +
                                  [int(i) for i in dense] + [int(i) for i in sparse]))
        cand = cand[:MAX_CANDIDATES]
        if not cand:
            return []
        # rerank (cross-encoder)
        rr = _post(ML + "/rerank", {"query": query, "passages": [self.rows[i]["text"] for i in cand]})["results"]

        def is_target(row) -> bool:
            return ((row.get("section_number") or "").upper() in target_sec
                    or (row.get("rule_number") or "").upper() in target_rule)

        # Keep passages above the grounding threshold OR explicitly cited by number.
        # Sort by a boosted score so the exact-cited provision floats to #1.
        scored = []
        for r in rr:
            idx = cand[r["index"]]
            row = self.rows[idx]
            tgt = is_target(row)
            if r["score"] >= MIN_SCORE or tgt:
                scored.append((idx, r["score"], r["score"] + (CITE_BOOST if tgt else 0.0)))
        scored.sort(key=lambda x: x[2], reverse=True)
        kept = scored[:RERANK_K]
        return [{"row": self.rows[i], "score": s, "idx": i} for i, s, _ in kept]


def pack_passages(passages: list[dict]) -> list[dict]:
    """Fill CONTEXT_TOKEN_BUDGET with COMPLETE chunks in rerank order; only the
    chunk that would overflow the budget is trimmed. Returns dicts with the text
    actually sent and whether it was truncated."""
    budget = CONTEXT_TOKEN_BUDGET
    used = 0.0
    packed: list[dict] = []
    for p in passages:
        full = p["row"]["text"]
        ftok = len(full) / _CHARS_PER_TOKEN
        if used + ftok <= budget:
            packed.append({**p, "sent_text": full, "truncated": False})
            used += ftok
        else:
            remaining = budget - used
            if remaining >= 60:                       # room for a meaningful partial
                cut = int(remaining * _CHARS_PER_TOKEN)
                packed.append({**p, "sent_text": full[:cut], "truncated": True})
            break                                     # budget exhausted
    return packed


def _passages_block(passages: list[dict]) -> str:
    if not passages:
        return ""
    packed = pack_passages(passages)
    blocks = [f"[{n}] ({p['row']['breadcrumb']})\n{p['sent_text']}"
              for n, p in enumerate(packed, 1)]
    return ("\n\nRelevant passages from primary tax law (cite as [n] when used):\n"
            + "\n\n".join(blocks))


def generate(question: str, passages: list[dict] | None = None,
             history: list[dict] | None = None, note: str = "",
             fewshot: list[dict] | None = None) -> str:
    """Generate a conversational, professional answer. `passages` may be empty
    (greetings / basic concepts). `history` is prior chat turns (no system role).
    `note` is an out-of-band instruction injected for this turn. `fewshot` are
    verified (question, answer) examples from past accepted/corrected answers,
    injected as prior turns so the model learns from them (continuous improvement)."""
    note_block = f"\n\n[SYSTEM NOTE: {note}]" if note else ""
    # Verified memory: inject the closest expert-approved answer as authoritative
    # guidance in THIS turn, so its facts compete with (and augment) the passages.
    ver_block = ""
    if fewshot:
        top = fewshot[0]
        ver_block = ("\n\n[EXPERT-VERIFIED ANSWER to a nearly identical question — treat these facts "
                     "and figures as authoritative and make sure your answer reflects them:\n"
                     + top.get("answer", "") + "]")
    user_content = question + note_block + ver_block + _passages_block(passages or [])
    _dated_system = SYSTEM_PROMPT + (
        f"\n\nToday's date is {date.today().strftime('%d %B %Y')}. Use it when the user asks about "
        "'this year', 'the current year', 'the latest', a deadline, or the current assessment year — "
        "but do NOT invent year-specific figures that are not in the passages."
    )
    messages = [{"role": "system", "content": _dated_system}]
    for m in (history or []):
        if m.get("role") in ("user", "assistant") and m.get("content"):
            messages.append({"role": m["role"], "content": m["content"]})
    messages.append({"role": "user", "content": user_content})
    out = _post(LLM + "/chat/completions", {
        "model": LLM_MODEL, "temperature": 0.2, "max_tokens": GEN_MAX_TOKENS,
        "messages": messages})
    text = out["choices"][0]["message"]["content"]
    # Safety net: drop any trailing line that is only separators/symbols (stray "|", "-", "—")
    text = re.sub(r"(?:\n[ \t]*[|\-—*_:]+[ \t]*)+\s*$", "", text)
    return text.strip()


def complete(system: str, user: str, *, max_tokens: int = 1024, temperature: float = 0.2) -> str:
    """Low-level single-shot completion against the raw LLM (no RAG). Reused by the
    appeal-order drafter and other instruction-following tasks."""
    out = _post(LLM + "/chat/completions", {
        "model": LLM_MODEL, "temperature": temperature, "max_tokens": max_tokens,
        "messages": [{"role": "system", "content": system},
                     {"role": "user", "content": user}]})
    return out["choices"][0]["message"]["content"].strip()


def answer(question: str, *, version=None, source=None, history=None) -> dict:
    # Greetings / small talk: reply conversationally, no retrieval.
    if is_smalltalk(question):
        return {"grounded": False, "text": generate(question, [], history), "passages": []}
    # Otherwise retrieve; the model answers grounded if passages are relevant,
    # gives a helpful general answer for basics, and politely redirects off-topic.
    # Tax-computation questions: compute deterministically and return verbatim — the LLM
    # cannot be trusted with slab arithmetic, so it never sees/rewrites these numbers.
    if _CALC_INTENT.search(question):
        inc = _parse_income(question)
        if inc:
            return {"grounded": True, "text": _calc_answer(inc), "passages": []}
    store = Store_singleton()
    qemb = _post(ML + "/embed", {"texts": [question]})["embeddings"][0]   # embed once
    fewshot = Verified_singleton().similar(qemb)                          # learn from past accepted answers
    passages = store.retrieve(question, version=version, source=source, query_emb=qemb)
    missing = store.cited_missing(question)
    note = ""
    if missing:
        note = ("The user referred to " + ", ".join(missing) + ", which could NOT be found "
                "in the Income-tax Act or Rules. Tell them you could not find that and ask them "
                "to re-check the number; do not invent its contents or substitute another number.")
    text = generate(question, passages, history, note=note, fewshot=fewshot)
    return {"grounded": bool(passages), "text": text, "passages": passages}


_STORE: Store | None = None


def Store_singleton() -> Store:
    global _STORE
    if _STORE is None:
        _STORE = Store()
    return _STORE


# --- Verified-example memory (continuous improvement) -------------------------
# Accepted / corrected answers are stored with their embeddings; at answer time we
# retrieve the most similar ones and feed them as few-shot examples. The model gets
# more accurate as verified feedback accumulates — no retraining required.
VERIFIED_PATH = DATA.parent / "feedback" / "verified.jsonl"
FEWSHOT_K = 2
FEWSHOT_MIN_SIM = 0.82


class VerifiedStore:
    def __init__(self) -> None:
        self.rows: list[dict] = []
        self.embs = np.zeros((0, 1024), dtype=np.float32)
        if VERIFIED_PATH.exists():
            rows, embs = [], []
            for line in VERIFIED_PATH.read_text(encoding="utf-8").splitlines():
                try:
                    r = json.loads(line)
                    if r.get("question") and r.get("answer") and r.get("emb"):
                        rows.append({"question": r["question"], "answer": r["answer"]})
                        embs.append(r["emb"])
                except Exception:
                    continue
            self.rows = rows
            if embs:
                e = np.asarray(embs, dtype=np.float32)
                self.embs = e / (np.linalg.norm(e, axis=1, keepdims=True) + 1e-9)

    def similar(self, query_emb, k: int = FEWSHOT_K, min_sim: float = FEWSHOT_MIN_SIM) -> list[dict]:
        if not self.rows:
            return []
        q = np.asarray(query_emb, dtype=np.float32)
        q /= (np.linalg.norm(q) + 1e-9)
        sims = self.embs @ q
        order = np.argsort(-sims)[:k]
        return [self.rows[i] for i in order if sims[i] >= min_sim]

    def add(self, question: str, answer: str, emb) -> None:
        e = np.asarray(emb, dtype=np.float32)
        e /= (np.linalg.norm(e) + 1e-9)
        self.rows.append({"question": question, "answer": answer})
        self.embs = np.vstack([self.embs, e[None, :]])
        VERIFIED_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(VERIFIED_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps({"question": question, "answer": answer,
                                "emb": [round(float(x), 6) for x in e]}, ensure_ascii=False) + "\n")


_VERIFIED: VerifiedStore | None = None


def Verified_singleton() -> VerifiedStore:
    global _VERIFIED
    if _VERIFIED is None:
        _VERIFIED = VerifiedStore()
    return _VERIFIED


def add_verified(question: str, answer: str) -> bool:
    """Record a verified (accepted or corrected) answer into the learning memory."""
    q, a = (question or "").strip(), (answer or "").strip()
    if not q or not a:
        return False
    emb = _post(ML + "/embed", {"texts": [q]})["embeddings"][0]
    Verified_singleton().add(q, a, emb)
    return True
