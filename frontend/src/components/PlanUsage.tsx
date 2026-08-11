// Merged "Plan & Usage" — combines what used to be the separate Billing and
// Token Usage pages, reframed for non-technical users (officers / CAs): the hero
// metric is "% of your monthly AI allowance used" + "₹ spent", not raw tokens.
// Token counts survive only as a small secondary "AI units" detail line.
import { useEffect, useState } from "react";
import { Loader2, AlertCircle, CalendarClock, Wallet, Gauge, Zap, Sparkles } from "lucide-react";
import { MyBilling, SubscriptionPlan, UserTokenUsage, api } from "../api";
import { TokensBarChart } from "../pages/TokenUsage";
import { AvailablePlansCard } from "../pages/Billing";

const fmt = (n: number) => Math.round(n || 0).toLocaleString("en-IN");
const fmtInr = (n?: number) => "₹" + Math.round(n ?? 0).toLocaleString("en-IN");

// Plain-language names for internal action slugs, so users see "Research
// questions" instead of "ask" / "appeal.instruct".
const ACTION_LABELS: Record<string, string> = {
  ask: "Research questions",
  document: "Document Q&A",
  "appeal.instruct": "Appeal edits (AI)",
  "appeal.reassemble": "Appeal re-drafting",
  appeal: "Appeal drafting",
  improve_prompt: "Prompt suggestions",
  "web-search:gemini": "Live web lookups",
};
const label = (a: string) =>
  ACTION_LABELS[a] ?? a.replace(/[._:]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function PlanUsage() {
  const [billing, setBilling] = useState<MyBilling | null>(null);
  const [usage, setUsage] = useState<UserTokenUsage | null>(null);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.myBilling(),
      api.myTokenUsage(),
      api.publicPlans().catch(() => [] as SubscriptionPlan[]),
    ])
      .then(([b, u, p]) => { setBilling(b); setUsage(u); setPlans(p as SubscriptionPlan[]); })
      .catch((e: any) => setErr(e?.message ?? "Could not load your plan & usage"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="text-sm text-slate-600 py-10 inline-flex items-center gap-2">
        <Loader2 className="size-4 animate-spin" /> Loading your plan & usage…
      </div>
    );
  }
  if (err) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-sm px-4 py-3 flex items-start gap-2">
        <AlertCircle className="size-4 mt-0.5 shrink-0" /> {err}
      </div>
    );
  }

  const sub = billing?.current_subscription ?? null;
  const pct = sub ? Math.min(100, Math.round(sub.pct_used)) : 0;
  const barTone =
    pct >= 90 ? "bg-destructive" :
    pct >= 70 ? "bg-amber-500" :
                "bg-success";
  const daysLeft = sub?.expires_at
    ? Math.max(0, Math.round((new Date(sub.expires_at).getTime() - Date.now()) / 86400000))
    : null;
  const perDay = usage?.per_day ?? [];
  const maxDay = perDay.reduce((m, d) => Math.max(m, d.tokens), 0);
  const totalTasks = (billing?.spend_breakdown ?? []).reduce((s, x) => s + x.total_tokens, 0) || 1;

  return (
    <div className="space-y-4">
      {sub ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Allowance */}
          <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Gauge className="size-4 text-primary" />
                <span className="text-sm font-semibold text-slate-900">
                  Your plan — {sub.plan_name ?? "—"}
                  {sub.is_free_trial ? " · Free trial" : ""}
                </span>
              </div>
              {daysLeft != null && (
                <span className="inline-flex items-center gap-1 text-[11.5px] text-slate-500">
                  <CalendarClock className="size-3.5" /> renews in {daysLeft} day{daysLeft === 1 ? "" : "s"}
                </span>
              )}
            </div>
            <div className="mt-4 flex items-end justify-between gap-3">
              <div className="text-[34px] leading-none font-bold text-slate-900 tabular-nums">
                {pct}<span className="text-lg text-slate-400 font-semibold">%</span>
              </div>
              <div className="text-[12px] text-slate-500 text-right pb-1">of this month's AI allowance used</div>
            </div>
            <div className="mt-2 h-2.5 rounded-full bg-slate-100 overflow-hidden">
              <div className={"h-full rounded-full " + barTone} style={{ width: pct + "%" }} />
            </div>
            <div className="mt-2 text-[11.5px] text-slate-500">
              {fmt(sub.tokens_used)} of {fmt(sub.tokens_allowed)} AI units used · {fmt(sub.tokens_left)} left
            </div>
          </div>
          {/* Spend */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col">
            <div className="flex items-center gap-2">
              <Wallet className="size-4 text-primary" />
              <span className="text-sm font-semibold text-slate-900">Spend this period</span>
            </div>
            <div className="mt-4 text-[34px] leading-none font-bold text-slate-900 tabular-nums">
              {fmtInr(billing?.estimated_period_cost_inr)}
            </div>
            <div className="mt-1 text-[12px] text-slate-500">estimated · {sub.usage?.calls ?? 0} AI actions</div>
            <div className="mt-auto pt-3 text-[11.5px] text-slate-500">
              Plan price: {fmtInr(sub.monthly_price_inr)} / month
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm text-center">
          <div className="text-sm font-semibold text-slate-900">No active plan</div>
          <p className="text-[12.5px] text-slate-500 mt-1">
            You're not on a plan right now. Pick one below to continue using AI features.
          </p>
        </div>
      )}

      {/* Usage over time */}
      {perDay.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <Zap className="size-4 text-primary" /> AI usage — last 30 days
          </div>
          <TokensBarChart rows={perDay.slice(-30)} maxDay={maxDay} />
        </div>
      )}

      {/* Usage by activity */}
      {billing && billing.spend_breakdown.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-semibold text-slate-900 mb-3">Usage by activity (this period)</div>
          <div className="space-y-1.5">
            {billing.spend_breakdown.slice(0, 8).map((r) => {
              const w = Math.round((r.total_tokens / totalTasks) * 100);
              return (
                <div key={r.action} className="flex items-center gap-3">
                  <div className="w-36 sm:w-44 shrink-0 text-[12.5px] text-slate-700 truncate">{label(r.action)}</div>
                  <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full bg-primary" style={{ width: w + "%" }} />
                  </div>
                  <div className="w-20 text-right text-[12px] text-slate-500 tabular-nums">
                    {r.calls} action{r.calls === 1 ? "" : "s"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {plans.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
            <Sparkles className="size-3.5" /> Change plan
          </div>
          <AvailablePlansCard plans={plans} currentPlanId={sub?.plan_id ?? null} />
        </div>
      )}
    </div>
  );
}
