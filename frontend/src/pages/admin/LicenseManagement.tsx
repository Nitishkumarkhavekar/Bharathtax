import { useEffect, useMemo, useState } from "react";
import { toast } from "@/lib/toast";
import {
  Plus,
  Pencil,
  Trash2,
  KeyRound,
  Copy,
  PowerOff,
  Check,
  AlertCircle,
  User as UserIcon,
  Calendar,
  Sparkles,
  ShieldCheck,
  PartyPopper,
} from "lucide-react";
import { AdminUser, License, LicenseCreate, LicenseUpdate, api } from "@/api";
import {
  Field,
  FancyTextarea,
  IconInput,
  IconSelect,
  ModalShell,
} from "@/components/admin/Modal";
import { Empty, ErrorBanner, Header, Loading } from "./Dashboard";
import { DonutChart, Section, StatCard } from "@/components/admin/charts";
import { Button } from "@/components/ui/button";

export default function LicenseManagementPage() {
  const [rows, setRows] = useState<License[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<null | License | "new">(null);
  const [copied, setCopied] = useState<number | null>(null);

  // username -> AdminUser for showing nicer "Full Name (@username)" labels in the table.
  const userByUsername = useMemo(() => {
    const m: Record<string, AdminUser> = {};
    for (const u of users) m[u.username] = u;
    return m;
  }, [users]);

  async function refresh() {
    setLoading(true);
    try {
      const [licenseRows, userRows] = await Promise.all([
        api.adminLicenses(),
        api.adminListUsers().catch(() => [] as AdminUser[]),
      ]);
      setRows(licenseRows);
      setUsers(userRows);
    } catch (e: any) {
      setErr(e?.message ?? "failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function copy(key: string, id: number) {
    try {
      await navigator.clipboard.writeText(key);
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* ignore */
    }
  }

  async function deactivate(l: License) {
    if (!confirm(`Deactivate ${l.key}? It will stop working immediately.`)) return;
    try {
      await api.adminDeactivateLicense(l.id);
      await refresh();
      toast.success("License deactivated");
    } catch (e: any) {
      toast.error(e?.message ?? "Action failed");
    }
  }

  async function remove(l: License) {
    if (!confirm(`Permanently delete ${l.key}? Audit history would be lost.`)) return;
    try {
      await api.adminDeleteLicense(l.id);
      await refresh();
      toast.success("License deleted");
    } catch (e: any) {
      toast.error(e?.message ?? "Action failed");
    }
  }

  const counts = {
    active: rows.filter((l) => l.status === "active").length,
    expired: rows.filter((l) => l.status === "expired").length,
    deactivated: rows.filter((l) => l.status === "deactivated").length,
  };

  return (
    <div className="space-y-6 admin-rise">
      <Header
        title="License Key Management"
        subtitle="Issue auto-generated license keys with a validity window. Deactivate or delete revoked keys."
        actions={
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-4" /> Issue key
          </Button>
        }
      />

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 admin-rise">
        <StatCard
          label="Active"
          value={counts.active}
          icon={<KeyRound className="size-4" />}
          accent="green"
          hint="Currently valid keys"
        />
        <StatCard
          label="Expired"
          value={counts.expired}
          icon={<AlertCircle className="size-4" />}
          accent="amber"
          hint="Past valid_until date"
        />
        <StatCard
          label="Deactivated"
          value={counts.deactivated}
          icon={<PowerOff className="size-4" />}
          accent="slate"
          hint="Manually revoked"
        />
      </div>

      {rows.length > 0 && (
        <Section
          title="Status breakdown"
          icon={<KeyRound className="size-4" />}
          subtitle={`${rows.length} total keys issued`}
        >
          <DonutChart
            size={150}
            thickness={18}
            centerLabel={rows.length}
            centerSub="Total keys"
            segments={[
              { label: "Active", value: counts.active, color: "#10b981" },
              { label: "Expired", value: counts.expired, color: "#f59e0b" },
              { label: "Deactivated", value: counts.deactivated, color: "#94a3b8" },
            ]}
          />
        </Section>
      )}

      {err && <ErrorBanner msg={err} />}
      {loading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Section title="Keys">
          <Empty label="No license keys issued yet." />
        </Section>
      ) : (
        <Section title="Keys" subtitle={`${rows.length} record(s)`}>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[680px] text-sm admin-table">
              <thead className="bg-slate-50 text-slate-700 text-[11px] font-semibold uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">Key</th>
                  <th className="text-left px-4 py-2.5 font-medium">Assigned to</th>
                  <th className="text-left px-4 py-2.5 font-medium">Valid until</th>
                  <th className="text-left px-4 py-2.5 font-medium">Status</th>
                  <th className="text-right px-4 py-2.5 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id} className="border-t border-slate-100">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[12.5px] text-slate-900">{l.key}</span>
                        <button
                          onClick={() => copy(l.key, l.id)}
                          className="p-1 rounded hover:bg-slate-100 transition-colors"
                          title="Copy"
                        >
                          {copied === l.id ? (
                            <Check className="size-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="size-3.5 text-slate-400" />
                          )}
                        </button>
                      </div>
                      {l.notes && (
                        <div className="text-[11px] text-slate-500 mt-0.5">{l.notes}</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">
                      <AssigneeCell assignedTo={l.assigned_to} user={l.assigned_to ? userByUsername[l.assigned_to] : undefined} />
                    </td>
                    <td className="px-4 py-2.5 text-slate-800 font-mono text-xs font-medium">
                      {l.valid_until.slice(0, 10)}
                      <div className="text-[10.5px] text-slate-500 font-normal">
                        from {l.valid_from.slice(0, 10)}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={l.status} />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(l)} title="Edit">
                        <Pencil className="size-4" />
                      </Button>
                      {l.status !== "deactivated" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deactivate(l)}
                          title="Deactivate"
                        >
                          <PowerOff className="size-4 text-amber-600" />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => remove(l)} title="Delete">
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
        <LicenseForm
          current={editing === "new" ? null : editing}
          users={users}
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

function AssigneeCell({ assignedTo, user }: { assignedTo: string | null; user?: AdminUser }) {
  if (!assignedTo) return <span className="text-slate-400">—</span>;
  if (user) {
    return (
      <div className="flex items-center gap-2 min-w-0">
        <div className="size-6 shrink-0 rounded-full bg-primary text-white flex items-center justify-center text-[10px] font-semibold uppercase">
          {(user.full_name ?? user.username)[0]}
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-slate-900 truncate">
            {user.full_name ?? user.username}
          </div>
          <div className="text-[10.5px] text-slate-500 truncate">@{user.username}</div>
        </div>
      </div>
    );
  }
  return <span className="font-medium text-slate-700">{assignedTo}</span>;
}

function StatusBadge({ status }: { status: License["status"] }) {
  const map = {
    active: "bg-emerald-100 text-emerald-700",
    expired: "bg-amber-100 text-amber-700",
    deactivated: "bg-slate-200 text-slate-600",
  } as const;
  return (
    <span className={`px-2 py-0.5 rounded text-[11px] font-medium uppercase ${map[status]}`}>
      {status}
    </span>
  );
}

function LicenseForm({
  current,
  users,
  onClose,
  onSaved,
}: {
  current: License | null;
  users: AdminUser[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !current;
  const tomorrow = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const [validUntil, setValidUntil] = useState(
    (current?.valid_until ?? tomorrow).slice(0, 10),
  );
  const [assignedTo, setAssignedTo] = useState(current?.assigned_to ?? "");
  // Two modes for the "Assigned to" field:
  //   - "user"   -> dropdown of system users
  //   - "custom" -> free-text input for orgs / customers not in the user table
  // Default to "user" for new keys; for existing keys, pick "user" if the
  // saved value matches a known username, otherwise "custom".
  const initialAssignMode: "user" | "custom" = isNew
    ? "user"
    : current?.assigned_to && users.some((u) => u.username === current.assigned_to)
      ? "user"
      : current?.assigned_to
        ? "custom"
        : "user";
  const [assignMode, setAssignMode] = useState<"user" | "custom">(initialAssignMode);
  const [notes, setNotes] = useState(current?.notes ?? "");
  const [status, setStatus] = useState<License["status"]>(current?.status ?? "active");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [newlyIssuedKey, setNewlyIssuedKey] = useState<string | null>(null);

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      const validUntilISO = new Date(`${validUntil}T23:59:59Z`).toISOString();
      if (isNew) {
        const body: LicenseCreate = {
          valid_until: validUntilISO,
          assigned_to: assignedTo || undefined,
          notes: notes || undefined,
        };
        const issued = await api.adminCreateLicense(body);
        setNewlyIssuedKey(issued.key);
        toast.success("License key issued");
      } else {
        const body: LicenseUpdate = {
          valid_until: validUntilISO,
          assigned_to: assignedTo || undefined,
          notes: notes || undefined,
          status,
        };
        await api.adminUpdateLicense(current!.id, body);
        toast.success("License updated");
        onSaved();
      }
    } catch (e: any) {
      setErr(e?.message ?? "failed");
    } finally {
      setBusy(false);
    }
  }

  const selectedUser = users.find((u) => u.username === assignedTo);
  const daysFromNow = Math.max(
    0,
    Math.round((new Date(validUntil).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
  );

  // ---- Success state: key issued ----
  if (newlyIssuedKey) {
    return (
      <ModalShell
        open
        onClose={onSaved}
        tone="emerald"
        size="md"
        icon={<PartyPopper className="size-5" />}
        title="License issued successfully"
        subtitle="Share this key with the assignee. You can look it up again in the table."
        footer={
          <Button size="sm" onClick={onSaved}>
            Done
          </Button>
        }
      >
        <div className="space-y-3">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
            <div className="text-[10.5px] uppercase tracking-wider text-emerald-700 font-semibold mb-1">
              New key
            </div>
            <div className="font-mono text-[16px] text-slate-900 tracking-wider break-all">
              {newlyIssuedKey}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              className="flex-1"
              size="sm"
              onClick={() => { navigator.clipboard.writeText(newlyIssuedKey); toast.success("Key copied"); }}
            >
              <Copy className="size-4" /> Copy key to clipboard
            </Button>
          </div>
          {assignedTo && (
            <div className="text-[11.5px] text-slate-500 text-center">
              Assigned to <span className="font-medium text-slate-700">{
                selectedUser ? (selectedUser.full_name ?? selectedUser.username) : assignedTo
              }</span>
              {selectedUser && <span className="text-slate-400"> · @{selectedUser.username}</span>}
              {" · "}
              valid for {daysFromNow} day{daysFromNow === 1 ? "" : "s"}
            </div>
          )}
        </div>
      </ModalShell>
    );
  }

  // ---- Main create/edit form ----
  return (
    <ModalShell
      open
      onClose={onClose}
      tone={isNew ? "primary" : "violet"}
      size="md"
      icon={<KeyRound className="size-5" />}
      title={isNew ? "Issue new license" : `Edit license`}
      subtitle={
        isNew
          ? "Set a validity window, pick an assignee, and we'll mint a fresh key."
          : current?.key
      }
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={busy || (isNew && !validUntil)}>
            {busy ? "Saving…" : isNew ? (
              <>
                <Sparkles className="size-4" /> Issue key
              </>
            ) : (
              "Save changes"
            )}
          </Button>
        </>
      }
    >
      {/* Existing-key callout */}
      {!isNew && current && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 flex items-center gap-3">
          <div className="size-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <KeyRound className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold">
              Key
            </div>
            <div className="font-mono text-[13px] text-slate-900 truncate">{current.key}</div>
          </div>
          <button
            type="button"
            onClick={() => { navigator.clipboard.writeText(current.key); toast.success("Key copied"); }}
            className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500"
            title="Copy key"
          >
            <Copy className="size-4" />
          </button>
        </div>
      )}

      <Field
        label="Valid until"
        required
        hint={
          isNew
            ? `Key will be active for ${daysFromNow} day${daysFromNow === 1 ? "" : "s"}.`
            : undefined
        }
      >
        <IconInput
          icon={<Calendar className="size-4" />}
          type="date"
          value={validUntil}
          onChange={(e) => setValidUntil(e.target.value)}
          min={new Date().toISOString().slice(0, 10)}
        />
      </Field>

      <Field
        label="Assigned to"
        rightSlot={
          <button
            type="button"
            onClick={() => {
              setAssignMode((m) => (m === "user" ? "custom" : "user"));
              setAssignedTo("");
            }}
            className="text-[11px] font-semibold text-primary hover:underline"
          >
            {assignMode === "user" ? "Use custom value…" : "Pick a user instead"}
          </button>
        }
        hint={
          assignMode === "user"
            ? "The key will be linked to this user account."
            : "Use this for an external customer or org not in the user list."
        }
      >
        {assignMode === "user" ? (
          <>
            <IconSelect
              icon={<UserIcon className="size-4" />}
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
            >
              <option value="">— Select a user —</option>
              {users.length === 0 ? (
                <option value="" disabled>
                  (No users available)
                </option>
              ) : (
                users.map((u) => (
                  <option key={u.id} value={u.username}>
                    {(u.full_name ?? u.username) +
                      " (@" + u.username + " · " + u.role.replace("_", " ") + ")"}
                  </option>
                ))
              )}
            </IconSelect>
            {selectedUser && (
              <div className="mt-2 flex items-center gap-2.5 rounded-xl border border-primary/20 bg-primary/[0.04] p-2.5">
                <div className="size-9 shrink-0 rounded-full bg-primary text-white flex items-center justify-center text-xs font-semibold uppercase ring-2 ring-white shadow-sm">
                  {(selectedUser.full_name ?? selectedUser.username)[0]}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-900 truncate">
                    {selectedUser.full_name ?? selectedUser.username}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">
                    @{selectedUser.username} ·{" "}
                    <span className="capitalize">
                      {selectedUser.role.replace("_", " ")}
                    </span>
                    {selectedUser.email ? ` · ${selectedUser.email}` : ""}
                  </div>
                </div>
                <ShieldCheck className="size-4 text-primary/80 shrink-0" />
              </div>
            )}
          </>
        ) : (
          <IconInput
            icon={<UserIcon className="size-4" />}
            value={assignedTo}
            onChange={(e) => setAssignedTo(e.target.value)}
            placeholder="Customer / wing / org name"
            autoFocus
          />
        )}
      </Field>

      <Field label="Notes" hint="Optional · internal context shown only in the admin console.">
        <FancyTextarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Annual subscription for Acme Corp · billed by invoice INV-2026-117"
        />
      </Field>

      {!isNew && (
        <Field label="Status">
          <IconSelect
            icon={<ShieldCheck className="size-4" />}
            value={status}
            onChange={(e) => setStatus(e.target.value as License["status"])}
          >
            <option value="active">Active</option>
            <option value="expired">Expired</option>
            <option value="deactivated">Deactivated</option>
          </IconSelect>
        </Field>
      )}

      {err && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-xs px-3 py-2 flex items-start gap-2">
          <AlertCircle className="size-4 mt-0.5 shrink-0" /> {err}
        </div>
      )}

      {isNew && (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/70 px-3 py-2">
          <Sparkles className="size-3.5 text-slate-400 shrink-0" />
          <div className="text-[11px] text-slate-500">
            Key format:{" "}
            <span className="font-mono tracking-wider text-slate-700">
              BHTX-XXXX-XXXX-XXXX-XXXX
            </span>{" "}
            · generated server-side on submit.
          </div>
        </div>
      )}
    </ModalShell>
  );
}
