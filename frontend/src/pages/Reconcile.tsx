import { useState, type ReactNode } from "react";
import { Scale, Play, CheckCircle2, AlertTriangle, ArrowLeftRight } from "lucide-react";
import { api, WsReconResult } from "../api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

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
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="size-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Scale className="size-6" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-slate-900 leading-tight">Reconciliation</h1>
          <p className="text-[13px] text-slate-500">AIS / 26AS-style matching — paste two entry sets and flag the genuine mismatches.</p>
        </div>
      </div>

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
    </div>
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
