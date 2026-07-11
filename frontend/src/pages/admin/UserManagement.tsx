import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  ShieldCheck,
  Users,
  Search,
  User as UserIcon,
  Mail,
  Building2,
  AlertCircle,
  KeyRound,
  Check,
  X as XIcon,
  Clock as ClockIcon,
} from "lucide-react";
import { AdminRole, AdminUser, AdminUserCreate, AdminUserUpdate, api } from "@/api";
import { useAuth } from "@/auth";
import { Empty, ErrorBanner, Header, Loading } from "./Dashboard";
import { Section, StatCard } from "@/components/admin/charts";
import {
  Field,
  IconInput,
  IconSelect,
  ModalShell,
} from "@/components/admin/Modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Wing {
  id: number;
  name: string;
  code: string;
  seat_limit: number;
}

interface Props {
  mode: "users" | "admins";
}

const ROLES_USER: AdminRole[] = ["officer", "auditor"];
const ROLES_ADMIN: AdminRole[] = ["super_admin", "wing_admin"];

// Gateable user-facing modules (mirror of backend deps.ALL_FEATURES).
const MODULES: { key: string; label: string }[] = [
  { key: "chat", label: "Chat" },
  { key: "appeals", label: "Appeals" },
  { key: "rulings", label: "Case Law" },
  { key: "documents", label: "Documents" },
  { key: "history", label: "History" },
];
const ALL_MODULE_KEYS = MODULES.map((m) => m.key);

type StatusTab = "all" | "pending" | "approved" | "rejected";

export default function UserManagement({ mode }: Props) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [wings, setWings] = useState<Wing[]>([]);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<StatusTab>(mode === "users" ? "pending" : "all");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showForm, setShowForm] = useState<null | AdminUser | "new">(null);

  const isAdminMode = mode === "admins";
  const allowedRoles = isAdminMode ? ROLES_ADMIN : ROLES_USER;
  const title = isAdminMode ? "Admin Management" : "User Management";
  const subtitle = isAdminMode
    ? "Manage super admins and wing admins."
    : "Manage all user accounts. New registrations land in the Pending tab — approve or reject them here.";

  async function refresh() {
    setLoading(true);
    try {
      const [all, wgs] = await Promise.all([api.adminListUsers(), api.wings()]);
      // Filter by role-class (user vs admin) client-side; backend doesn't have
      // a "class" param, just a single-role filter, and we want either pair.
      setUsers(
        all.filter((u) =>
          isAdminMode ? ROLES_ADMIN.includes(u.role) : ROLES_USER.includes(u.role),
        ),
      );
      setWings(wgs as Wing[]);
    } catch (e: any) {
      setErr(e?.message ?? "failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const pendingCount = useMemo(
    () => users.filter((u) => u.approval_status === "pending").length,
    [users],
  );

  const visible = useMemo(() => {
    const t = q.toLowerCase();
    return users.filter((u) => {
      if (tab !== "all" && u.approval_status !== tab) return false;
      if (!t) return true;
      return (
        u.username.toLowerCase().includes(t) ||
        (u.full_name ?? "").toLowerCase().includes(t) ||
        (u.email ?? "").toLowerCase().includes(t)
      );
    });
  }, [users, q, tab]);

  async function onDelete(u: AdminUser) {
    if (!confirm(`Delete ${u.username}? This cannot be undone.`)) return;
    try {
      await api.adminDeleteUser(u.id);
      await refresh();
    } catch (e: any) {
      alert(e?.message ?? "delete failed");
    }
  }

  async function onApprove(u: AdminUser) {
    try {
      await api.adminApproveUser(u.id);
      await refresh();
    } catch (e: any) {
      alert(e?.message ?? "approve failed");
    }
  }

  async function onReject(u: AdminUser) {
    if (!confirm(`Reject ${u.email ?? u.username}? They won't be able to sign in.`)) return;
    try {
      await api.adminRejectUser(u.id);
      await refresh();
    } catch (e: any) {
      alert(e?.message ?? "reject failed");
    }
  }

  const activeCount = users.filter((u) => u.is_active).length;

  return (
    <div className="space-y-6 admin-rise">
      <Header
        title={title}
        subtitle={subtitle}
        actions={
          <Button size="sm" onClick={() => setShowForm("new")}>
            <Plus className="size-4" /> {isAdminMode ? "New admin" : "New user"}
          </Button>
        }
      />

      <div className="grid sm:grid-cols-4 gap-4 admin-rise">
        <StatCard
          label={isAdminMode ? "Total admins" : "Total users"}
          value={users.length}
          icon={isAdminMode ? <ShieldCheck className="size-4" /> : <Users className="size-4" />}
          accent={isAdminMode ? "rose" : "blue"}
          hint={`${activeCount} active`}
        />
        <StatCard
          label="Pending approval"
          value={pendingCount}
          icon={<ClockIcon className="size-4" />}
          accent="amber"
          hint="Waiting for your review"
        />
        <StatCard label="Active" value={activeCount} accent="green" hint="Can sign in now" />
        <StatCard
          label="Inactive"
          value={users.length - activeCount}
          accent="slate"
          hint="Disabled / rejected"
        />
      </div>

      {!isAdminMode && pendingCount > 0 && tab !== "pending" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-800 px-4 py-3 flex items-center gap-2.5">
          <ClockIcon className="size-4" />
          <span className="text-sm font-medium flex-1">
            {pendingCount} user{pendingCount === 1 ? "" : "s"} waiting for approval.
          </span>
          <Button size="sm" variant="outline" onClick={() => setTab("pending")}>
            Review now
          </Button>
        </div>
      )}

      <Section
        title={isAdminMode ? "All admins" : "All users"}
        subtitle={`${visible.length} ${visible.length === 1 ? "record" : "records"} shown`}
        action={
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-2.5 size-4 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search…"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        }
      >
        {/* Status tabs */}
        <div className="flex flex-wrap items-center gap-1.5 mb-3 -mt-2">
          {([
            { key: "all", label: "All", count: users.length },
            { key: "pending", label: "Pending", count: pendingCount },
            { key: "approved", label: "Approved", count: users.filter((u) => u.approval_status === "approved").length },
            { key: "rejected", label: "Rejected", count: users.filter((u) => u.approval_status === "rejected").length },
          ] as { key: StatusTab; label: string; count: number }[]).map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-colors " +
                  (active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200")
                }
              >
                {t.label}
                <span
                  className={
                    "rounded-full px-1.5 py-0.5 text-[10.5px] font-mono " +
                    (active ? "bg-white/20" : "bg-white text-slate-700 ring-1 ring-slate-200")
                  }
                >
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>

        {err && <ErrorBanner msg={err} />}
        {loading ? (
          <Loading />
        ) : visible.length === 0 ? (
          <Empty
            label={
              tab === "pending"
                ? "No pending registrations."
                : isAdminMode
                  ? "No admins yet."
                  : "No users yet."
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[640px] text-sm admin-table">
              <thead className="bg-slate-50 text-slate-700 text-[11px] font-semibold uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">User</th>
                  <th className="text-left px-4 py-2.5 font-medium">Email</th>
                  <th className="text-left px-4 py-2.5 font-medium">Role</th>
                  <th className="text-left px-4 py-2.5 font-medium">Wing</th>
                  <th className="text-left px-4 py-2.5 font-medium">Status</th>
                  <th className="text-right px-4 py-2.5 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((u) => {
                  const wing = wings.find((w) => w.id === u.wing_id);
                  const isPending = u.approval_status === "pending";
                  return (
                    <tr key={u.id} className="border-t border-slate-100">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <div className="size-9 rounded-full bg-gradient-to-br from-primary to-primary/60 text-white flex items-center justify-center text-xs font-semibold uppercase ring-2 ring-white shadow-sm">
                            {(u.full_name ?? u.username)[0]}
                          </div>
                          <div>
                            <div className="font-medium text-slate-900">
                              {u.full_name ?? u.username}
                            </div>
                            <div className="text-xs text-slate-500">@{u.username}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">{u.email ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        <RoleBadge role={u.role} />
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {wing ? `${wing.name} (${wing.code})` : `#${u.wing_id}`}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusBadge u={u} />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {isPending ? (
                          <div className="inline-flex items-center gap-1.5">
                            <Button
                              size="sm"
                              className="bg-emerald-600 hover:bg-emerald-700 text-white"
                              onClick={() => onApprove(u)}
                            >
                              <Check className="size-3.5" /> Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-rose-200 text-rose-700 hover:bg-rose-50"
                              onClick={() => onReject(u)}
                            >
                              <XIcon className="size-3.5" /> Reject
                            </Button>
                          </div>
                        ) : (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => setShowForm(u)} title="Edit">
                              <Pencil className="size-4" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => onDelete(u)} title="Delete">
                              <Trash2 className="size-4 text-rose-600" />
                            </Button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {showForm && (
        <UserForm
          current={showForm === "new" ? null : showForm}
          wings={wings}
          allowedRoles={allowedRoles}
          onClose={() => setShowForm(null)}
          onSaved={async () => {
            setShowForm(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function StatusBadge({ u }: { u: AdminUser }) {
  if (u.approval_status === "pending") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800">
        <ClockIcon className="size-3" /> Pending
      </span>
    );
  }
  if (u.approval_status === "rejected") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-100 text-rose-800">
        <XIcon className="size-3" /> Rejected
      </span>
    );
  }
  if (!u.is_active) {
    return <Badge variant="secondary">Inactive</Badge>;
  }
  return (
    <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 gap-1">
      <span className="size-1.5 rounded-full bg-emerald-500" />
      Active
    </Badge>
  );
}

export function RoleBadge({ role }: { role: AdminRole }) {
  const map: Record<AdminRole, { label: string; cls: string }> = {
    super_admin: { label: "Super Admin", cls: "bg-rose-100 text-rose-700" },
    wing_admin: { label: "Wing Admin", cls: "bg-amber-100 text-amber-700" },
    officer: { label: "Officer", cls: "bg-sky-100 text-sky-700" },
    auditor: { label: "Auditor", cls: "bg-indigo-100 text-indigo-700" },
  };
  const x = map[role] ?? { label: role, cls: "bg-slate-100 text-slate-700" };
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${x.cls}`}
    >
      {role.includes("admin") ? (
        <ShieldCheck className="size-3" />
      ) : (
        <Users className="size-3" />
      )}
      {x.label}
    </span>
  );
}

function UserForm({
  current,
  wings,
  allowedRoles,
  onClose,
  onSaved,
}: {
  current: AdminUser | null;
  wings: Wing[];
  allowedRoles: AdminRole[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { session } = useAuth();
  const isSuper = session?.role === "super_admin";
  const isNew = !current;
  const [username, setUsername] = useState(current?.username ?? "");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState(current?.full_name ?? "");
  const [email, setEmail] = useState(current?.email ?? "");
  const [role, setRole] = useState<AdminRole>(current?.role ?? allowedRoles[0]);
  // Wings can be extended inline (super admins only), so keep a local copy.
  const [wingList, setWingList] = useState<Wing[]>(wings);
  const [wingId, setWingId] = useState<number>(current?.wing_id ?? wings[0]?.id ?? 0);
  const [addingWing, setAddingWing] = useState(false);
  const [newWingName, setNewWingName] = useState("");
  const [newWingCode, setNewWingCode] = useState("");
  const [newWingSeats, setNewWingSeats] = useState("0");
  const [wingBusy, setWingBusy] = useState(false);
  const [wingErr, setWingErr] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(current?.is_active ?? true);

  async function createWing() {
    setWingErr(null);
    if (!newWingName.trim() || !newWingCode.trim()) {
      setWingErr("Name and code are required.");
      return;
    }
    setWingBusy(true);
    try {
      const w = await api.adminCreateWing({
        name: newWingName.trim(),
        code: newWingCode.trim(),
        seat_limit: Number(newWingSeats) || 0,
      });
      setWingList((prev) => [...prev, w as Wing]);
      setWingId(w.id);
      setAddingWing(false);
      setNewWingName("");
      setNewWingCode("");
      setNewWingSeats("0");
    } catch (e: any) {
      setWingErr(e?.message ?? "Could not create wing.");
    } finally {
      setWingBusy(false);
    }
  }
  // Module access. null (all) -> everything checked; else the allotted subset.
  const [features, setFeatures] = useState<string[]>(current?.features ?? ALL_MODULE_KEYS);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      if (isNew) {
        if (!username || !password) throw new Error("username and password required");
        const body: AdminUserCreate = {
          username,
          password,
          full_name: fullName || undefined,
          email: email || undefined,
          role,
          wing_id: wingId,
          features,
        };
        await api.adminCreateUser(body);
      } else {
        const body: AdminUserUpdate = {
          full_name: fullName || undefined,
          email: email || undefined,
          role,
          wing_id: wingId,
          is_active: isActive,
          features,
        };
        if (password) body.password = password;
        await api.adminUpdateUser(current!.id, body);
      }
      onSaved();
    } catch (e: any) {
      setErr(e?.message ?? "failed");
    } finally {
      setBusy(false);
    }
  }

  const isAdminRole = role.includes("admin");

  return (
    <ModalShell
      open
      onClose={onClose}
      tone={isAdminRole ? "rose" : "primary"}
      size="lg"
      icon={isAdminRole ? <ShieldCheck className="size-5" /> : <UserIcon className="size-5" />}
      title={isNew ? (isAdminRole ? "Create admin" : "Create user") : `Edit ${current!.username}`}
      subtitle={
        isNew
          ? "Set up the account, role and wing. Password can be reset later."
          : "Update details, role, wing or reset the password."
      }
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={busy}>
            {busy ? "Saving…" : isNew ? "Create account" : "Save changes"}
          </Button>
        </>
      }
    >
      {isNew && (
        <Field label="Username" required>
          <IconInput
            icon={<UserIcon className="size-4" />}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="officer3"
            autoFocus
          />
        </Field>
      )}

      <Field
        label={isNew ? "Password" : "New password"}
        required={isNew}
        hint={isNew ? "Minimum 8 characters recommended." : "Leave blank to keep the current password."}
      >
        <IconInput
          icon={<KeyRound className="size-4" />}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={isNew ? "Choose a strong password" : "Leave blank to keep current"}
        />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Full name">
          <IconInput
            icon={<UserIcon className="size-4" />}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Officer Three"
          />
        </Field>
        <Field label="Email">
          <IconInput
            icon={<Mail className="size-4" />}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.gov.in"
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Role" required hint="Determines access and the admin features available.">
          <IconSelect
            icon={<ShieldCheck className="size-4" />}
            value={role}
            onChange={(e) => setRole(e.target.value as AdminRole)}
          >
            {allowedRoles.map((r) => (
              <option key={r} value={r}>
                {r.replace("_", " ")}
              </option>
            ))}
          </IconSelect>
        </Field>
        <Field
          label="Wing"
          required
          rightSlot={
            isSuper && !addingWing ? (
              <button
                type="button"
                onClick={() => {
                  setAddingWing(true);
                  setWingErr(null);
                }}
                className="text-[11.5px] font-medium text-primary hover:underline inline-flex items-center gap-0.5"
              >
                <Plus className="size-3" /> New wing
              </button>
            ) : undefined
          }
        >
          {addingWing ? (
            <div className="rounded-lg border border-primary/30 bg-primary/[0.03] p-2.5 space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  autoFocus
                  value={newWingName}
                  onChange={(e) => setNewWingName(e.target.value)}
                  placeholder="Wing name"
                  className="sm:col-span-2 h-9 rounded-md border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
                <input
                  value={newWingCode}
                  onChange={(e) => setNewWingCode(e.target.value.toUpperCase())}
                  placeholder="CODE"
                  className="h-9 rounded-md border border-slate-200 bg-white px-2.5 text-sm uppercase focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  value={newWingSeats}
                  onChange={(e) => setNewWingSeats(e.target.value)}
                  placeholder="Seats"
                  title="Concurrent-session seat pool for this wing"
                  className="h-9 w-24 rounded-md border border-slate-200 bg-white px-2.5 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
                <span className="text-[11px] text-slate-500">seats</span>
                <div className="ml-auto flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setAddingWing(false);
                      setWingErr(null);
                    }}
                    className="text-xs px-2.5 py-1.5 rounded-md text-slate-600 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={createWing}
                    disabled={wingBusy}
                    className="text-xs px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                  >
                    {wingBusy ? "Adding…" : "Add wing"}
                  </button>
                </div>
              </div>
              {wingErr && <div className="text-[11px] text-rose-600">{wingErr}</div>}
            </div>
          ) : (
            <IconSelect
              icon={<Building2 className="size-4" />}
              value={wingId}
              onChange={(e) => setWingId(Number(e.target.value))}
            >
              {wingList.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.code})
                </option>
              ))}
            </IconSelect>
          )}
        </Field>
      </div>

      {!isNew && (
        <label className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5 cursor-pointer hover:bg-slate-50">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="size-4 accent-emerald-500"
          />
          <div className="flex-1">
            <div className="text-sm font-medium text-slate-800 flex items-center gap-1.5">
              <CheckCircle2 className="size-4 text-emerald-500" /> Account active
            </div>
            <div className="text-[11px] text-slate-500">
              When off, the user cannot log in or hold a seat lease.
            </div>
          </div>
        </label>
      )}

      {!isAdminRole && (
        <Field
          label="Sections this user can access"
          hint="Uncheck any the user shouldn't see. Applies on their next page load; admins are never restricted."
        >
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
            <div className="flex items-center gap-2 pb-2 mb-2 border-b border-slate-200">
              <button type="button" onClick={() => setFeatures(ALL_MODULE_KEYS)} className="text-[11.5px] font-medium text-primary hover:underline">
                Provide all
              </button>
              <span className="text-slate-300">·</span>
              <button type="button" onClick={() => setFeatures([])} className="text-[11.5px] font-medium text-slate-500 hover:underline">
                Clear
              </button>
              <span className="ml-auto text-[11px] text-slate-400">{features.length}/{ALL_MODULE_KEYS.length} allotted</span>
            </div>
            <div className="grid grid-cols-2 gap-1">
              {MODULES.map((m) => {
                const on = features.includes(m.key);
                return (
                  <label key={m.key} className="flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer hover:bg-white">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) =>
                        setFeatures((f) => (e.target.checked ? [...new Set([...f, m.key])] : f.filter((x) => x !== m.key)))
                      }
                      className="size-4 accent-primary"
                    />
                    <span className="text-[13px] text-slate-700">{m.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </Field>
      )}

      {err && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-xs px-3 py-2 flex items-start gap-2">
          <AlertCircle className="size-4 mt-0.5 shrink-0" /> {err}
        </div>
      )}
    </ModalShell>
  );
}
