import { useEffect, useState } from "react";
import {
  CreditCard,
  Gift,
  CalendarDays,
  Coins,
  IndianRupee,
  Loader2,
  AlertTriangle,
  History,
  Zap,
  Sparkles,
  Info,
} from "lucide-react";
import { MyBilling, SubscriptionPlan, api } from "../api";

const actionLabel = (a: string) => {
  const m: Record<string, string> = {
    ask: "AI Q&A",
    improve_prompt: "Improve prompt",
    "appeal.module1": "Appeal — Deficiency check",
    "appeal.module2": "Appeal — Scope validation",
    "appeal.module3": "Appeal — Document compliance",
    "appeal.module4": "Appeal — Issue matrix",
    "appeal.module5": "Appeal — Issue drafting",
    "appeal.module6": "Appeal — Assemble draft order",
  };
  return m[a] || a.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
};

export default function Billing() {
  const [data, setData] = useState<MyBilling | null>(null);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [b, ps] = await Promise.all([api.myBilling(), api.publicPlans()]);
        if (!alive) return;
        setData(b); setPlans(ps);
      } catch (e: any) {
        if (alive) setErr(e?.message ?? "load failed");
      }
    })();
    return () => { alive = false; };
  }, []);

  if (err)
    return (
      <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-800 px-3 py-2 flex items-start gap-2">
        <AlertTriangle className="size-4 mt-0.5 shrink-0" /> {err}
      </div>
    );
  if (!data)
    return (
      <div className="text-sm text-slate-500 flex items-center gap-2">
        <Loader2 className="size-4 animate-spin" /> Loading billing…
      </div>
    );

  const sub = data.current_subscription;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <CreditCard className="size-5 text-primary" /> Billing
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Your current plan, tokens remaining, spend so far, and every past
          subscription.
        </p>
      </div>

      {sub ? (
        <CurrentPlanCard
          sub={sub}
          cost={data.estimated_period_cost_inr}
          tokenCost={data.token_cost_inr}
          groundingCost={data.grounding_cost_inr}
        />
      ) : (
        <NoPlanCard plans={plans} />
      )}

      {sub && data.spend_breakdown.length > 0 && (
        <SpendBreakdownCard rows={data.spend_breakdown} />
      )}

      {plans.length > 0 && <AvailablePlansCard plans={plans} currentPlanId={sub?.plan_id ?? null} />}

      {data.history.length > 0 && <HistoryCard rows={data.history} />}
    </div>
  );
}

// ============================================================ current plan

function CurrentPlanCard({
  sub, cost, tokenCost, groundingCost,
}: {
  sub: NonNullable<MyBilling["current_subscription"]>;
  cost: number;
  tokenCost?: number;
  groundingCost?: number;
}) {
  const pct = Math.min(100, sub.pct_used);
  const barTone =
    pct >= 90 ? "from-rose-500 to-rose-400" :
    pct >= 70 ? "from-amber-500 to-orange-400" :
                "from-emerald-500 to-teal-400";
  const daysLeft = sub.expires_at
    ? Math.max(0, Math.round((new Date(sub.expires_at).getTime() - Date.now()) / (86400 * 1000)))
    : null;

  // Pace-based projected exhaustion. Only meaningful once a day has elapsed
  // and some tokens have actually been spent — otherwise the extrapolation
  // is noise.
  let exhaustDate: Date | null = null;
  if (sub.started_at && sub.tokens_used > 0 && sub.tokens_left > 0) {
    const startedMs = new Date(sub.started_at).getTime();
    const elapsedDays = (Date.now() - startedMs) / (86400 * 1000);
    if (elapsedDays >= 1) {
      const tokensPerDay = sub.tokens_used / elapsedDays;
      if (tokensPerDay > 0) {
        const daysToEmpty = sub.tokens_left / tokensPerDay;
        exhaustDate = new Date(Date.now() + daysToEmpty * 86400 * 1000);
        // If the pace suggests the plan window will outlast the tokens by
        // less than a day, don't display — it's basically "any day now".
        if (sub.expires_at && exhaustDate > new Date(sub.expires_at)) {
          exhaustDate = null; // plan expires first — no need to warn
        }
      }
    }
  }

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary via-sky-600 to-violet-600 text-white p-5 sm:p-6 shadow-lg shadow-primary/20">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.10]"
        style={{
          backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
          backgroundSize: "22px 22px",
        }}
      />
      <div className="pointer-events-none absolute -right-10 -top-10 size-56 rounded-full bg-white/15 blur-3xl" />

      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 ring-1 ring-white/25 px-2 py-0.5 text-[11px] font-semibold tracking-wide backdrop-blur">
            <Sparkles className="size-3" /> {sub.is_free_trial ? "Free trial" : "Current plan"}
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="text-2xl sm:text-[26px] font-semibold tracking-tight">{sub.plan_name}</div>
            {sub.is_expired && (
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/25 ring-1 ring-rose-300/50 px-2 py-0.5 text-[11px] font-semibold">
                Expired
              </span>
            )}
          </div>
          {sub.is_free_trial ? (
            <div className="text-white/85 text-[13.5px] mt-0.5">Free trial · no billing this period</div>
          ) : (
            <div className="text-white/85 text-[13.5px] mt-0.5 flex items-center gap-1">
              <IndianRupee className="size-3.5" /> {sub.monthly_price_inr.toFixed(2)} <span className="opacity-70">/ month</span>
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-wider text-white/70">AI compute cost (wholesale)</div>
          <div className="text-2xl font-semibold tabular-nums mt-0.5">₹ {cost.toFixed(2)}</div>
          <div className="text-[11px] text-white/70 mt-0.5 flex items-center gap-1 justify-end">
            <Info className="size-3" />
            {tokenCost !== undefined && groundingCost !== undefined && groundingCost > 0
              ? <>tokens ₹{tokenCost.toFixed(2)} + search ₹{groundingCost.toFixed(2)}</>
              : <>upstream model cost at current rate card</>}
          </div>
        </div>
      </div>

      {/* Token usage bar */}
      <div className="relative mt-5 rounded-xl bg-white/10 ring-1 ring-white/20 backdrop-blur p-3.5">
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-[12px] font-semibold flex items-center gap-1.5">
            <Coins className="size-3.5" /> Tokens used
          </div>
          <div className="text-[12px] tabular-nums">
            <b>{fmt(sub.tokens_used)}</b> <span className="opacity-70">of</span> <b>{fmt(sub.tokens_allowed)}</b>
            <span className="opacity-70"> · {sub.pct_used.toFixed(1)}%</span>
          </div>
        </div>
        <div className="h-2 rounded-full bg-white/15 overflow-hidden">
          <div className={"h-full bg-gradient-to-r rounded-full transition-[width] duration-500 " + barTone}
               style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-white/75">
          <span><b className="text-white">{fmt(sub.tokens_left)}</b> tokens left</span>
          {daysLeft !== null && <span>{daysLeft} day{daysLeft === 1 ? "" : "s"} remaining</span>}
        </div>
        {exhaustDate && (
          <div className="mt-1 flex items-center gap-1 text-[11px] text-amber-100/90">
            <AlertTriangle className="size-3" />
            At current pace, tokens exhaust on{" "}
            <b className="text-white">{exhaustDate.toLocaleDateString()}</b>
          </div>
        )}
      </div>

      {/* Meta strip */}
      <div className="relative mt-4 grid sm:grid-cols-3 gap-3 text-[12px]">
        <MetaCell label="Started" value={sub.started_at ? new Date(sub.started_at).toLocaleDateString() : "—"} icon={<CalendarDays className="size-3" />} />
        <MetaCell label="Expires" value={sub.expires_at ? new Date(sub.expires_at).toLocaleDateString() : "no expiry"} icon={<CalendarDays className="size-3" />} />
        <MetaCell label="Calls this period" value={fmt(sub.usage.calls)} icon={<Zap className="size-3" />} />
      </div>
    </div>
  );
}

function MetaCell({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-white/10 ring-1 ring-white/20 px-3 py-2">
      <div className="uppercase tracking-wider opacity-80 text-[10.5px] flex items-center gap-1">{icon} {label}</div>
      <div className="font-semibold mt-0.5">{value}</div>
    </div>
  );
}

// ============================================================ no plan yet

function NoPlanCard({ plans }: { plans: SubscriptionPlan[] }) {
  return (
    <div className="rounded-2xl bg-white border border-dashed border-slate-300 p-6 text-center">
      <div className="mx-auto size-12 rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15 flex items-center justify-center mb-3">
        <Gift className="size-5" />
      </div>
      <div className="text-[15px] font-semibold text-slate-900">No active plan yet</div>
      <div className="text-[12.5px] text-slate-500 mt-1 max-w-md mx-auto">
        Your administrator hasn't assigned you a plan yet. You'll be able to use
        AI Q&A and appeal drafting once one is assigned. {plans.length > 0 && "Available plans are shown below."}
      </div>
    </div>
  );
}

// ============================================================ spend breakdown

function SpendBreakdownCard({ rows }: { rows: MyBilling["spend_breakdown"] }) {
  const total = rows.reduce((a, r) => a + r.total_tokens, 0);
  return (
    <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-5">
      <div className="text-[13px] font-semibold text-slate-900 mb-3 flex items-center gap-2">
        <Zap className="size-4 text-primary" /> Spend by task (this period)
      </div>
      <div className="space-y-2">
        {rows.slice(0, 10).map((r) => {
          const pct = total ? (r.total_tokens / total) * 100 : 0;
          return (
            <div key={r.action} className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-[13px] text-slate-800 truncate">{actionLabel(r.action)}</div>
                  <div className="text-[11.5px] text-slate-500 tabular-nums shrink-0">
                    ×{r.calls} · {fmt(r.total_tokens)} tokens
                  </div>
                </div>
                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden mt-1">
                  <div className="h-full rounded-full bg-gradient-to-r from-primary to-violet-500"
                       style={{ width: `${pct}%` }} />
                </div>
              </div>
              <div className="w-12 text-right text-[11.5px] text-slate-500 tabular-nums">{pct.toFixed(1)}%</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================ available plans

export function AvailablePlansCard({
  plans, currentPlanId,
}: { plans: SubscriptionPlan[]; currentPlanId: number | null }) {
  return (
    <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-5">
      <div className="text-[13px] font-semibold text-slate-900 mb-3 flex items-center gap-2">
        <Sparkles className="size-4 text-primary" /> Available plans
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {plans.map((p) => {
          const isCurrent = p.id === currentPlanId;
          return (
            <div key={p.id}
                 className={
                   "rounded-xl ring-1 p-4 " +
                   (isCurrent
                     ? "ring-primary/40 bg-primary/[0.04]"
                     : "ring-slate-200 bg-slate-50/50")
                 }>
              <div className="flex items-center justify-between">
                <div className="text-[13.5px] font-semibold text-slate-900">{p.name}</div>
                {isCurrent && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold">
                    Current
                  </span>
                )}
              </div>
              {p.description && <div className="text-[11.5px] text-slate-500 mt-1 line-clamp-2">{p.description}</div>}
              <div className="mt-2 text-[18px] font-semibold text-slate-900 tabular-nums flex items-baseline gap-1">
                ₹{p.monthly_price_inr.toFixed(0)}
                <span className="text-[11px] text-slate-500 font-normal">/ month</span>
              </div>
              <div className="mt-1 text-[11.5px] text-slate-600">{fmt(p.monthly_token_allowance)} tokens / month</div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 text-[11.5px] text-slate-500">
        To switch plans, contact your administrator.
      </div>
    </div>
  );
}

// ============================================================ history

function HistoryCard({ rows }: { rows: MyBilling["history"] }) {
  return (
    <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-5">
      <div className="text-[13px] font-semibold text-slate-900 mb-3 flex items-center gap-2">
        <History className="size-4 text-primary" /> Previous subscriptions
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-slate-50 text-slate-700 text-[10.5px] font-semibold uppercase tracking-wider">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Plan</th>
              <th className="text-left px-3 py-2 font-medium">Started</th>
              <th className="text-left px-3 py-2 font-medium">Ended</th>
              <th className="text-right px-3 py-2 font-medium">Tokens used</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-t border-slate-100">
                <td className="px-3 py-2 text-slate-800">
                  {s.plan_name}
                  {s.is_free_trial && (
                    <span className="ml-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-rose-50 ring-1 ring-rose-200 text-rose-700 text-[10px] font-semibold">
                      trial
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-600">
                  {s.started_at ? new Date(s.started_at).toLocaleDateString() : "—"}
                </td>
                <td className="px-3 py-2 text-slate-600">
                  {s.expires_at ? new Date(s.expires_at).toLocaleDateString() : "no expiry"}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-800">
                  {fmt(s.usage.total_tokens)}
                </td>
                <td className="px-3 py-2 text-slate-600 capitalize">{s.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function fmt(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 2 : 1) + "k";
  return (n / 1_000_000).toFixed(2) + "M";
}
