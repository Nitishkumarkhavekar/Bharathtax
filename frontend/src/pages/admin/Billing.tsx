import { useEffect, useMemo, useState } from "react";
import {
  CreditCard,
  Search,
  Users,
  Gift,
  Sparkles,
  X,
  Check,
  Loader2,
  AlertTriangle,
  Ban,
  Pencil,
  Zap,
} from "lucide-react";
import {
  AdminBillingUser,
  AdminBillingUsers,
  CurrentSubscription,
  SubscriptionPlan,
  api,
} from "@/api";
import { Empty, ErrorBanner, Header, Loading } from "./Dashboard";
import { Section } from "@/components/admin/charts";

export default function BillingPage() {
  const [data, setData] = useState<AdminBillingUsers | null>(null);
  const [plans, setPlans] = useState<SubscriptionPlan[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [assignFor, setAssignFor] = useState<AdminBillingUser | null>(null);
  const [editSub, setEditSub] = useState<{ user: AdminBillingUser; sub: CurrentSubscription } | null>(null);

  async function refresh() {
    try {
      const [d, ps] = await Promise.all([api.adminBillingUsers(), api.adminBillingPlans()]);
      setData(d);
      setPlans(ps);
    } catch (e: any) { setErr(e?.message ?? "load failed"); }
  }
  useEffect(() => { refresh(); }, []);

  const users = useMemo(() => {
    if (!data) return [];
    const t = q.trim().toLowerCase();
    if (!t) return data.users;
    return data.users.filter((u) =>
      u.username.toLowerCase().includes(t) ||
      (u.full_name ?? "").toLowerCase().includes(t) ||
      (u.email ?? "").toLowerCase().includes(t),
    );
  }, [data, q]);

  const summary = useMemo(() => {
    if (!data) return { total: 0, no_plan: 0, free_trial: 0, paid: 0 };
    let free = 0, paid = 0, none = 0;
    for (const u of data.users) {
      const s = u.current_subscription;
      if (!s) none++;
      else if (s.is_free_trial) free++;
      else paid++;
    }
    return { total: data.users.length, no_plan: none, free_trial: free, paid };
  }, [data]);

  if (err) return <ErrorBanner msg={err} />;
  if (!data || !plans) return <Loading label="Loading billing…" />;

  return (
    <div className="space-y-5">
      <Header
        title="User billing"
        subtitle="Grant free trials, assign plans, watch token balances, cancel or extend subscriptions."
      />

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SumCard label="Total users" value={summary.total} icon={<Users className="size-4" />} tone="indigo" />
        <SumCard label="No plan" value={summary.no_plan} icon={<Ban className="size-4" />} tone="amber" />
        <SumCard label="Free trial" value={summary.free_trial} icon={<Gift className="size-4" />} tone="rose" />
        <SumCard label="Paid" value={summary.paid} icon={<CreditCard className="size-4" />} tone="emerald" />
      </div>

      <Section
        title="Users"
        subtitle={q.trim() ? `${users.length} matching` : `${summary.total} total`}
        icon={<Users className="size-4" />}
        action={
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-2.5 size-4 text-slate-400" />
            <input
              value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search users…"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        }
      >
        {users.length === 0 ? (
          <Empty label="No users match." />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[960px] text-sm admin-table">
              <thead className="bg-slate-50 text-slate-700 text-[11px] font-semibold uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">User</th>
                  <th className="text-left px-4 py-2.5 font-medium">Plan</th>
                  <th className="text-right px-4 py-2.5 font-medium">Used / allowed</th>
                  <th className="text-left px-4 py-2.5 font-medium">Progress</th>
                  <th className="text-right px-4 py-2.5 font-medium" title="Grounded web-search calls (Google charges ~₹2.94 each, on top of tokens)">
                    <span className="inline-flex items-center gap-1"><Zap className="size-3" /> Search</span>
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium">Started</th>
                  <th className="text-left px-4 py-2.5 font-medium">Ends</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const s = u.current_subscription;
                  return (
                    <tr key={u.user_id} className="border-t border-slate-100">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <div className="size-8 rounded-full bg-primary text-white flex items-center justify-center text-xs font-semibold uppercase ring-2 ring-white shadow-sm">
                            {(u.full_name ?? u.username)[0]}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium text-slate-900 truncate">{u.full_name ?? u.username}</div>
                            <div className="text-[11px] text-slate-500 truncate">@{u.username}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        {s ? (
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-slate-900">{s.plan_name}</span>
                            {s.is_free_trial && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-rose-50 ring-1 ring-rose-200 text-rose-700 text-[10px] font-semibold">
                                <Gift className="size-3" /> trial
                              </span>
                            )}
                            {s.is_expired && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-50 ring-1 ring-amber-200 text-amber-700 text-[10px] font-semibold">
                                expired
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 text-[12.5px]">— no plan —</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-800">
                        {s ? `${fmt(s.tokens_used)} / ${fmt(s.tokens_allowed)}` : "—"}
                      </td>
                      <td className="px-4 py-2.5 w-40">
                        {s ? (
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                              <div
                                className={
                                  "h-full " +
                                  (s.pct_used >= 90
                                    ? "bg-rose-500"
                                    : s.pct_used >= 70
                                      ? "bg-amber-500"
                                      : "bg-emerald-500")
                                }
                                style={{ width: `${Math.min(100, s.pct_used)}%` }}
                              />
                            </div>
                            <span className="text-[11px] text-slate-500 tabular-nums w-9 text-right">
                              {s.pct_used.toFixed(0)}%
                            </span>
                          </div>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {s ? (
                          <div className="flex flex-col items-end leading-tight">
                            <span className="font-mono tabular-nums text-slate-800 text-[12.5px]">
                              {s.usage?.grounded_calls ?? 0}
                            </span>
                            {(s.usage?.grounding_cost_est_inr ?? 0) > 0 && (
                              <span className="text-[10.5px] text-rose-600 tabular-nums" title="Est. Google grounding fee — not in per-1k token rates">
                                +₹{(s.usage!.grounding_cost_est_inr!).toFixed(2)}
                              </span>
                            )}
                          </div>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 text-[12.5px] whitespace-nowrap">
                        {s?.started_at ? new Date(s.started_at).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 text-[12.5px] whitespace-nowrap">
                        {s?.expires_at ? new Date(s.expires_at).toLocaleDateString() : (s ? "no expiry" : "—")}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {s && (
                          <button onClick={() => setEditSub({ user: u, sub: s })}
                                  className="p-1.5 rounded-md text-slate-400 hover:text-primary hover:bg-primary/10 mr-1" title="Edit subscription">
                            <Pencil className="size-3.5" />
                          </button>
                        )}
                        <button onClick={() => setAssignFor(u)}
                                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-primary/10 text-primary text-[11px] font-semibold hover:bg-primary/20">
                          {s ? "Reassign" : "Assign plan"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {assignFor && (
        <AssignDialog
          user={assignFor}
          plans={plans}
          onClose={() => setAssignFor(null)}
          onDone={() => { setAssignFor(null); refresh(); }}
        />
      )}
      {editSub && (
        <EditSubscription
          user={editSub.user}
          sub={editSub.sub}
          onClose={() => setEditSub(null)}
          onDone={() => { setEditSub(null); refresh(); }}
        />
      )}
    </div>
  );
}

function SumCard({ label, value, icon, tone }: {
  label: string; value: number; icon: React.ReactNode;
  tone: "indigo" | "amber" | "rose" | "emerald";
}) {
  const t = {
    indigo: "bg-primary/[0.06] ring-primary/20",
    amber: "bg-amber-50 ring-amber-200",
    rose: "bg-rose-50 ring-rose-200",
    emerald: "bg-emerald-50 ring-emerald-200",
  }[tone];
  return (
    <div className={"relative overflow-hidden rounded-xl border border-slate-200/80 shadow-sm p-3.5 ring-1 bg-gradient-to-br " + t}>
      <div className="flex items-center gap-2">
        <div className="size-8 rounded-lg bg-white ring-1 ring-slate-200 flex items-center justify-center text-slate-700">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
          <div className="text-[20px] font-semibold text-slate-900 leading-none tabular-nums mt-0.5">{value}</div>
        </div>
      </div>
    </div>
  );
}

function AssignDialog({
  user, plans, onClose, onDone,
}: { user: AdminBillingUser; plans: SubscriptionPlan[]; onClose: () => void; onDone: () => void }) {
  const activePlans = useMemo(() => plans.filter((p) => p.is_active), [plans]);
  const [planId, setPlanId] = useState(activePlans[0]?.id ?? 0);
  const [isFreeTrial, setIsFreeTrial] = useState(false);
  const [duration, setDuration] = useState<string>("30");
  const [override, setOverride] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!planId) return;
    setBusy(true); setErr(null);
    try {
      await api.adminBillingAssign(user.user_id, {
        plan_id: planId,
        is_free_trial: isFreeTrial,
        duration_days: duration.trim() === "" ? null : Math.max(0, Math.floor(Number(duration) || 0)),
        tokens_allowed_override: override.trim() === "" ? null : Math.max(0, Math.floor(Number(override) || 0)),
        notes: notes.trim() || null,
      });
      onDone();
    } catch (e: any) { setErr(e?.message ?? "assign failed"); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={`Assign plan to ${user.full_name ?? user.username}`} onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <Field label="Plan" required>
          <select value={planId} onChange={(e) => setPlanId(Number(e.target.value))} className="input" required>
            {activePlans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — ₹{p.monthly_price_inr.toFixed(2)}/mo · {fmt(p.monthly_token_allowance)} tokens
              </option>
            ))}
          </select>
        </Field>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isFreeTrial} onChange={(e) => setIsFreeTrial(e.target.checked)} className="size-4 rounded border-slate-300" />
          Mark as free trial (does not bill)
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Duration (days)">
            <input value={duration} onChange={(e) => setDuration(e.target.value)} type="number" min="0" step="1"
              placeholder="30  (blank = open-ended)" className="input font-mono tabular-nums" />
          </Field>
          <Field label="Token override (optional)">
            <input value={override} onChange={(e) => setOverride(e.target.value)} type="number" min="0" step="1000"
              placeholder="inherit from plan" className="input font-mono tabular-nums" />
          </Field>
        </div>
        <Field label="Notes">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            placeholder="e.g. initial onboarding, upgraded from Basic, etc."
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
        </Field>
        {user.current_subscription && (
          <div className="text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            <b>Heads-up:</b> the user already has a <b>{user.current_subscription.plan_name}</b> subscription. Assigning a new plan will supersede it (marked <code className="font-mono">expired</code>).
          </div>
        )}
        {err && (
          <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 flex items-start gap-2">
            <AlertTriangle className="size-4 mt-0.5 shrink-0" /> {err}
          </div>
        )}
        <div className="pt-1 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="bt-btn-ghost h-9 px-4 rounded-lg">Cancel</button>
          <button type="submit" disabled={busy || !planId} className="bt-btn-primary h-9 px-5 rounded-lg">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Assign
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditSubscription({
  user, sub, onClose, onDone,
}: { user: AdminBillingUser; sub: CurrentSubscription; onClose: () => void; onDone: () => void }) {
  const [startedAt, setStartedAt] = useState(
    sub.started_at ? sub.started_at.slice(0, 10) : "",
  );
  const [expiresAt, setExpiresAt] = useState(
    sub.expires_at ? sub.expires_at.slice(0, 10) : "",
  );
  const [override, setOverride] = useState(String(sub.tokens_allowed));
  const [status, setStatus] = useState(sub.status);
  const [isFreeTrial, setIsFreeTrial] = useState(sub.is_free_trial);
  const [notes, setNotes] = useState(sub.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Warn the admin if the window is backwards.
  const invalidRange =
    !!startedAt && !!expiresAt && new Date(expiresAt) < new Date(startedAt);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (invalidRange) {
      setErr("End date must be after start date.");
      return;
    }
    setBusy(true); setErr(null);
    try {
      await api.adminBillingPatchSubscription(sub.id, {
        // For start_date: date-only inputs are interpreted at 00:00 local.
        // Convert to ISO so the backend receives a real timestamp.
        started_at: startedAt ? new Date(startedAt).toISOString() : null,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        tokens_allowed_override: Math.max(0, Math.floor(Number(override) || 0)),
        status,
        is_free_trial: isFreeTrial,
        notes: notes.trim() || null,
      });
      onDone();
    } catch (e: any) { setErr(e?.message ?? "save failed"); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={`Edit subscription — ${user.full_name ?? user.username}`} onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <div className="rounded-lg bg-slate-50 ring-1 ring-slate-200 px-3 py-2 text-[12.5px] text-slate-700">
          <div><b>Plan:</b> {sub.plan_name}</div>
          <div><b>Used:</b> <span className="font-mono">{sub.tokens_used.toLocaleString()}</span> tokens</div>
        </div>
        {/* Subscription window — both endpoints editable. Usage is computed
            from the CURRENT `started_at`, so moving the start date will
            change the "used" number the next time the page reloads. */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Started on" required>
            <input value={startedAt} onChange={(e) => setStartedAt(e.target.value)}
                   type="date" required className="input" />
          </Field>
          <Field label="Ends on (blank = no expiry)">
            <input value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)}
                   type="date" className="input" />
          </Field>
        </div>
        {invalidRange && (
          <div className="text-[11.5px] text-rose-700 flex items-center gap-1">
            <AlertTriangle className="size-3" /> End date is before start date.
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Token allowance (override)">
            <input value={override} onChange={(e) => setOverride(e.target.value)} type="number" min="0" step="1000" className="input font-mono tabular-nums" />
          </Field>
          <div />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="input">
              <option value="active">active</option>
              <option value="cancelled">cancelled</option>
              <option value="expired">expired</option>
            </select>
          </Field>
          <label className="inline-flex items-center gap-2 text-sm h-9 mt-6">
            <input type="checkbox" checked={isFreeTrial} onChange={(e) => setIsFreeTrial(e.target.checked)} className="size-4 rounded border-slate-300" />
            Free trial (does not bill)
          </label>
        </div>
        <Field label="Notes">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
        </Field>
        {err && (
          <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 flex items-start gap-2">
            <AlertTriangle className="size-4 mt-0.5 shrink-0" /> {err}
          </div>
        )}
        <div className="pt-1 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="bt-btn-ghost h-9 px-4 rounded-lg">Cancel</button>
          <button type="submit" disabled={busy} className="bt-btn-primary h-9 px-5 rounded-lg">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {label} {required && <span className="text-rose-500">*</span>}
      </label>
      {children}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-up"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl ring-1 ring-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-slate-900">
            <Sparkles className="size-4 text-primary" /> {title}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function fmt(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 2 : 1) + "k";
  return (n / 1_000_000).toFixed(2) + "M";
}
