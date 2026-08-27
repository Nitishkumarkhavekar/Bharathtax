import { useEffect, useRef, useState, type ReactNode } from "react";
import { Scale, Play, CheckCircle2, AlertTriangle, ArrowLeftRight, Flag, Search, Upload } from "lucide-react";
import { api, WsReconResult, WsSftResult, WsSftThreshold } from "../api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import PageHelp from "@/components/PageHelp";

const inr = (n: number) => "₹" + new Intl.NumberFormat("en-IN").format(Math.round(n));

function parseRows(text: string): { key: string; name?: string; amount: number }[] {
  const rows: { key: string; name?: string; amount: number }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // Amount is the trailing number — may carry thousands separators / decimals
    // ("45,000.50"). Parse it from the right so commas inside it don't split.
    const m = line.match(/(-?[\d,]*\.?\d+)\s*$/);
    if (!m || m.index === undefined) continue;
    const amount = parseFloat(m[1].replace(/,/g, ""));
    if (isNaN(amount)) continue;
    const rest = line.slice(0, m.index).replace(/[,\s]+$/, "");
    const restParts = rest.split(",").map((s) => s.trim()).filter(Boolean);
    if (restParts.length === 0) continue;                 // need at least a key
    rows.push({ key: restParts[0], name: restParts.slice(1).join(", "), amount });
  }
  return rows;
}

const PLACEHOLDER = "One entry per line:  TAN, Deductor name, Amount\nBLRA00123A, ACME Ltd, 45000\nMUMB00456B, Beta Corp, 12000";

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={cn("px-3 py-2 rounded-xl ring-1 text-center", tone)}>
      <div className="text-lg font-bold leading-none tabular-nums">{value}</div>
      <div className="text-[9.5px] font-semibold uppercase tracking-wide mt-0.5 opacity-80">{label}</div>
    </div>
  );
}

export default function Reconcile() {
  const [mode, setMode] = useState<"reconcile" | "sft">("reconcile");

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="size-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Scale className="size-6" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-slate-900 leading-tight">Reconciliation & SFT scan</h1>
          <p className="text-[13px] text-slate-500">AIS / 26AS matching, and a Rule 114E high-value transaction scan.</p>
        </div>
        <PageHelp id="reconcile" className="ml-auto shrink-0" />
      </div>

      <div className="inline-flex rounded-lg bg-slate-100 p-1">
        {([["reconcile", "Reconcile"], ["sft", "SFT / AIS scan"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setMode(k)}
            className={cn("px-3.5 py-1.5 rounded-md text-[13px] font-semibold transition-colors", mode === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}>{l}</button>
        ))}
      </div>

      {mode === "reconcile" ? <ReconcileMode /> : <SftMode />}
    </div>
  );
}

function ReconcileMode() {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [tol, setTol] = useState("1");
  const [res, setRes] = useState<WsReconResult | null>(null);

  const run = async () => {
    const ra = parseRows(a), rb = parseRows(b);
    if (ra.length === 0 || rb.length === 0) { toast.error("Enter entries in both columns (key, name, amount)."); return; }
    try { setRes(await api.wsReconcile(ra, rb, parseFloat(tol) || 0)); }
    catch (e: any) { toast.error(e?.message || "Could not reconcile."); }
  };

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[["Source A — 26AS / Form 16", a, setA], ["Source B — AIS / Books", b, setB]].map(([label, val, set]: any) => (
          <div key={label} className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-3">
            <div className="text-[12px] font-semibold text-slate-600 mb-2 px-1">{label}</div>
            <textarea value={val} onChange={(e) => set(e.target.value)} placeholder={PLACEHOLDER} rows={10}
              className="w-full resize-y rounded-lg border border-slate-200 bg-white p-3 text-[12.5px] font-mono text-slate-800 outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <label className="text-[12px] text-slate-500 flex items-center gap-2">
          Tolerance (₹)
          <Input type="number" className="w-24 h-9" value={tol} onChange={(e) => setTol(e.target.value)} />
        </label>
        <Button className="ml-auto" onClick={run}><Play className="size-4 mr-1" /> Reconcile</Button>
      </div>

      {res && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Matched" value={res.summary.matched_count} tone="bg-emerald-50 text-emerald-700 ring-emerald-200" />
            <Stat label="Amount mismatch" value={res.summary.mismatch_count} tone="bg-amber-50 text-amber-700 ring-amber-200" />
            <Stat label="Only in 26AS" value={res.summary.only_a_count} tone="bg-blue-50 text-blue-700 ring-blue-200" />
            <Stat label="Only in AIS" value={res.summary.only_b_count} tone="bg-rose-50 text-rose-700 ring-rose-200" />
          </div>
          <div className="text-[12px] text-slate-500 flex flex-wrap gap-x-4">
            <span>Total A: <strong className="text-slate-800">{inr(res.summary.total_a)}</strong></span>
            <span>Total B: <strong className="text-slate-800">{inr(res.summary.total_b)}</strong></span>
            <span>Difference: <strong className="text-slate-800">{inr(res.summary.total_a - res.summary.total_b)}</strong></span>
          </div>

          {res.amount_mismatch.length > 0 && (
            <Section title="Amount mismatches" icon={<AlertTriangle className="size-4 text-amber-600" />}>
              {res.amount_mismatch.map((r, i) => (
                <div key={i} className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0 text-[13px]">
                  <div className="min-w-0 flex-1"><span className="font-semibold text-slate-800">{r.key}</span> <span className="text-slate-500">{r.name}</span></div>
                  <span className="tabular-nums text-slate-600">{inr(r.amount_a)} vs {inr(r.amount_b)}</span>
                  <span className="tabular-nums font-bold text-amber-700 w-24 text-right">{inr(r.diff)}</span>
                </div>
              ))}
            </Section>
          )}
          {res.only_in_a.length > 0 && (
            <Section title="Only in 26AS" icon={<ArrowLeftRight className="size-4 text-blue-600" />}>
              {res.only_in_a.map((r, i) => <OnlyRow key={i} k={r.key} name={r.name} amount={r.amount} />)}
            </Section>
          )}
          {res.only_in_b.length > 0 && (
            <Section title="Only in AIS" icon={<ArrowLeftRight className="size-4 text-rose-600" />}>
              {res.only_in_b.map((r, i) => <OnlyRow key={i} k={r.key} name={r.name} amount={r.amount} />)}
            </Section>
          )}
          {res.matched.length > 0 && (
            <Section title="Matched" icon={<CheckCircle2 className="size-4 text-emerald-600" />}>
              {res.matched.map((r, i) => (
                <div key={i} className="flex items-center gap-3 py-1.5 border-b border-slate-100 last:border-0 text-[13px]">
                  <div className="min-w-0 flex-1"><span className="font-semibold text-slate-800">{r.key}</span> <span className="text-slate-500">{r.name}</span></div>
                  <span className="tabular-nums text-slate-700">{inr(r.amount_a)}</span>
                </div>
              ))}
            </Section>
          )}
        </div>
      )}
    </>
  );
}

// --- SFT / AIS high-value scan ---
function parseSftRows(text: string): { pan: string; name: string; category: string; amount: number }[] {
  const rows: { pan: string; name: string; category: string; amount: number }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/(-?[\d,]*\.?\d+)\s*$/);
    if (!m || m.index === undefined) continue;
    const amount = parseFloat(m[1].replace(/,/g, ""));
    if (isNaN(amount)) continue;
    const rest = line.slice(0, m.index).replace(/[,\s]+$/, "");
    // Fields: PAN, Name, Category. The NAME may itself contain commas (and may
    // be quoted), so anchor PAN as the FIRST field and Category as the LAST,
    // with everything between as the name — otherwise a "Kumar, Sons" name
    // would shift the category and the row would never flag. Strip stray quotes.
    const parts = rest.split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
    if (!parts[0]) continue;
    let pan: string, name: string, category: string;
    if (parts.length >= 3) {
      pan = parts[0];
      category = parts[parts.length - 1];
      name = parts.slice(1, -1).join(", ");
    } else if (parts.length === 2) {
      pan = parts[0]; name = parts[1]; category = "other";
    } else {
      pan = parts[0]; name = ""; category = "other";
    }
    rows.push({ pan, name, category: (category || "other").toLowerCase().replace(/\s+/g, "_"), amount });
  }
  return rows;
}

const SFT_PLACEHOLDER = "One row per line:  PAN, Name, Category, Amount\nAAAPL1234C, Ravi Kumar, cash_deposit_sb, 600000\nAAAPL1234C, Ravi Kumar, cash_deposit_sb, 700000\nBBBPL5678D, Sita Devi, immovable_property, 2500000";

// Strip a header row (e.g. "PAN,Name,Category,Amount") from pasted/uploaded CSV
// text; the row parser (amount-from-the-right, comma-tolerant) handles the rest.
function stripSftHeader(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const first = lines[0] ?? "";
  const firstField = (first.split(/[,;]/)[0] || "").trim().toLowerCase();
  // A real header either starts with a "PAN" column, or carries a header keyword
  // and doesn't end in a figure (a data row always ends in the amount).
  const isHeader = firstField === "pan" ||
    (/\bpan\b|amount|category/i.test(first) && !/\d\s*$/.test(first.trim()));
  if (lines.length && isHeader) lines.shift();
  return lines.join("\n");
}

function SftMode() {
  const [text, setText] = useState("");
  const [cats, setCats] = useState<WsSftThreshold[]>([]);
  const [res, setRes] = useState<WsSftResult | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { api.wsSftThresholds().then(setCats).catch(() => {}); }, []);

  const onFile = async (f: File | null) => {
    if (!f) return;
    try {
      const raw = await f.text();
      const cleaned = stripSftHeader(raw);
      setText(cleaned);
      const n = parseSftRows(cleaned).length;
      toast.success(`Loaded ${n} row${n === 1 ? "" : "s"} from ${f.name}.`);
    } catch {
      toast.error("Could not read that file.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const run = async () => {
    const rows = parseSftRows(text);
    if (!rows.length) { toast.error("Paste rows or upload a CSV (PAN, Name, Category, Amount)."); return; }
    try { setRes(await api.wsSftAnalyze(rows)); }
    catch (e: any) { toast.error(e?.message || "Could not analyse."); }
  };

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4 items-start">
        <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-3">
          <div className="flex items-center justify-between mb-2 px-1">
            <div className="text-[12px] font-semibold text-slate-600">AIS / SFT rows</div>
            <button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline">
              <Upload className="size-3.5" /> Upload CSV
            </button>
            <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" hidden onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
          </div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={SFT_PLACEHOLDER} rows={12}
            className="w-full resize-y rounded-lg border border-slate-200 bg-white p-3 text-[12.5px] font-mono text-slate-800 outline-none focus:ring-2 focus:ring-primary/20" />
        </div>
        <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-3">
          <div className="text-[12px] font-semibold text-slate-600 mb-2 px-1">SFT categories (Rule 114E)</div>
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {cats.map((c) => (
              <div key={c.key} className="text-[11px] leading-tight">
                <code className="text-primary">{c.key}</code>
                <div className="text-slate-500">{c.label} — ≥ {inr(c.threshold)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center">
        <Button className="ml-auto" onClick={run}><Search className="size-4 mr-1" /> Scan high-value</Button>
      </div>

      {res && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Persons" value={res.summary.persons} tone="bg-blue-50 text-blue-700 ring-blue-200" />
            <Stat label="Flagged" value={res.summary.flagged} tone="bg-rose-50 text-rose-700 ring-rose-200" />
            <Stat label="Transactions" value={res.summary.transactions} tone="bg-slate-50 text-slate-700 ring-slate-200" />
            <div className="px-3 py-2 rounded-xl ring-1 text-center bg-emerald-50 text-emerald-700 ring-emerald-200">
              <div className="text-base font-bold leading-none tabular-nums">{inr(res.summary.grand_total)}</div>
              <div className="text-[9.5px] font-semibold uppercase tracking-wide mt-0.5 opacity-80">Total value</div>
            </div>
          </div>
          <Section title="Persons by value (flagged first)" icon={<Flag className="size-4 text-rose-600" />}>
            {res.people.map((p, i) => (
              <div key={i} className="py-2 border-b border-slate-100 last:border-0">
                <div className="flex items-center gap-3 text-[13px]">
                  <div className="min-w-0 flex-1">
                    <span className="font-semibold text-slate-800 font-mono">{p.pan}</span> <span className="text-slate-500">{p.name}</span>
                  </div>
                  <span className="text-[11px] text-slate-400">{p.count} txn</span>
                  <span className="tabular-nums font-semibold text-slate-800 w-28 text-right">{inr(p.total)}</span>
                  {p.flagged
                    ? <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-rose-50 text-rose-700 ring-1 ring-rose-200 px-2 py-0.5 text-[10.5px] font-semibold"><Flag className="size-3" /> Flag</span>
                    : <span className="shrink-0 inline-flex items-center rounded-full bg-slate-100 text-slate-500 px-2 py-0.5 text-[10.5px] font-semibold">OK</span>}
                </div>
                {p.flags.length > 0 && (
                  <div className="mt-1 pl-1 flex flex-wrap gap-1.5">
                    {p.flags.map((f, j) => (
                      <span key={j} className="text-[10.5px] rounded bg-amber-50 text-amber-800 ring-1 ring-amber-200 px-1.5 py-0.5">{f.label}: {inr(f.amount)} (≥ {inr(f.threshold)})</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </Section>
          <p className="text-[11px] text-slate-400">{res.note}</p>
        </div>
      )}
    </>
  );
}

function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-4">
      <div className="flex items-center gap-1.5 mb-2 text-[13px] font-bold text-slate-900">{icon} {title}</div>
      {children}
    </div>
  );
}
function OnlyRow({ k, name, amount }: { k: string; name: string; amount: number }) {
  return (
    <div className="flex items-center gap-3 py-1.5 border-b border-slate-100 last:border-0 text-[13px]">
      <div className="min-w-0 flex-1"><span className="font-semibold text-slate-800">{k}</span> <span className="text-slate-500">{name}</span></div>
      <span className="tabular-nums text-slate-700">{inr(amount)}</span>
    </div>
  );
}
