import { useEffect, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  IndianRupee,
  TrendingUp,
  CalendarRange,
  Calendar,
  Tag,
  FileText,
  AlertCircle,
} from "lucide-react";
import {
  Field,
  IconInput,
  IconSelect,
  ModalShell,
} from "@/components/admin/Modal";
import { Revenue, RevenueCreate, RevenueUpdate, api } from "@/api";
import { Empty, ErrorBanner, Header, Loading, inr } from "./Dashboard";
import { BarChart, Section, StatCard } from "@/components/admin/charts";
import { Button } from "@/components/ui/button";

export default function RevenueManagementPage() {
  const [rows, setRows] = useState<Revenue[]>([]);
  const [summary, setSummary] = useState<{ by_month: { month: string; amount: number }[] }>({
    by_month: [],
  });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<null | Revenue | "new">(null);

  async function refresh() {
    setLoading(true);
    try {
      const [r, s] = await Promise.all([api.adminRevenue(), api.adminRevenueSummary()]);
      setRows(r);
      setSummary(s);
    } catch (e: any) {
      setErr(e?.message ?? "failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function onDelete(e: Revenue) {
    if (!confirm(`Delete revenue entry of ${inr(e.amount)} from ${e.source}?`)) return;
    try {
      await api.adminDeleteRevenue(e.id);
      await refresh();
    } catch (err: any) {
      alert(err?.message ?? "delete failed");
    }
  }

  const total = rows.reduce((a, r) => a + Number(r.amount), 0);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const thisMonth = rows
    .filter((r) => r.entry_date.slice(0, 7) === currentMonth)
    .reduce((a, r) => a + Number(r.amount), 0);

  const bars = summary.by_month.map((m) => ({
    label: m.month.slice(5), // MM
    value: Math.round(m.amount),
  }));

  return (
    <div className="space-y-6 admin-rise">
      <Header
        title="Revenue Management"
        subtitle="Record and track license sales, subscriptions and other revenue."
        actions={
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-4" /> New entry
          </Button>
        }
      />

      <div className="grid sm:grid-cols-3 gap-4 admin-rise">
        <StatCard
          label="Revenue this month"
          value={inr(thisMonth)}
          hint={currentMonth}
          icon={<IndianRupee className="size-4" />}
          accent="amber"
        />
        <StatCard
          label="Total (visible)"
          value={inr(total)}
          hint={`${rows.length} entries shown`}
          icon={<TrendingUp className="size-4" />}
          accent="green"
        />
        <StatCard
          label="Months covered"
          value={summary.by_month.length}
          hint="Last 12-month rollup"
          icon={<CalendarRange className="size-4" />}
          accent="violet"
        />
      </div>

      <Section
        title="Revenue by month"
        icon={<TrendingUp className="size-4" />}
        subtitle="12-month rollup"
      >
        {bars.length === 0 ? (
          <Empty label="No revenue recorded yet." />
        ) : (
          <BarChart data={bars} height={185} accent="amber" valueFormatter={(v) => inr(v)} />
        )}
      </Section>

      {err && <ErrorBanner msg={err} />}
      {loading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Section title="Entries" icon={<IndianRupee className="size-4" />}>
          <Empty label="No revenue entries yet." />
        </Section>
      ) : (
        <Section title="Entries" icon={<IndianRupee className="size-4" />} subtitle={`${rows.length} record(s)`}>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[620px] text-sm admin-table">
              <thead className="bg-slate-50 text-slate-700 text-[11px] font-semibold uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">Date</th>
                  <th className="text-left px-4 py-2.5 font-medium">Source</th>
                  <th className="text-left px-4 py-2.5 font-medium">Description</th>
                  <th className="text-right px-4 py-2.5 font-medium">Amount</th>
                  <th className="text-right px-4 py-2.5 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-4 py-2.5 text-slate-600 font-mono text-xs">
                      {r.entry_date.slice(0, 10)}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-slate-900">{r.source}</td>
                    <td className="px-4 py-2.5 text-slate-600">{r.description ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-slate-900">
                      {r.currency === "INR" ? inr(Number(r.amount)) : `${r.amount} ${r.currency}`}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => onDelete(r)}>
                        <Trash2 className="size-4 text-rose-600" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {editing && (
        <RevenueForm
          current={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function RevenueForm({
  current,
  onClose,
  onSaved,
}: {
  current: Revenue | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !current;
  const [date, setDate] = useState(
    (current?.entry_date ?? new Date().toISOString()).slice(0, 10),
  );
  const [source, setSource] = useState(current?.source ?? "License sale");
  const [description, setDescription] = useState(current?.description ?? "");
  const [amount, setAmount] = useState(String(current?.amount ?? ""));
  const [currency, setCurrency] = useState(current?.currency ?? "INR");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      const amt = Number(amount);
      if (!amt || amt <= 0) throw new Error("Amount must be positive");
      const body: RevenueCreate | RevenueUpdate = {
        entry_date: new Date(date).toISOString(),
        source,
        description: description || undefined,
        amount: amt,
        currency,
      };
      if (isNew) await api.adminCreateRevenue(body as RevenueCreate);
      else await api.adminUpdateRevenue(current!.id, body);
      onSaved();
    } catch (e: any) {
      setErr(e?.message ?? "failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell
      open
      onClose={onClose}
      tone="amber"
      size="md"
      icon={<IndianRupee className="size-5" />}
      title={isNew ? "New revenue entry" : "Edit revenue entry"}
      subtitle={
        isNew
          ? "Record a license sale, subscription or other income event."
          : "Update the amount, date or details of this entry."
      }
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={busy}>
            {busy ? "Saving…" : isNew ? "Add entry" : "Save changes"}
          </Button>
        </>
      }
    >
      <Field label="Date" required>
        <IconInput
          icon={<Calendar className="size-4" />}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </Field>

      <Field label="Source" required hint="Short category for grouping in reports.">
        <IconInput
          icon={<Tag className="size-4" />}
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="License sale / Subscription / Consulting"
        />
      </Field>

      <Field label="Description" hint="Optional · invoice ref, customer note, etc.">
        <IconInput
          icon={<FileText className="size-4" />}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Annual subscription — Acme Corp"
        />
      </Field>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <Field label="Amount" required>
            <IconInput
              icon={<IndianRupee className="size-4" />}
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="font-mono"
              placeholder="15000.00"
            />
          </Field>
        </div>
        <Field label="Currency">
          <IconSelect
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            <option value="INR">INR</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </IconSelect>
        </Field>
      </div>

      {err && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-xs px-3 py-2 flex items-start gap-2">
          <AlertCircle className="size-4 mt-0.5 shrink-0" /> {err}
        </div>
      )}
    </ModalShell>
  );
}
