import { useEffect, useState } from "react";
import { toast } from "@/lib/toast";
import {
  Tag,
  Coins,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  X,
  Check,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import { SubscriptionPlan, TokenRate, api } from "@/api";
import { Empty, ErrorBanner, Header, Loading } from "./Dashboard";
import { Section } from "@/components/admin/charts";
import { useConfirm } from "@/components/ui/ConfirmDialog";

type Tab = "plans" | "rates";

export default function PricingPage() {
  const [tab, setTab] = useState<Tab>("plans");

  return (
    <div className="space-y-5">
      <Header
        title="Pricing management"
        subtitle="Subscription plans officers can be assigned to, plus per-1,000-token rate cards."
      />

      <div className="inline-flex rounded-xl border border-slate-200 bg-white p-0.5">
        <TabBtn active={tab === "plans"} onClick={() => setTab("plans")} icon={<Tag className="size-4" />}>
          Subscription plans
        </TabBtn>
        <TabBtn active={tab === "rates"} onClick={() => setTab("rates")} icon={<Coins className="size-4" />}>
          Token rates
        </TabBtn>
      </div>

      {tab === "plans" ? <PlansTab /> : <RatesTab />}
    </div>
  );
}

function TabBtn({
  active, onClick, icon, children,
}: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={
        "inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-[13px] font-medium transition-colors " +
        (active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-slate-700 hover:bg-slate-100")
      }
    >
      {icon}
      {children}
    </button>
  );
}

// ============================================================ Plans

function PlansTab() {
  const [rows, setRows] = useState<SubscriptionPlan[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<SubscriptionPlan | null>(null);
  const [creating, setCreating] = useState(false);
  const { confirm, dialog } = useConfirm();

  async function refresh() {
    try {
      setRows(await api.adminBillingPlans());
    } catch (e: any) { setErr(e?.message ?? "load failed"); }
  }
  useEffect(() => { refresh(); }, []);

  async function doDelete(p: SubscriptionPlan) {
    const ok = await confirm({
      title: `Delete plan "${p.name}"?`,
      description:
        "You can only delete a plan with no active subscribers. Toggling `is_active` off is the usual retire path — it hides the plan without touching existing users.",
      tone: "danger",
      confirmLabel: "Delete plan",
    });
    if (!ok) return;
    try {
      await api.adminBillingDeletePlan(p.id);
      refresh();
    } catch (e: any) {
      // Backend returns 409 with a message like "N historical (expired/
      // cancelled) subscription(s) reference this plan. Re-issue the delete
      // with ?force=true …". Detect that specific shape and offer to cascade.
      const msg = e?.message ?? "Delete failed";
      const isHistoricalBlock = /historical\s+.*subscription/i.test(msg);
      if (isHistoricalBlock) {
        const cascade = await confirm({
          title: `Also delete historical subscriptions for "${p.name}"?`,
          description:
            msg +
            "\n\nProceeding will delete the historical subscription rows " +
            "(expired / cancelled) AND the plan itself. Audit history for " +
            "those old subscriptions will be lost. This cannot be undone.",
          tone: "danger",
          confirmLabel: "Force delete plan + history",
        });
        if (!cascade) return;
        try {
          await api.adminBillingDeletePlan(p.id, /* force= */ true);
          refresh();
        } catch (e2: any) {
          toast.error(e2?.message ?? "Force delete failed");
        }
        return;
      }
      toast.error(msg);
    }
  }

  if (err) return <ErrorBanner msg={err} />;
  if (!rows) return <Loading label="Loading plans…" />;

  return (
    <>
      {dialog}
      <Section
        title="Subscription plans"
        subtitle={`${rows.length} plan${rows.length === 1 ? "" : "s"}`}
        icon={<Tag className="size-4" />}
        action={
          <button
            onClick={() => setCreating(true)}
            className="bt-btn-primary h-9 px-4 rounded-lg"
          >
            <Plus className="size-4" /> New plan
          </button>
        }
      >
        {rows.length === 0 ? (
          <Empty label="No plans yet — create one to get started." />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[720px] text-sm admin-table">
              <thead className="bg-slate-50 text-slate-700 text-[11px] font-semibold uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">Order</th>
                  <th className="text-left px-4 py-2.5 font-medium">Name</th>
                  <th className="text-right px-4 py-2.5 font-medium">₹ / month</th>
                  <th className="text-right px-4 py-2.5 font-medium">₹ / year</th>
                  <th className="text-right px-4 py-2.5 font-medium">Tokens / month</th>
                  <th className="text-left px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="px-4 py-2.5 text-slate-500 tabular-nums">{p.sort_order}</td>
                    <td className="px-4 py-2.5">
                      <div className="font-semibold text-slate-900">{p.name}</div>
                      {p.description && (
                        <div className="text-[11.5px] text-slate-500 truncate max-w-md">
                          {p.description}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-900">
                      {p.monthly_price_inr.toFixed(2)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-900">
                      {p.yearly_price_inr
                        ? p.yearly_price_inr.toFixed(2)
                        : <span className="text-slate-400">—</span>}
                      {p.yearly_price_is_override && (
                        <span className="ml-1 text-[9.5px] font-semibold text-primary/70 uppercase">set</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-800">
                      {fmt(p.monthly_token_allowance)}
                    </td>
                    <td className="px-4 py-2.5">
                      {p.is_active ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                          <Check className="size-3" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                          <X className="size-3" /> Retired
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <button
                        onClick={() => setEditing(p)}
                        className="p-1.5 rounded-md text-slate-400 hover:text-primary hover:bg-primary/10"
                        title="Edit"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        onClick={() => doDelete(p)}
                        className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 ml-1"
                        title="Delete"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {creating && (
        <PlanEditor
          initial={null}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); refresh(); }}
        />
      )}
      {editing && (
        <PlanEditor
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      )}
    </>
  );
}

function PlanEditor({
  initial, onClose, onSaved,
}: { initial: SubscriptionPlan | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [priceInr, setPriceInr] = useState(String(initial?.monthly_price_inr ?? "0"));
  // Yearly override — blank means "auto-derive from monthly + discount".
  const [yearlyInr, setYearlyInr] = useState(
    initial?.yearly_price_is_override && initial?.yearly_price_inr
      ? String(initial.yearly_price_inr)
      : "",
  );
  const [tokens, setTokens] = useState(String(initial?.monthly_token_allowance ?? "0"));
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [sortOrder, setSortOrder] = useState(String(initial?.sort_order ?? "0"));
  // Landing-page marketing controls. `features` is a newline-separated
  // textarea in the UI, converted to a JSONB list on save.
  const [features, setFeatures] = useState(
    (initial?.features ?? []).join("\n"),
  );
  const [isFeatured, setIsFeatured] = useState(initial?.is_featured ?? false);
  const [badge, setBadge] = useState(initial?.badge ?? "");
  const [savingsNote, setSavingsNote] = useState(initial?.savings_note ?? "");
  const [annualDiscountPct, setAnnualDiscountPct] = useState(
    String(initial?.annual_discount_pct ?? 20),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const featuresList = features
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      const body: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim() || null,
        monthly_price_inr: Number(priceInr) || 0,
        // Empty input → send 0 as the sentinel "clear override" (backend
        // treats 0 as "unset yearly_price_inr, auto-compute again").
        // A value → send the number (admin explicitly overrides).
        yearly_price_inr: yearlyInr.trim() === "" ? 0 : Number(yearlyInr) || 0,
        monthly_token_allowance: Math.max(0, Math.floor(Number(tokens) || 0)),
        is_active: isActive,
        sort_order: Math.floor(Number(sortOrder) || 0),
        features: featuresList,
        is_featured: isFeatured,
        badge: badge.trim() || null,
        savings_note: savingsNote.trim() || null,
        annual_discount_pct: Math.max(0, Math.min(90, Math.floor(Number(annualDiscountPct) || 0))),
      };
      if (initial) await api.adminBillingPatchPlan(initial.id, body);
      else await api.adminBillingCreatePlan(body);
      onSaved();
    } catch (e: any) {
      setErr(e?.message ?? "save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={initial ? `Edit "${initial.name}"` : "New subscription plan"} onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <Field label="Name" required>
          <input value={name} onChange={(e) => setName(e.target.value)} required className="input" autoFocus />
        </Field>
        <Field label="Description">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)}
            rows={2} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Monthly price (₹)" required>
            <input value={priceInr} onChange={(e) => setPriceInr(e.target.value)} type="number" min="0" step="0.01" className="input font-mono tabular-nums" required />
          </Field>
          <Field label="Tokens / month" required>
            <input value={tokens} onChange={(e) => setTokens(e.target.value)} type="number" min="0" step="1000" className="input font-mono tabular-nums" required />
          </Field>
        </div>
        {/* Yearly price — optional override. Blank = auto-derived from monthly. */}
        <Field
          label={
            <span>
              Yearly price (₹) —{" "}
              <span className="text-slate-500 font-normal">
                leave blank to auto-derive{yearlyInr.trim() === "" && Number(priceInr) > 0
                  ? ` (currently ₹${Math.round(
                      Number(priceInr) * 12 *
                      (1 - Math.max(0, Math.min(90, Number(annualDiscountPct) || 0)) / 100),
                    ).toLocaleString("en-IN")})`
                  : ""}
              </span>
            </span>
          }
        >
          <input
            value={yearlyInr}
            onChange={(e) => setYearlyInr(e.target.value)}
            type="number"
            min="0"
            step="1"
            placeholder="e.g. 28790"
            className="input font-mono tabular-nums"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3 items-end">
          <Field label="Sort order">
            <input value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} type="number" className="input" />
          </Field>
          <label className="inline-flex items-center gap-2 text-sm h-9">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="size-4 rounded border-slate-300" />
            Active (sellable to users)
          </label>
        </div>
        {/* Landing-page marketing controls. Displayed on the public /pricing
            page and on the marketing landing hero. */}
        <div className="pt-3 mt-2 border-t border-slate-200">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
            Landing-page display
          </div>
          <Field label="Features (one per line — bullet on the pricing card)">
            <textarea
              value={features}
              onChange={(e) => setFeatures(e.target.value)}
              rows={5}
              placeholder={"400,000 tokens / month\nUp to 50 assessment orders\nEmail + chat support"}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <Field label="Badge (e.g. “Most popular”)">
              <input
                value={badge}
                onChange={(e) => setBadge(e.target.value)}
                maxLength={60}
                placeholder="Most popular"
                className="input"
              />
            </Field>
            <Field label="Annual discount %">
              <input
                value={annualDiscountPct}
                onChange={(e) => setAnnualDiscountPct(e.target.value)}
                type="number"
                min="0"
                max="90"
                className="input font-mono tabular-nums"
              />
            </Field>
          </div>
          <Field label="Savings note (small print under the annual price)">
            <input
              value={savingsNote}
              onChange={(e) => setSavingsNote(e.target.value)}
              maxLength={200}
              placeholder="Save ₹2,000 with annual billing"
              className="input"
            />
          </Field>
          <label className="inline-flex items-center gap-2 text-sm mt-2">
            <input
              type="checkbox"
              checked={isFeatured}
              onChange={(e) => setIsFeatured(e.target.checked)}
              className="size-4 rounded border-slate-300"
            />
            Featured — highlight this card on the pricing page
          </label>
        </div>
        {err && (
          <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 flex items-start gap-2">
            <AlertTriangle className="size-4 mt-0.5 shrink-0" /> {err}
          </div>
        )}
        <div className="pt-1 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="bt-btn-ghost h-9 px-4 rounded-lg">Cancel</button>
          <button type="submit" disabled={busy || !name.trim()} className="bt-btn-primary h-9 px-5 rounded-lg">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ============================================================ Rates

function RatesTab() {
  const [rows, setRows] = useState<TokenRate[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<TokenRate | null>(null);
  const [creating, setCreating] = useState(false);
  const { confirm, dialog } = useConfirm();

  async function refresh() {
    try { setRows(await api.adminBillingRates()); }
    catch (e: any) { setErr(e?.message ?? "load failed"); }
  }
  useEffect(() => { refresh(); }, []);

  async function doDelete(r: TokenRate) {
    const ok = await confirm({
      title: `Delete rate for ${r.model_slug}?`,
      description: "This removes the row completely. To retire a rate without losing history, toggle `is_active` off instead.",
      tone: "danger",
      confirmLabel: "Delete rate",
    });
    if (!ok) return;
    try { await api.adminBillingDeleteRate(r.id); refresh(); }
    catch (e: any) { toast.error(e?.message ?? "Delete failed"); }
  }

  if (err) return <ErrorBanner msg={err} />;
  if (!rows) return <Loading label="Loading rates…" />;

  return (
    <>
      {dialog}
      <Section
        title="Per-1,000-token rate cards"
        subtitle={`${rows.length} entr${rows.length === 1 ? "y" : "ies"} · Only the active one per model is used for cost calcs`}
        icon={<Coins className="size-4" />}
        action={
          <button onClick={() => setCreating(true)} className="bt-btn-primary h-9 px-4 rounded-lg">
            <Plus className="size-4" /> New rate
          </button>
        }
      >
        {rows.length === 0 ? (
          <Empty label="No rates yet." />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[720px] text-sm admin-table">
              <thead className="bg-slate-50 text-slate-700 text-[11px] font-semibold uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">Model</th>
                  <th className="text-left px-4 py-2.5 font-medium">Provider</th>
                  <th className="text-right px-4 py-2.5 font-medium">Input ₹/1k</th>
                  <th className="text-right px-4 py-2.5 font-medium">Output ₹/1k</th>
                  <th className="text-left px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-4 py-2.5 font-mono text-[12.5px] text-slate-900">
                      {r.model_slug}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{r.provider || "—"}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-800">
                      {r.input_price_per_1k_inr.toFixed(4)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-800">
                      {r.output_price_per_1k_inr.toFixed(4)}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.is_active ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                          <Check className="size-3" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                          <X className="size-3" /> Historic
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <button onClick={() => setEditing(r)} className="p-1.5 rounded-md text-slate-400 hover:text-primary hover:bg-primary/10" title="Edit">
                        <Pencil className="size-3.5" />
                      </button>
                      <button onClick={() => doDelete(r)} className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 ml-1" title="Delete">
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      {creating && <RateEditor initial={null} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); refresh(); }} />}
      {editing && <RateEditor initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
    </>
  );
}

function RateEditor({
  initial, onClose, onSaved,
}: { initial: TokenRate | null; onClose: () => void; onSaved: () => void }) {
  const [slug, setSlug] = useState(initial?.model_slug ?? "");
  const [provider, setProvider] = useState(initial?.provider ?? "");
  const [inp, setInp] = useState(String(initial?.input_price_per_1k_inr ?? "0"));
  const [out, setOut] = useState(String(initial?.output_price_per_1k_inr ?? "0"));
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const body = {
        model_slug: slug.trim(),
        provider: provider.trim() || null,
        input_price_per_1k_inr: Number(inp) || 0,
        output_price_per_1k_inr: Number(out) || 0,
        is_active: isActive,
        notes: notes.trim() || null,
      };
      if (initial) await api.adminBillingPatchRate(initial.id, body);
      else await api.adminBillingCreateRate(body);
      onSaved();
    } catch (e: any) { setErr(e?.message ?? "save failed"); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={initial ? `Edit rate: ${initial.model_slug}` : "New token rate"} onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <Field label="Model slug" required>
          <input value={slug} onChange={(e) => setSlug(e.target.value)}
            placeholder="gemini-2.5-flash" required className="input font-mono" autoFocus />
        </Field>
        <Field label="Provider">
          <input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="gemini | openai | internal" className="input" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Input ₹ per 1,000 tokens" required>
            <input value={inp} onChange={(e) => setInp(e.target.value)} type="number" min="0" step="0.0001" required className="input font-mono tabular-nums" />
          </Field>
          <Field label="Output ₹ per 1,000 tokens" required>
            <input value={out} onChange={(e) => setOut(e.target.value)} type="number" min="0" step="0.0001" required className="input font-mono tabular-nums" />
          </Field>
        </div>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="size-4 rounded border-slate-300" />
          Active (used for cost calc)
        </label>
        <Field label="Notes (source, FX, effective date, …)">
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
          <button type="submit" disabled={busy || !slug.trim()} className="bt-btn-primary h-9 px-5 rounded-lg">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ============================================================ shared

function Field({ label, required, children }: { label: React.ReactNode; required?: boolean; children: React.ReactNode }) {
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
      {/* Cap the card at viewport height and lay it out as a column so a
          long form (the plan editor now has ~12 fields) scrolls its body
          instead of overflowing the screen (which chopped the Save button
          off entirely). Header is sticky so the title/close X stay visible
          while the user scrolls through the fields. */}
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl ring-1 ring-slate-200 overflow-hidden flex flex-col max-h-[calc(100vh-2rem)]">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-slate-900">
            <Sparkles className="size-4 text-primary" /> {title}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function fmt(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 2 : 1) + "k";
  return (n / 1_000_000).toFixed(2) + "M";
}
