import { useEffect, useMemo, useState } from "react";
import logoUrl from "../assets/income_tax_logo.png";
import { api, type AppealCase } from "../api";

interface Props {
  licenseValidUntil: string | null;
  onOpenAppeals: () => void;
  onNewCase: () => void;
  onOpenCase: (c: AppealCase) => void;
}

// Bucketing rule mirrors AppealsList so the stat tiles agree with the list
// screen's status pills.
function bucket(c: AppealCase): "draft" | "running" | "ready" | "error" {
  const s = (c.status || "").toLowerCase();
  if (s.includes("error") || s.includes("fail")) return "error";
  if (s.includes("run") || s.includes("progress") || s.includes("queue")) return "running";
  if (s.includes("ready") || s.includes("done") || s.includes("complete")) return "ready";
  return "draft";
}

export default function Dashboard({ licenseValidUntil, onOpenAppeals, onNewCase, onOpenCase }: Props) {
  const [cases, setCases] = useState<AppealCase[] | null>(null);

  useEffect(() => {
    let alive = true;
    api.listCases().then((c) => { if (alive) setCases(c); }).catch(() => setCases([]));
    return () => { alive = false; };
  }, []);

  const stats = useMemo(() => {
    const s = { total: 0, running: 0, ready: 0, error: 0, draft: 0 };
    if (!cases) return s;
    s.total = cases.length;
    for (const c of cases) s[bucket(c)]++;
    return s;
  }, [cases]);

  const recent = useMemo(() => (cases ?? []).slice(0, 5), [cases]);

  return (
    <div className="w-full px-8 py-8 space-y-6">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-navy-800 via-navy-700 to-navy-800 text-white p-6 sm:p-8 shadow-lg shadow-navy-900/25 ring-1 ring-navy-900/50">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
            backgroundSize: "22px 22px",
          }}
        />
        <div className="pointer-events-none absolute -right-16 -top-16 size-64 rounded-full bg-ashoka-500/15 blur-3xl" />
        <div className="pointer-events-none absolute -left-10 -bottom-10 size-56 rounded-full bg-white/5 blur-3xl" />

        <div className="relative flex items-start gap-6">
          <div className="hidden sm:flex size-36 shrink-0 items-center justify-center rounded-full bg-white p-3 ring-4 ring-white/15 shadow-2xl shadow-navy-900/40">
            <img src={logoUrl} alt="Income Tax Department" className="w-full h-full object-contain" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-white/12 ring-1 ring-white/20 px-2.5 py-0.5 text-[12.5px] font-semibold tracking-wide backdrop-blur">
              CIT(A) · NFAC appeal drafting
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Appeal cases</h1>
            <p className="mt-1.5 text-[15px] text-white/85 max-w-2xl">
              Upload the appeal file, run the six-module pipeline, and produce a
              draft appellate order grounded in the Act, Rules and case law.
            </p>
            {licenseValidUntil && (
              <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/10 ring-1 ring-white/15 px-2.5 py-0.5 text-[13px] text-white/85">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                License valid until {new Date(licenseValidUntil).toLocaleDateString()}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Stat cards */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="TOTAL CASES" value={stats.total} sub={`${stats.draft} draft${stats.draft === 1 ? "" : "s"}`} tone="navy" />
        <Stat label="RUNNING"     value={stats.running} sub="pipeline in progress" tone="amber" />
        <Stat label="READY"       value={stats.ready}   sub="orders drafted"       tone="green" />
        <Stat label="ERRORS"      value={stats.error}   sub={stats.error === 0 ? "no errors" : "attention needed"} tone="red" />
      </section>

      {/* Actions row */}
      <section className="grid md:grid-cols-2 gap-4">
        <ActionCard
          title="Start a new appeal"
          body="Give the case a name and (optionally) PAN, AY and section. You'll be redirected to the case once it's created."
          buttonLabel="New Appeal"
          onClick={onNewCase}
          accent="red"
        />
        <ActionCard
          title="Open the case list"
          body="Search, filter, edit or delete any of your uploaded appeals — including drafts you started earlier."
          buttonLabel="Go to Appeals"
          onClick={onOpenAppeals}
          accent="navy"
        />
      </section>

      {/* Recent cases */}
      {recent.length > 0 && (
        <section className="rounded-xl bg-white ring-1 ring-slate-200 shadow-sm p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[15.5px] font-semibold text-slate-900">Recent cases</div>
            <button onClick={onOpenAppeals} className="text-[13.5px] font-medium text-navy-700 hover:text-navy-900">
              View all →
            </button>
          </div>
          <ul className="divide-y divide-slate-100">
            {recent.map((c) => {
              const b = bucket(c);
              const tone = STATUS_TONE[b];
              return (
                <li key={c.slug}>
                  <button
                    onClick={() => onOpenCase(c)}
                    className="w-full py-2.5 flex items-center gap-3 hover:bg-slate-50/70 px-2 -mx-2 rounded-md transition-colors text-left"
                  >
                    <div className="size-9 rounded-full bg-gradient-to-br from-navy-500 to-navy-800 text-white font-semibold flex items-center justify-center shrink-0 ring-2 ring-white shadow-sm text-[14.5px]">
                      {(c.title || "?")[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[15px] font-medium text-slate-900 truncate">{c.title}</div>
                      <div className="text-[13px] text-slate-500 mt-0.5 flex items-center gap-2.5">
                        <span>AY {c.assessment_year || "—"}</span>
                        <span>PAN {c.pan || "—"}</span>
                        <span>s.{c.section || "—"}</span>
                      </div>
                    </div>
                    <div className={"inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] font-semibold capitalize " + tone}>
                      <span className="size-1.5 rounded-full bg-current" /> {b}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- pieces

const STATUS_TONE: Record<string, string> = {
  draft:   "bg-slate-100 text-slate-600",
  running: "bg-amber-100 text-amber-800",
  ready:   "bg-emerald-100 text-emerald-800",
  error:   "bg-ashoka-100 text-ashoka-700",
};

function Stat({ label, value, sub, tone }: {
  label: string; value: number; sub: string;
  tone: "navy" | "amber" | "green" | "red";
}) {
  const styles = {
    navy:  { bg: "from-navy-800 to-navy-700",   text: "text-white",       sub: "text-navy-200/85", num: "text-white" },
    amber: { bg: "from-amber-50 to-white",       text: "text-amber-900",   sub: "text-amber-700",   num: "text-amber-900" },
    green: { bg: "from-emerald-50 to-white",     text: "text-emerald-900", sub: "text-emerald-700", num: "text-emerald-900" },
    red:   { bg: "from-ashoka-50 to-white",      text: "text-ashoka-900",  sub: "text-ashoka-700",  num: "text-ashoka-900" },
  }[tone];
  const ring = {
    navy: "ring-navy-900/40 shadow-navy-900/20",
    amber: "ring-amber-200/70 shadow-amber-200/40",
    green: "ring-emerald-200/70 shadow-emerald-200/40",
    red: "ring-ashoka-200/70 shadow-ashoka-200/40",
  }[tone];
  return (
    <div className={"rounded-xl bg-gradient-to-br shadow-sm ring-1 p-4 " + styles.bg + " " + ring}>
      <div className={"text-[12px] font-semibold uppercase tracking-[0.18em] " + styles.sub}>{label}</div>
      <div className={"text-[30px] font-semibold leading-none mt-1.5 tabular-nums " + styles.num}>{value}</div>
      <div className={"text-[13px] mt-1 " + styles.sub}>{sub}</div>
    </div>
  );
}

function ActionCard({ title, body, buttonLabel, onClick, accent }: {
  title: string; body: string; buttonLabel: string; onClick: () => void;
  accent: "red" | "navy";
}) {
  const btn = accent === "red"
    ? "bg-ashoka-600 hover:bg-ashoka-500 text-white"
    : "bg-navy-800 hover:bg-navy-700 text-white";
  return (
    <div className="rounded-xl bg-white ring-1 ring-slate-200 shadow-sm p-5 flex flex-col">
      <div className="text-[16px] font-semibold text-slate-900">{title}</div>
      <div className="text-[14px] text-slate-500 mt-1 flex-1">{body}</div>
      <button
        onClick={onClick}
        className={"mt-3 inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-md font-semibold text-[14.5px] transition-colors self-start " + btn}
      >
        {buttonLabel} →
      </button>
    </div>
  );
}
