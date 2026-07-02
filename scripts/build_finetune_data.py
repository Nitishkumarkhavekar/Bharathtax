"""Distil captured feedback into a fine-tuning dataset (Layer 2 of the improvement
loop). Reads the interaction + verified logs and emits chat-format training pairs
from expert-approved / corrected answers.

  python build_finetune_data.py            # writes data/feedback/finetune_data.jsonl
Then (in a maintenance window, with vLLM paused) run a QLoRA fine-tune on the GPU
box using the unsloth env in /root/server_ai — see the note printed at the end.
Only run once enough verified examples have accumulated (hundreds+).
"""
from __future__ import annotations

import json
from pathlib import Path

FB = Path(__file__).resolve().parents[1] / "data" / "feedback"
SYSTEM = ("You are BharathTax, a professional Indian income-tax assistant. Answer accurately and "
          "concisely, cite sections where relevant, and never invent figures.")


def main() -> None:
    pairs: dict[str, str] = {}   # question -> gold answer (later entries win)

    # 1) explicit verified corrections / thumbs-up (highest quality)
    vf = FB / "verified.jsonl"
    if vf.exists():
        for line in vf.read_text(encoding="utf-8").splitlines():
            try:
                r = json.loads(line)
                if r.get("question") and r.get("answer"):
                    pairs[r["question"].strip()] = r["answer"].strip()
            except Exception:
                continue

    # 2) thumbs-up feedback recorded in the interaction log
    inter = FB / "interactions.jsonl"
    if inter.exists():
        for line in inter.read_text(encoding="utf-8").splitlines():
            try:
                r = json.loads(line)
            except Exception:
                continue
            if r.get("kind") == "feedback":
                gold = (r.get("correction") or "").strip() or \
                       ((r.get("answer") or "").strip() if r.get("rating") == "up" else "")
                if r.get("question") and gold:
                    pairs[r["question"].strip()] = gold

    out = FB / "finetune_data.jsonl"
    n = 0
    with open(out, "w", encoding="utf-8") as f:
        for q, a in pairs.items():
            if len(q) < 3 or len(a) < 3:
                continue
            f.write(json.dumps({"messages": [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": q},
                {"role": "assistant", "content": a}]}, ensure_ascii=False) + "\n")
            n += 1
    print(f"wrote {n} training examples -> {out}")
    print("\nNext (Layer 2, only when n is in the hundreds+, in a maintenance window):")
    print("  1) systemctl stop / docker stop the vLLM container to free GPU VRAM")
    print("  2) QLoRA fine-tune Meta-Llama-3.1-8B-Instruct on this jsonl using unsloth")
    print("     (/root/server_ai unsloth env) -> save the LoRA adapter")
    print("  3) serve the adapter with vLLM (--enable-lora --lora-modules) and point")
    print("     the gateway model at it; restart ml-server if it was stopped")


if __name__ == "__main__":
    main()
