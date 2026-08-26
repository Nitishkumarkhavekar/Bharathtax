import { useEffect, useState, type ReactNode } from "react";
import { Calculator, Info, IndianRupee, Percent, RotateCcw } from "lucide-react";
import { api, WsInterestResult, WsBBEResult, Ws234CResult, WsSlabResult, WsCapGainsResult, WsPenaltyResult, WsTdsResult, WsTdsSection, WsInstallmentResult, WsTrust11Result, Ws115BBCResult, WsPeakCreditResult, WsAlpResult, WsTpMethod } from "../api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useAuth } from "../auth";
import { resolveWorkspace } from "@/lib/workspaceProfiles";

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

function Calc234C() {
  const [tax, setTax] = useState("");
  const [paid, setPaid] = useState(["", "", "", ""]);
  const [res, setRes] = useState<Ws234CResult | null>(null);
  const labels = ["Paid by 15 Jun", "Paid by 15 Sep", "Paid by 15 Dec", "Paid by 15 Mar"];
  const run = async () => {
    const t = parseFloat(tax);
    if (!t || t <= 0) { toast.error("Enter the tax liability."); return; }
    try { setRes(await api.wsCalc234c(t, paid.map((p) => parseFloat(p) || 0))); }
    catch (e: any) { toast.error(e?.message || "Could not compute."); }
  };
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      <div className="space-y-3">
        <Field label="Total tax liability"><Input type="number" placeholder="e.g. 100000" value={tax} onChange={(e) => setTax(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          {labels.map((l, i) => (
            <Field key={i} label={l}>
              <Input type="number" placeholder="cumulative" value={paid[i]}
                onChange={(e) => setPaid(paid.map((v, j) => (j === i ? e.target.value : v)))} />
            </Field>
          ))}
        </div>
        <Button className="w-full" onClick={run}>Compute 234C interest</Button>
        <p className="flex items-start gap-1 text-[11px] text-slate-500"><Info className="size-3.5 mt-px shrink-0" />Enter advance tax paid cumulatively by each due date. 15/45/75/100% schedule.</p>
      </div>
      <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-4">
        {res ? (
          <>
            <div className="text-[11px] font-semibold text-primary uppercase tracking-[0.1em] mb-2">234C interest</div>
            {res.installments.map((r) => (
              <div key={r.installment} className="flex items-center justify-between py-1 text-[12.5px]">
                <span className="text-slate-600">{r.installment}{r.shortfall > 0 ? ` · short ${inr(r.shortfall)}` : ""}</span>
                <span className="tabular-nums font-semibold text-slate-800">{inr(r.interest)}</span>
              </div>
            ))}
            <ResultRow label="Total interest" value={inr(res.interest)} strong />
          </>
        ) : <div className="h-full flex items-center justify-center text-center text-[12.5px] text-slate-400 py-8">Enter values and compute.</div>}
      </div>
    </div>
  );
}

function SlabCalc() {
  const [income, setIncome] = useState("");
  const [regime, setRegime] = useState("new");
  const [res, setRes] = useState<WsSlabResult | null>(null);
  const run = async () => {
    const v = parseFloat(income);
    if (!v || v <= 0) { toast.error("Enter the total income."); return; }
    try { setRes(await api.wsCalcSlab(v, regime)); } catch (e: any) { toast.error(e?.message || "Could not compute."); }
  };
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      <div className="space-y-3">
        <Field label="Total income"><Input type="number" placeholder="e.g. 1200000" value={income} onChange={(e) => setIncome(e.target.value)} /></Field>
        <Field label="Regime">
          <div className="inline-flex rounded-lg bg-slate-100 p-1">
            {[["new", "New"], ["old", "Old"]].map(([k, l]) => (
              <button key={k} onClick={() => setRegime(k)}
                className={cn("px-4 py-1.5 rounded-md text-[13px] font-semibold", regime === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}>{l}</button>
            ))}
          </div>
        </Field>
        <Button className="w-full" onClick={run}>Compute tax</Button>
        <p className="flex items-start gap-1 text-[11px] text-slate-500"><Info className="size-3.5 mt-px shrink-0" />FY 2024-25 slabs incl. 87A rebate + 4% cess. Surcharge not modelled.</p>
      </div>
      <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-4">
        {res ? (
          <>
            <div className="text-[11px] font-semibold text-primary uppercase tracking-[0.1em] mb-1 capitalize">{res.regime} regime tax</div>
            <ResultRow label="Tax before rebate" value={inr(res.tax_before_rebate)} />
            {res.rebate_87a > 0 && <ResultRow label="Rebate / relief u/s 87A" value={`− ${inr(res.rebate_87a)}`} />}
            {res.surcharge > 0 && <ResultRow label={`Surcharge @ ${res.surcharge_pct}%`} value={inr(res.surcharge)} />}
            <ResultRow label="Cess @ 4%" value={inr(res.cess)} />
            <ResultRow label="Total tax" value={inr(res.total_tax)} strong />
            <div className="mt-2 text-[12px] font-semibold text-slate-600">Effective rate: {res.effective_rate_pct}%</div>
          </>
        ) : <div className="h-full flex items-center justify-center text-center text-[12.5px] text-slate-400 py-8">Enter income and compute.</div>}
      </div>
    </div>
  );
}

const CG_KINDS = [
  { v: "ltcg_equity", l: "LTCG — listed equity (112A)" },
  { v: "stcg_equity", l: "STCG — listed equity (111A)" },
  { v: "ltcg_other", l: "LTCG — other (112)" },
];
function CapGainsCalc() {
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState("ltcg_equity");
  const [res, setRes] = useState<WsCapGainsResult | null>(null);
  const run = async () => {
    const v = parseFloat(amount);
    if (!v || v <= 0) { toast.error("Enter the gain amount."); return; }
    try { setRes(await api.wsCalcCapitalGains(v, kind)); } catch (e: any) { toast.error(e?.message || "Could not compute."); }
  };
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      <div className="space-y-3">
        <Field label="Type of gain">
          <select value={kind} onChange={(e) => setKind(e.target.value)}
            className="w-full h-9 rounded-md border border-slate-200 bg-white px-2 text-[13px] text-slate-700">
            {CG_KINDS.map((k) => <option key={k.v} value={k.v}>{k.l}</option>)}
          </select>
        </Field>
        <Field label="Gain amount"><Input type="number" placeholder="e.g. 300000" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Button className="w-full" onClick={run}>Compute tax</Button>
        <p className="flex items-start gap-1 text-[11px] text-slate-500"><Info className="size-3.5 mt-px shrink-0" />Rates effective 23 Jul 2024. LTCG-equity has a ₹1.25L exemption.</p>
      </div>
      <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-4">
        {res ? (
          <>
            <div className="text-[11px] font-semibold text-primary uppercase tracking-[0.1em] mb-1">{res.label}</div>
            <ResultRow label="Gain" value={inr(res.gain)} />
            {res.exemption > 0 && <ResultRow label="Exemption" value={`− ${inr(res.exemption)}`} />}
            <ResultRow label={`Taxable @ ${res.rate_pct}%`} value={inr(res.taxable)} />
            <ResultRow label="Cess @ 4%" value={inr(res.cess)} />
            <ResultRow label="Total tax" value={inr(res.total_tax)} strong />
          </>
        ) : <div className="h-full flex items-center justify-center text-center text-[12.5px] text-slate-400 py-8">Enter the gain and compute.</div>}
      </div>
    </div>
  );
}

const PENALTY_KINDS = [
  { v: "270a_under", l: "270A — under-reporting (50%)" },
  { v: "270a_mis", l: "270A — mis-reporting (200%)" },
  { v: "271aac", l: "271AAC — 115BBE income (10%)" },
  { v: "271_1c", l: "271(1)(c) — concealment (100–300%)" },
];
function PenaltyCalc() {
  const [kind, setKind] = useState("270a_under");
  const [baseTax, setBaseTax] = useState("");
  const [pct, setPct] = useState("100");
  const [res, setRes] = useState<WsPenaltyResult | null>(null);
  const run = async () => {
    const t = parseFloat(baseTax);
    if (!t || t <= 0) { toast.error("Enter the base tax."); return; }
    try { setRes(await api.wsCalcPenalty(kind, t, kind === "271_1c" ? (parseFloat(pct) || 100) : undefined)); }
    catch (e: any) { toast.error(e?.message || "Could not compute."); }
  };
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      <div className="space-y-3">
        <Field label="Penalty section">
          <select value={kind} onChange={(e) => setKind(e.target.value)}
            className="w-full h-9 rounded-md border border-slate-200 bg-white px-2 text-[13px] text-slate-700">
            {PENALTY_KINDS.map((k) => <option key={k.v} value={k.v}>{k.l}</option>)}
          </select>
        </Field>
        <Field label="Tax on the under-reported / evaded / 115BBE amount">
          <Input type="number" placeholder="e.g. 100000" value={baseTax} onChange={(e) => setBaseTax(e.target.value)} />
        </Field>
        {kind === "271_1c" && (
          <Field label="Rate % (100–300)">
            <Input type="number" value={pct} onChange={(e) => setPct(e.target.value)} />
          </Field>
        )}
        <Button className="w-full" onClick={run}>Compute penalty</Button>
        <p className="flex items-start gap-1 text-[11px] text-slate-500"><Info className="size-3.5 mt-px shrink-0" />A % of the tax on the disputed amount. Track the Sec. 275 order limitation on your Calendar.</p>
      </div>
      <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-4">
        {res ? (
          <>
            <div className="text-[11px] font-semibold text-primary uppercase tracking-[0.1em] mb-1">{res.label}</div>
            <ResultRow label="Base tax" value={inr(res.base_tax)} />
            <ResultRow label="Rate" value={`${res.rate_pct}%`} />
            <ResultRow label="Penalty" value={inr(res.penalty)} strong />
            <p className="mt-2 text-[11px] text-slate-500">{res.note}</p>
          </>
        ) : <div className="h-full flex items-center justify-center text-center text-[12.5px] text-slate-400 py-8">Enter the base tax and compute.</div>}
      </div>
    </div>
  );
}

function TdsCalc() {
  const [sections, setSections] = useState<WsTdsSection[]>([]);
  const [section, setSection] = useState("194C");
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState("1");
  const [due, setDue] = useState("");
  const [deducted, setDeducted] = useState("");
  const [deposited, setDeposited] = useState("");
  const [stmtDue, setStmtDue] = useState("");
  const [res, setRes] = useState<WsTdsResult | null>(null);

  useEffect(() => {
    api.wsTdsSections().then(setSections).catch(() => {});
  }, []);

  const pickSection = (sec: string) => {
    setSection(sec);
    const row = sections.find((s) => s.section === sec);
    if (row && row.rate != null) setRate(String(row.rate));
  };

  const run = async () => {
    const a = parseFloat(amount);
    const r = parseFloat(rate);
    if (!a || a <= 0) { toast.error("Enter the payment amount."); return; }
    if (!r || r < 0) { toast.error("Enter the TDS rate."); return; }
    if (!due) { toast.error("Enter the date the tax was deductible."); return; }
    try {
      setRes(await api.wsCalcTds({
        amount: a, rate_pct: r, deduction_due: due,
        deducted_on: deducted || null, deposited_on: deposited || null,
        statement_due: stmtDue || null,
      }));
    } catch (e: any) { toast.error(e?.message || "Could not compute."); }
  };

  const curNote = sections.find((s) => s.section === section)?.note || "";

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      <div className="space-y-3">
        <Field label="Section / nature of payment">
          <select value={section} onChange={(e) => pickSection(e.target.value)}
            className="w-full h-9 rounded-md border border-slate-200 bg-white px-2 text-[13px] text-slate-700">
            {sections.map((s) => <option key={s.section} value={s.section}>{`${s.section} — ${s.nature}${s.rate != null ? ` (${s.rate}%)` : ""}`}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Payment amount"><Input type="number" placeholder="e.g. 100000" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="TDS rate %"><Input type="number" placeholder="e.g. 1" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
        </div>
        <Field label="Tax deductible on (payment / credit)"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Actually deducted on"><Input type="date" value={deducted} onChange={(e) => setDeducted(e.target.value)} /></Field>
          <Field label="Deposited on"><Input type="date" value={deposited} onChange={(e) => setDeposited(e.target.value)} /></Field>
        </div>
        <Field label="Statement due date (for 234E fee)"><Input type="date" value={stmtDue} onChange={(e) => setStmtDue(e.target.value)} /></Field>
        <Button className="w-full" onClick={run}>Compute TDS default</Button>
        <p className="flex items-start gap-1 text-[11px] text-slate-500">
          <Info className="size-3.5 mt-px shrink-0" />
          201(1A): 1%/mth deductible→deducted, 1.5%/mth deducted→deposited. 234E: ₹200/day, capped at the TDS.{curNote ? ` ${curNote}` : ""}
        </p>
      </div>

      <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-4">
        {res ? (
          <>
            <div className="text-[11px] font-semibold text-primary uppercase tracking-[0.1em] mb-1">TDS default</div>
            <ResultRow label={`TDS @ ${res.rate_pct}%`} value={inr(res.tds)} />
            <ResultRow label={`Interest 201(1A)(i) — ${res.interest_deduction_leg.months} mth @ 1%`} value={inr(res.interest_deduction_leg.interest)} />
            <ResultRow label={`Interest 201(1A)(ii) — ${res.interest_deposit_leg.months} mth @ 1.5%`} value={inr(res.interest_deposit_leg.interest)} />
            <ResultRow label={`Fee u/s 234E — ${res.fee_234e_days} day(s)`} value={inr(res.fee_234e)} />
            <ResultRow label="Total payable" value={inr(res.total_payable)} strong />
            <p className="mt-2 text-[11px] text-slate-500">{res.workings}</p>
          </>
        ) : (
          <div className="h-full flex items-center justify-center text-center text-[12.5px] text-slate-400 py-8">
            Enter the payment, rate and dates — the TDS, interest and fee appear here.
          </div>
        )}
      </div>
    </div>
  );
}

function RecoveryCalc() {
  const [demand, setDemand] = useState("");
  const [n, setN] = useState("6");
  const [firstDue, setFirstDue] = useState(todayISO());
  const [res, setRes] = useState<WsInstallmentResult | null>(null);
  const run = async () => {
    const d = parseFloat(demand);
    const cnt = parseInt(n, 10);
    if (!d || d <= 0) { toast.error("Enter the outstanding demand."); return; }
    if (!cnt || cnt < 1) { toast.error("Enter the number of instalments."); return; }
    if (!firstDue) { toast.error("Pick the first instalment date."); return; }
    try { setRes(await api.wsCalcInstallments({ demand: d, installments: cnt, first_due: firstDue })); }
    catch (e: any) { toast.error(e?.message || "Could not compute."); }
  };
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      <div className="space-y-3">
        <Field label="Outstanding demand"><Input type="number" placeholder="e.g. 120000" value={demand} onChange={(e) => setDemand(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="No. of instalments"><Input type="number" placeholder="e.g. 6" value={n} onChange={(e) => setN(e.target.value)} /></Field>
          <Field label="First instalment due"><Input type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} /></Field>
        </div>
        <Button className="w-full" onClick={run}>Build instalment plan</Button>
        <p className="flex items-start gap-1 text-[11px] text-slate-500">
          <Info className="size-3.5 mt-px shrink-0" />
          Equal monthly principal with Sec. 220(2) interest at 1%/month on the outstanding balance. Pair with the u/s 220(3) instalment order in Templates → Library.
        </p>
      </div>
      <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-4">
        {res ? (
          <>
            <div className="text-[11px] font-semibold text-primary uppercase tracking-[0.1em] mb-2">Instalment plan · 220(2)</div>
            <div className="max-h-64 overflow-y-auto -mx-1 px-1">
              {res.schedule.map((r) => (
                <div key={r.n} className="flex items-center justify-between py-1 text-[12.5px] border-b border-slate-100 last:border-0">
                  <span className="text-slate-600">#{r.n} · {r.due_date}</span>
                  <span className="tabular-nums text-slate-800">{inr(r.principal)} <span className="text-slate-400">+ {inr(r.interest_220_2)} int</span></span>
                </div>
              ))}
            </div>
            <ResultRow label="Total interest 220(2)" value={inr(res.total_interest)} />
            <ResultRow label="Total payable" value={inr(res.total_payable)} strong />
          </>
        ) : <div className="h-full flex items-center justify-center text-center text-[12.5px] text-slate-400 py-8">Enter the demand and instalments — the schedule appears here.</div>}
      </div>
    </div>
  );
}

function TrustCalc() {
  const [mode, setMode] = useState<"apply" | "anon">("apply");
  // 11(2) application
  const [gross, setGross] = useState("");
  const [applied, setApplied] = useState("");
  const [form10, setForm10] = useState("");
  const [r11, setR11] = useState<WsTrust11Result | null>(null);
  // 115BBC
  const [anon, setAnon] = useState("");
  const [total, setTotal] = useState("");
  const [rbbc, setRbbc] = useState<Ws115BBCResult | null>(null);

  const run11 = async () => {
    const g = parseFloat(gross), a = parseFloat(applied);
    if (!g || g <= 0) { toast.error("Enter the gross income."); return; }
    try { setR11(await api.wsCalcTrust11({ gross_income: g, amount_applied: a || 0, accumulated_11_2: parseFloat(form10) || 0 })); }
    catch (e: any) { toast.error(e?.message || "Could not compute."); }
  };
  const runBbc = async () => {
    const an = parseFloat(anon), t = parseFloat(total);
    if (!t || t <= 0) { toast.error("Enter the total donations."); return; }
    try { setRbbc(await api.wsCalc115bbc({ anonymous_donations: an || 0, total_donations: t })); }
    catch (e: any) { toast.error(e?.message || "Could not compute."); }
  };

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg bg-slate-100 p-1">
        {([["apply", "11(2) application"], ["anon", "115BBC — anonymous"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setMode(k)}
            className={cn("px-3.5 py-1.5 rounded-md text-[12.5px] font-semibold transition-colors", mode === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}>{l}</button>
        ))}
      </div>

      {mode === "apply" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="space-y-3">
            <Field label="Gross income of the trust"><Input type="number" placeholder="e.g. 1000000" value={gross} onChange={(e) => setGross(e.target.value)} /></Field>
            <Field label="Amount applied to objects"><Input type="number" placeholder="e.g. 700000" value={applied} onChange={(e) => setApplied(e.target.value)} /></Field>
            <Field label="Set apart u/s 11(2) (Form 10)"><Input type="number" placeholder="e.g. 50000" value={form10} onChange={(e) => setForm10(e.target.value)} /></Field>
            <Button className="w-full" onClick={run11}>Compute application test</Button>
            <p className="flex items-start gap-1 text-[11px] text-slate-500"><Info className="size-3.5 mt-px shrink-0" />15% may be accumulated freely; 85% must be applied or set apart u/s 11(2). Pair with Form 10 in Templates → Library.</p>
          </div>
          <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-4">
            {r11 ? (
              <>
                <div className="text-[11px] font-semibold text-primary uppercase tracking-[0.1em] mb-1">Sec. 11 application</div>
                <ResultRow label="Permitted accumulation (15%)" value={inr(r11.permitted_accumulation_15pct)} />
                <ResultRow label="Required application (85%)" value={inr(r11.required_application_85pct)} />
                <ResultRow label="Applied + Form 10" value={inr(r11.amount_applied + r11.accumulated_11_2_form10)} />
                <ResultRow label="Shortfall — taxable" value={inr(r11.shortfall_taxable)} strong />
                <p className="mt-2 text-[11px] text-slate-500">{r11.workings}</p>
              </>
            ) : <div className="h-full flex items-center justify-center text-center text-[12.5px] text-slate-400 py-8">Enter the figures and compute.</div>}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="space-y-3">
            <Field label="Anonymous donations"><Input type="number" placeholder="e.g. 500000" value={anon} onChange={(e) => setAnon(e.target.value)} /></Field>
            <Field label="Total donations received"><Input type="number" placeholder="e.g. 2000000" value={total} onChange={(e) => setTotal(e.target.value)} /></Field>
            <Button className="w-full" onClick={runBbc}>Compute 115BBC tax</Button>
            <p className="flex items-start gap-1 text-[11px] text-slate-500"><Info className="size-3.5 mt-px shrink-0" />30% on anonymous donations above the higher of 5% of total donations or ₹1,00,000.</p>
          </div>
          <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-4">
            {rbbc ? (
              <>
                <div className="text-[11px] font-semibold text-primary uppercase tracking-[0.1em] mb-1">Sec. 115BBC</div>
                <ResultRow label="Exempt threshold" value={inr(rbbc.exempt_threshold)} />
                <ResultRow label={`Taxable @ ${rbbc.rate_pct}%`} value={inr(rbbc.taxable_at_115bbc)} />
                <ResultRow label="Cess @ 4%" value={inr(rbbc.cess)} />
                <ResultRow label="Total tax" value={inr(rbbc.total_tax)} strong />
                <p className="mt-2 text-[11px] text-slate-500">{rbbc.workings}</p>
              </>
            ) : <div className="h-full flex items-center justify-center text-center text-[12.5px] text-slate-400 py-8">Enter the donations and compute.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

type PeakEntry = { date: string; amount: string; kind: "credit" | "debit" };
function PeakCreditCalc() {
  const [rows, setRows] = useState<PeakEntry[]>([{ date: "", amount: "", kind: "credit" }]);
  const [res, setRes] = useState<WsPeakCreditResult | null>(null);
  const setRow = (i: number, patch: Partial<PeakEntry>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { date: "", amount: "", kind: "credit" }]);
  const delRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));

  const run = async () => {
    const entries = rows
      .filter((r) => r.date && parseFloat(r.amount) > 0)
      .map((r) => ({ date: r.date, amount: parseFloat(r.amount), kind: r.kind }));
    if (!entries.length) { toast.error("Add at least one dated credit."); return; }
    try { setRes(await api.wsCalcPeakCredit(entries)); }
    catch (e: any) { toast.error(e?.message || "Could not compute."); }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      <div className="space-y-3">
        <div className="text-[11.5px] font-semibold text-slate-500 uppercase tracking-[0.08em]">Deposits & withdrawals</div>
        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input type="date" value={r.date} onChange={(e) => setRow(i, { date: e.target.value })} className="flex-1" />
              <Input type="number" placeholder="amount" value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} className="w-28" />
              <select value={r.kind} onChange={(e) => setRow(i, { kind: e.target.value as "credit" | "debit" })}
                className="h-9 rounded-md border border-slate-200 bg-white px-1.5 text-[12px] text-slate-700 shrink-0">
                <option value="credit">Credit</option>
                <option value="debit">Debit</option>
              </select>
              <button onClick={() => delRow(i)} className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 shrink-0" aria-label="Remove row">×</button>
            </div>
          ))}
        </div>
        <button onClick={addRow} className="text-[12.5px] font-semibold text-primary hover:underline">+ Add row</button>
        <Button className="w-full" onClick={run}>Compute peak credit</Button>
        <p className="flex items-start gap-1 text-[11px] text-slate-500"><Info className="size-3.5 mt-px shrink-0" />Peak credit is the highest rotating balance — the defensible quantum vs the gross of all deposits. Pair with the working note in Templates → Library.</p>
      </div>
      <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-4">
        {res ? (
          <>
            <div className="text-[11px] font-semibold text-primary uppercase tracking-[0.1em] mb-2">Peak credit</div>
            <div className="max-h-56 overflow-y-auto -mx-1 px-1">
              {res.schedule.map((r, i) => (
                <div key={i} className="flex items-center justify-between py-1 text-[12px] border-b border-slate-100 last:border-0">
                  <span className="text-slate-600">{r.date} · {r.kind}</span>
                  <span className="tabular-nums text-slate-800">{r.kind === "debit" ? "−" : "+"}{inr(r.amount)} <span className="text-slate-400">→ {inr(r.running_balance)}</span></span>
                </div>
              ))}
            </div>
            <ResultRow label="Total credits" value={inr(res.total_credits)} />
            <ResultRow label="Total debits" value={inr(res.total_debits)} />
            <ResultRow label={`Peak credit${res.peak_date ? ` (${res.peak_date})` : ""}`} value={inr(res.peak_credit)} strong />
            <p className="mt-2 text-[11px] text-slate-500">{res.note}</p>
          </>
        ) : <div className="h-full flex items-center justify-center text-center text-[12.5px] text-slate-400 py-8">Add the dated deposits/withdrawals and compute.</div>}
      </div>
    </div>
  );
}

function AlpCalc() {
  const [methods, setMethods] = useState<WsTpMethod[]>([]);
  const [comps, setComps] = useState("");
  const [tested, setTested] = useState("");
  const [base, setBase] = useState("");
  const [res, setRes] = useState<WsAlpResult | null>(null);
  useEffect(() => { api.wsTpMethods().then(setMethods).catch(() => {}); }, []);

  const run = async () => {
    const comparables = comps.split(/[,\s]+/).map((x) => parseFloat(x)).filter((x) => !isNaN(x));
    const t = parseFloat(tested);
    if (!comparables.length) { toast.error("Enter the comparables' margins (comma-separated)."); return; }
    if (isNaN(t)) { toast.error("Enter the tested-party margin."); return; }
    try { setRes(await api.wsCalcAlp({ comparables, tested_margin: t, base_amount: parseFloat(base) || 0 })); }
    catch (e: any) { toast.error(e?.message || "Could not compute."); }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      <div className="space-y-3">
        <Field label="Comparables' margins % (comma-separated)">
          <Input placeholder="e.g. 4, 6, 8, 10, 12, 14, 16" value={comps} onChange={(e) => setComps(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tested margin %"><Input type="number" placeholder="e.g. 3" value={tested} onChange={(e) => setTested(e.target.value)} /></Field>
          <Field label="Base (op. cost / sales)"><Input type="number" placeholder="e.g. 10000000" value={base} onChange={(e) => setBase(e.target.value)} /></Field>
        </div>
        <Button className="w-full" onClick={run}>Compute arm's length</Button>
        <p className="flex items-start gap-1 text-[11px] text-slate-500"><Info className="size-3.5 mt-px shrink-0" />6+ comparables → Rule 10CA 35th–65th percentile range (median = ALP if outside); fewer → arithmetic mean. Pair with the TPO order / 3CEB checklist in Templates.</p>
        {methods.length > 0 && (
          <details className="rounded-lg ring-1 ring-slate-200 bg-white p-3">
            <summary className="text-[12px] font-semibold text-slate-700 cursor-pointer">Method reference (Sec. 92C / Rule 10B)</summary>
            <div className="mt-2 space-y-1.5">
              {methods.map((m) => (
                <div key={m.key} className="text-[11.5px]"><span className="font-semibold text-slate-800">{m.key}</span> — {m.name}. <span className="text-slate-500">{m.use}</span></div>
              ))}
            </div>
          </details>
        )}
      </div>
      <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-4">
        {res ? (
          <>
            <div className="text-[11px] font-semibold text-primary uppercase tracking-[0.1em] mb-1">Arm's length ({res.count} comparables)</div>
            {res.method === "range_35_65" ? (
              <>
                <ResultRow label="35th percentile" value={`${res.lower_p35}%`} />
                <ResultRow label="Median" value={`${res.median}%`} />
                <ResultRow label="65th percentile" value={`${res.upper_p65}%`} />
              </>
            ) : (
              <ResultRow label="Mean of comparables" value={`${res.mean}%`} />
            )}
            <ResultRow label="Tested margin" value={`${res.tested_margin}%`} />
            <ResultRow label="Within arm's length?" value={res.at_arms_length ? "Yes" : "No"} />
            <ResultRow label="TP adjustment" value={inr(res.adjustment || 0)} strong />
            <p className="mt-2 text-[11px] text-slate-500">{res.note}</p>
          </>
        ) : <div className="h-full flex items-center justify-center text-center text-[12.5px] text-slate-400 py-8">Enter the comparables and tested margin.</div>}
      </div>
    </div>
  );
}

type CalcTab = "interest" | "bbe" | "234c" | "slab" | "capgains" | "penalty" | "tds" | "recovery" | "trust" | "peak" | "alp";
export default function Calculators() {
  const { session } = useAuth();
  const defaultTab = (resolveWorkspace(session?.workspaceProfile, session?.workspaceWings).calcTab || "interest") as CalcTab;
  const [tab, setTab] = useState<CalcTab>(defaultTab);
  // Bumping this remounts the active calculator, resetting its inputs + result.
  const [resetKey, setResetKey] = useState(0);
  const clear = () => setResetKey((k) => k + 1);
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

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 w-fit">
          {([["interest", "Interest"], ["234c", "234C"], ["tds", "TDS"], ["recovery", "Recovery"], ["trust", "Trust"], ["peak", "Peak credit"], ["alp", "ALP / TP"], ["bbe", "115BBE"], ["slab", "Slab tax"], ["capgains", "Cap. gains"], ["penalty", "Penalty"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={cn("px-3.5 py-1.5 rounded-md text-[13px] font-semibold transition-colors",
                tab === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}>
              {l}
            </button>
          ))}
        </div>
        <button onClick={clear} title="Clear this calculator"
          className="ml-auto inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[13px] font-semibold text-slate-600 ring-1 ring-slate-200 bg-white hover:bg-slate-50 hover:text-slate-900 transition-colors">
          <RotateCcw className="size-3.5" /> Clear
        </button>
      </div>

      <div key={`${tab}-${resetKey}`} className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-4 sm:p-5">
        {tab === "interest" ? <InterestCalc />
          : tab === "234c" ? <Calc234C />
          : tab === "tds" ? <TdsCalc />
          : tab === "recovery" ? <RecoveryCalc />
          : tab === "trust" ? <TrustCalc />
          : tab === "peak" ? <PeakCreditCalc />
          : tab === "alp" ? <AlpCalc />
          : tab === "bbe" ? <Bbe115Calc />
          : tab === "slab" ? <SlabCalc />
          : tab === "capgains" ? <CapGainsCalc />
          : <PenaltyCalc />}
      </div>

      <p className="flex items-start gap-1.5 text-[11.5px] text-slate-400">
        <IndianRupee className="size-3.5 mt-px shrink-0" />
        Estimates for working purposes — verify against the assessment before relying on a figure.
      </p>
    </div>
  );
}
