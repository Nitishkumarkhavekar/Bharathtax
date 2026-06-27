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
} from "lucide-react";
import { AdminRole, AdminUser, AdminUserCreate, AdminUserUpdate, api } from "@/api";
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

export default function UserManagement({ mode }: Props) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [wings, setWings] = useState<Wing[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showForm, setShowForm] = useState<null | AdminUser | "new">(null);

  const isAdminMode = mode === "admins";
  const allowedRoles = isAdminMode ? ROLES_ADMIN : ROLES_USER;
  const title = isAdminMode ? "Admin Management" : "User Management";
  const subtitle = isAdminMode
    ? "Manage super admins and wing admins."
    : "Manage officers and auditors.";

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

  const filtered = useMemo(() => {
    if (!q.trim()) return users;
    const t = q.toLowerCase();
    return users.filter(
      (u) =>
        u.username.toLowerCase().includes(t) ||
        (u.full_name ?? "").toLowerCase().includes(t) ||
        (u.email ?? "").toLowerCase().includes(t),
    );
  }, [users, q]);

  async function onDelete(u: AdminUser) {
    if (!confirm(`Delete ${u.username}? This cannot be undone.`)) return;
    try {
      await api.adminDeleteUser(u.id);
      await refresh();
    } catch (e: any) {
      alert(e?.message ?? "delete failed");
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

      <div className="grid sm:grid-cols-3 gap-4 admin-rise">
        <StatCard
          label={isAdminMode ? "Total admins" : "Total users"}
          value={users.length}
          icon={isAdminMode ? <ShieldCheck className="size-4" /> : <Users className="size-4" />}
          accent={isAdminMode ? "rose" : "blue"}
          hint={`${activeCount} active`}
        />
        <StatCard
          label="Active"
          value={activeCount}
          accent="green"
          hint="With active=True"
        />
        <StatCard
          label="Inactive"
          value={users.length - activeCount}
          accent="slate"
          hint="Disabled accounts"
        />
      </div>

      <Section
        title={isAdminMode ? "All admins" : "All users"}
        subtitle={`${filtered.length} ${filtered.length === 1 ? "record" : "records"} shown`}
        action={
          <div className="relative w-64">
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
        {err && <ErrorBanner msg={err} />}
        {loading ? (
          <Loading />
        ) : filtered.length === 0 ? (
          <Empty label={isAdminMode ? "No admins yet." : "No users yet."} />
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-sm admin-table">
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
                {filtered.map((u) => {
                  const wing = wings.find((w) => w.id === u.wing_id);
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
                      <td className="px-4 py-2.5 text-slate-600">{u.email ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        <RoleBadge role={u.role} />
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {wing ? `${wing.name} (${wing.code})` : `#${u.wing_id}`}
                      </td>
                      <td className="px-4 py-2.5">
                        {u.is_active ? (
                          <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 gap-1">
                            <span className="size-1.5 rounded-full bg-emerald-500" />
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Inactive</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setShowForm(u)}
                          title="Edit"
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onDelete(u)}
                          title="Delete"
                        >
                          <Trash2 className="size-4 text-rose-600" />
                        </Button>
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
  const isNew = !current;
  const [username, setUsername] = useState(current?.username ?? "");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState(current?.full_name ?? "");
  const [email, setEmail] = useState(current?.email ?? "");
  const [role, setRole] = useState<AdminRole>(current?.role ?? allowedRoles[0]);
  const [wingId, setWingId] = useState<number>(current?.wing_id ?? wings[0]?.id ?? 0);
  const [isActive, setIsActive] = useState(current?.is_active ?? true);
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
        };
        await api.adminCreateUser(body);
      } else {
        const body: AdminUserUpdate = {
          full_name: fullName || undefined,
          email: email || undefined,
          role,
          wing_id: wingId,
          is_active: isActive,
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
        <Field label="Wing" required>
          <IconSelect
            icon={<Building2 className="size-4" />}
            value={wingId}
            onChange={(e) => setWingId(Number(e.target.value))}
          >
            {wings.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.code})
              </option>
            ))}
          </IconSelect>
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

      {err && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-xs px-3 py-2 flex items-start gap-2">
          <AlertCircle className="size-4 mt-0.5 shrink-0" /> {err}
        </div>
      )}
    </ModalShell>
  );
}
