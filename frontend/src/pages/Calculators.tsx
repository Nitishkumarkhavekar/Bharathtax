import { useState, type ReactNode } from "react";
import { Calculator, Info, IndianRupee, Percent } from "lucide-react";
import { api, WsInterestResult, WsBBEResult } from "../api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const inr = (n: number) => "₹" + new Intl.NumberFormat("en-IN").format(Math.round(n));
const todayISO = () => new Date().toISOString().slice(0, 10);

const INTEREST_SECTIONS = [
  { v: "234A", l: "Sec. 234A — default in furnishing return" },
  { v: "234B", l: "Sec. 234B — default in advance tax" },
  { v: "220(2)", l: "Sec. 220(2) — delay in paying demand" },
];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11.5px] font-semibold text-slate-500 uppercase tracking-[0.08em]">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function ResultRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between py-1.5", strong && "border-t border-slate-200 mt-1 pt-2")}>
      <span className={cn("text-[13px]", strong ? "font-bold text-slate-900" : "text-slate-600")}>{label}</span>
      <span className={cn("tabular-nums", strong ? "text-[15px] font-bold text-primary" : "text-[13px] font-semibold text-slate-800")}>{value}</span>
    </div>
  );
}

function InterestCalc() {
  const [section, setSection] = useState("234A");
  const [principal, setPrincipal] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState(todayISO());
  const [res, setRes] = useState<WsInterestResult | null>(null);

  const run = async () => {
    const p = parseFloat(principal);
    if (!p || p <= 0) { toast.error("Enter the principal amount."); return; }
    if (!from || !to) { toast.error("Pick both dates."); return; }
    if (to < from) { toast.error("End date must be on or after the start date."); return; }
    try {
      setRes(await api.wsCalcInterest({ section, principal: p, from_date: from, to_date: to }));
    } catch (e: any) { toast.error(e?.message || "Could not compute."); }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      <div className="space-y-3">
        <Field label="Provision">
          <select value={section} onChange={(e) => setSection(e.target.value)}
            className="w-full h-9 rounded-md border border-slate-200 bg-white px-2 text-[13px] text-slate-700">
            {INTEREST_SECTIONS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
          </select>
        </Field>
        <Field label="Principal (tax / demand)">
          <Input type="number" inputMode="numeric" placeholder="e.g. 100000"
            value={principal} onChange={(e) => setPrincipal(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <Button className="w-full" onClick={run}>Compute interest</Button>
        <p className="flex items-start gap-1 text-[11px] text-slate-500">
          <Info className="size-3.5 mt-px shrink-0" />
          1% per month or part of a month. A part-month counts as a full month.
        </p>
      </div>

      <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-4">
        {res ? (
          <>
            <div className="text-[11px] font-semibold text-primary uppercase tracking-[0.1em] mb-1">{res.section} interest</div>
            <ResultRow label="Principal" value={inr(res.principal)} />
            <ResultRow label="Period" value={`${res.months} month(s)`} />
            <ResultRow label="Rate" value={`${res.rate_pct_per_month}% / month`} />
            <ResultRow label="Interest" value={inr(res.interest)} />
            <ResultRow label="Total payable" value={inr(res.total_payable)} strong />
            <p className="mt-2 text-[11px] text-slate-500">{res.workings}</p>
          </>
        ) : (
          <div className="h-full flex items-center justify-center text-center text-[12.5px] text-slate-400 py-8">
            Enter the values and compute — the interest and workings appear here.
          </div>
        )}
      </div>
    </div>
  );
}

function Bbe115Calc() {
  const [income, setIncome] = useState("");
  const [res, setRes] = useState<WsBBEResult | null>(null);

  const run = async () => {
    const v = parseFloat(income);
    if (!v || v <= 0) { toast.error("Enter the unexplained income."); return; }
    try { setRes(await api.wsCalc115bbe(v)); }
    catch (e: any) { toast.error(e?.message || "Could not compute."); }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      <div className="space-y-3">
        <Field label="Unexplained income (Sec. 68 / 69 / 69A–D)">
          <Input type="number" inputMode="numeric" placeholder="e.g. 1000000"
            value={income} onChange={(e) => setIncome(e.target.value)} />
        </Field>
        <Button className="w-full" onClick={run}>Compute tax</Button>
        <p className="flex items-start gap-1 text-[11px] text-slate-500">
          <Info className="size-3.5 mt-px shrink-0" />
          60% tax + 25% surcharge + 4% cess. No deduction or set-off is allowed against such income.
        </p>
      </div>

      <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-4">
        {res ? (
          <>
            <div className="text-[11px] font-semibold text-primary uppercase tracking-[0.1em] mb-1">Sec. 115BBE tax</div>
            <ResultRow label="Income" value={inr(res.income)} />
            <ResultRow label={`Tax @ ${res.base_rate_pct}%`} value={inr(res.base_tax)} />
            <ResultRow label={`Surcharge @ ${res.surcharge_pct}%`} value={inr(res.surcharge)} />
            <ResultRow label={`Cess @ ${res.cess_pct}%`} value={inr(res.cess)} />
            <ResultRow label="Total tax" value={inr(res.total_tax)} strong />
            <div className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-slate-600">
              <Percent className="size-3.5" /> Effective rate: {res.effective_rate_pct}%
            </div>
          </>
        ) : (
          <div className="h-full flex items-center justify-center text-center text-[12.5px] text-slate-400 py-8">
            Enter the amount and compute — the tax breakdown appears here.
          </div>
        )}
      </div>
    </div>
  );
}

export default function Calculators() {
  const [tab, setTab] = useState<"interest" | "bbe">("interest");
  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center gap-3">
        <div className="size-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Calculator className="size-6" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900 leading-tight">Calculators</h1>
          <p className="text-[13px] text-slate-500">Statutory interest and special-rate tax — with the workings shown.</p>
        </div>
      </div>

      <div className="inline-flex rounded-lg bg-slate-100 p-1">
        {([["interest", "Interest"], ["bbe", "Tax u/s 115BBE"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={cn("px-3.5 py-1.5 rounded-md text-[13px] font-semibold transition-colors",
              tab === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}>
            {l}
          </button>
        ))}
      </div>

      <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-4 sm:p-5">
        {tab === "interest" ? <InterestCalc /> : <Bbe115Calc />}
      </div>

      <p className="flex items-start gap-1.5 text-[11.5px] text-slate-400">
        <IndianRupee className="size-3.5 mt-px shrink-0" />
        Estimates for working purposes — verify against the assessment before relying on a figure.
      </p>
    </div>
  );
}
