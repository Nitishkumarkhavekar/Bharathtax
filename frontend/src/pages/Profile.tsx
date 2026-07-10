import { FormEvent, useEffect, useState } from "react";
import {
  User as UserIcon,
  Mail,
  Building2,
  ShieldCheck,
  Lock,
  KeyRound,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Pencil,
  Copy,
} from "lucide-react";
import { ApiError, LicenseStatus, Profile as ProfileT, api } from "../api";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/auth";

export default function ProfilePage() {
  const { session } = useAuth();
  const [profile, setProfile] = useState<ProfileT | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .profile()
      .then(setProfile)
      .catch((e: any) => setLoadErr(e?.message ?? "Failed to load profile"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="text-sm text-slate-600 py-10 inline-flex items-center gap-2">
        <Loader2 className="size-4 animate-spin" /> Loading profile…
      </div>
    );
  }
  if (loadErr || !profile) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-sm px-4 py-3 flex items-start gap-2">
        <AlertCircle className="size-4 mt-0.5 shrink-0" /> {loadErr ?? "No profile data"}
      </div>
    );
  }
  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header card */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-[#0b1d36] via-[#13325b] to-[#1c4a85] text-white shadow-md">
        <div className="absolute inset-0 opacity-40 pointer-events-none" aria-hidden>
          <div className="absolute -top-16 -right-12 size-56 rounded-full bg-sky-400/30 blur-3xl" />
          <div className="absolute -bottom-20 -left-10 size-56 rounded-full bg-violet-400/20 blur-3xl" />
        </div>
        <div className="relative px-5 py-5 sm:px-7 sm:py-6 flex flex-wrap items-center gap-4">
          <div className="size-14 rounded-2xl bg-white/15 ring-1 ring-white/25 flex items-center justify-center text-xl font-semibold uppercase">
            {(profile.full_name || profile.username || "?")[0]}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-lg font-semibold tracking-tight">
              {profile.full_name || profile.username}
            </div>
            <div className="text-[12.5px] text-white/85 truncate">{profile.email}</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Pill ok>
                <ShieldCheck className="size-3" />
                {profile.role.replace("_", " ")}
              </Pill>
              <Pill>{profile.approval_status}</Pill>
              {profile.organisation && <Pill>{profile.organisation}</Pill>}
            </div>
          </div>
        </div>
      </div>

      {/* Personal details */}
      <PersonalDetailsCard profile={profile} onSaved={setProfile} />

      {/* License key */}
      <LicenseCard />

      {/* Password change */}
      <ChangePasswordCard />

      {/* Account meta */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-1.5">
          <KeyRound className="size-4 text-primary" /> Account
        </div>
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <Stat label="User ID" value={String(profile.id)} />
          <Stat label="Username" value={"@" + profile.username} />
          <Stat label="Role" value={profile.role.replace("_", " ")} />
          <Stat label="Approval" value={profile.approval_status} />
          <Stat
            label="Member since"
            value={
              profile.created_at
                ? new Date(profile.created_at).toLocaleDateString()
                : "—"
            }
          />
          <Stat label="Status" value={profile.is_active ? "Active" : "Inactive"} />
        </div>
        {session?.role !== "super_admin" && session?.role !== "wing_admin" && (
          <div className="mt-4 text-[11.5px] text-slate-500 leading-relaxed">
            Your role and seat assignment are managed by your administrator.
            Reach out to them if any of these details need to change.
          </div>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- Personal details
function LicenseCard() {
  const [st, setSt] = useState<LicenseStatus | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    api.licenseStatus().then(setSt).catch(() => setSt(null));
  }, []);
  const keyVal = st ? st.license_key || st.pending_key || null : null;
  if (!keyVal) return null;
  function copy() {
    navigator.clipboard
      ?.writeText(keyVal as string)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => {});
  }
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <KeyRound className="size-4 text-primary" />
        <h3 className="text-sm font-semibold text-slate-900">License key</h3>
        {st?.licensed ? (
          <span className="ml-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10.5px] font-semibold">
            <CheckCircle2 className="size-3" /> Active
          </span>
        ) : (
          <span className="ml-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10.5px] font-semibold">
            Not activated
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <code className="flex-1 font-mono text-[15px] font-semibold text-slate-900 tracking-wide select-all break-all">
          {keyVal}
        </code>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-50 ring-1 ring-slate-200 text-[12px] font-medium text-slate-700 hover:bg-slate-100 transition-colors"
        >
          {copied ? (
            <>
              <CheckCircle2 className="size-3.5 text-emerald-600" /> Copied
            </>
          ) : (
            <>
              <Copy className="size-3.5" /> Copy
            </>
          )}
        </button>
      </div>
      <p className="mt-2 text-[11.5px] text-slate-500">
        {st?.licensed
          ? `Activated${
              st?.valid_until
                ? " \u00b7 valid until " + new Date(st.valid_until).toLocaleDateString()
                : ""
            }.`
          : "This key is pre-filled in the activation dialog \u2014 click Activate to start using BharathTax."}
      </p>
    </div>
  );
}


function PersonalDetailsCard({
  profile,
  onSaved,
}: {
  profile: ProfileT;
  onSaved: (p: ProfileT) => void;
}) {
  const [fullName, setFullName] = useState(profile.full_name ?? "");
  const [organisation, setOrganisation] = useState(profile.organisation ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const dirty =
    (fullName ?? "") !== (profile.full_name ?? "") ||
    (organisation ?? "") !== (profile.organisation ?? "");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!dirty || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const updated = await api.updateProfile({
        full_name: fullName,
        organisation,
      });
      onSaved(updated);
      setMsg({ kind: "ok", text: "Profile updated." });
      setTimeout(() => setMsg(null), 2200);
    } catch (e) {
      setMsg({
        kind: "err",
        text: e instanceof ApiError ? e.message : "Update failed",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4"
    >
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
          <Pencil className="size-4 text-primary" /> Personal details
        </div>
        {msg && (
          <span
            className={
              "inline-flex items-center gap-1 text-[12px] font-medium " +
              (msg.kind === "ok" ? "text-emerald-700" : "text-rose-700")
            }
          >
            {msg.kind === "ok" ? (
              <CheckCircle2 className="size-3.5" />
            ) : (
              <AlertCircle className="size-3.5" />
            )}
            {msg.text}
          </span>
        )}
      </div>

      <Field label="Email" hint="Used to sign in. Contact your administrator if it needs to change.">
        <IconWrap icon={<Mail className="size-4" />}>
          <input
            value={profile.email ?? ""}
            readOnly
            className="w-full h-10 rounded-md border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm text-slate-700"
          />
        </IconWrap>
      </Field>

      <Field label="Full name">
        <IconWrap icon={<UserIcon className="size-4" />}>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Your full name"
            className="w-full h-10 rounded-md border border-slate-200 bg-white pl-10 pr-3 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </IconWrap>
      </Field>

      <Field
        label="Organisation"
        hint="Firm, department, company or office you belong to. Visible to you only."
      >
        <IconWrap icon={<Building2 className="size-4" />}>
          <input
            value={organisation}
            onChange={(e) => setOrganisation(e.target.value)}
            placeholder="e.g. Income-tax Department, Mumbai · Acme & Co."
            className="w-full h-10 rounded-md border border-slate-200 bg-white pl-10 pr-3 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </IconWrap>
      </Field>

      <div className="flex justify-end pt-1">
        <Button type="submit" disabled={!dirty || busy}>
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Saving…
            </>
          ) : (
            "Save changes"
          )}
        </Button>
      </div>
    </form>
  );
}

// ----------------------------------------------------------------- Change password
function ChangePasswordCard() {
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (newPw.length < 6) {
      setMsg({ kind: "err", text: "New password must be at least 6 characters." });
      return;
    }
    if (newPw !== confirmPw) {
      setMsg({ kind: "err", text: "Passwords do not match." });
      return;
    }
    setBusy(true);
    try {
      await api.updateProfile({
        current_password: currentPw,
        new_password: newPw,
      });
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
      setMsg({ kind: "ok", text: "Password updated." });
      setTimeout(() => setMsg(null), 2500);
    } catch (e) {
      setMsg({
        kind: "err",
        text: e instanceof ApiError ? e.message : "Update failed",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4"
    >
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
          <Lock className="size-4 text-primary" /> Change password
        </div>
        {msg && (
          <span
            className={
              "inline-flex items-center gap-1 text-[12px] font-medium " +
              (msg.kind === "ok" ? "text-emerald-700" : "text-rose-700")
            }
          >
            {msg.kind === "ok" ? (
              <CheckCircle2 className="size-3.5" />
            ) : (
              <AlertCircle className="size-3.5" />
            )}
            {msg.text}
          </span>
        )}
      </div>

      <Field label="Current password">
        <IconWrap icon={<Lock className="size-4" />}>
          <input
            type="password"
            autoComplete="current-password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            className="w-full h-10 rounded-md border border-slate-200 bg-white pl-10 pr-3 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </IconWrap>
      </Field>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="New password" hint="Minimum 6 characters.">
          <IconWrap icon={<KeyRound className="size-4" />}>
            <input
              type="password"
              autoComplete="new-password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              className="w-full h-10 rounded-md border border-slate-200 bg-white pl-10 pr-3 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </IconWrap>
        </Field>
        <Field label="Confirm new password">
          <IconWrap icon={<KeyRound className="size-4" />}>
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              className="w-full h-10 rounded-md border border-slate-200 bg-white pl-10 pr-3 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </IconWrap>
        </Field>
      </div>

      <div className="flex justify-end pt-1">
        <Button
          type="submit"
          disabled={busy || !currentPw || !newPw || !confirmPw}
        >
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Updating…
            </>
          ) : (
            "Update password"
          )}
        </Button>
      </div>
    </form>
  );
}

// ----------------------------------------------------------------- bits
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-[12.5px] font-semibold text-slate-800 mb-1.5 block">
        {label}
      </label>
      {children}
      {hint && <div className="mt-1.5 text-[11px] text-slate-600">{hint}</div>}
    </div>
  );
}

function IconWrap({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="relative">
      <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
        {icon}
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
      <div className="text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold">
        {label}
      </div>
      <div className="text-sm font-medium text-slate-900 mt-0.5 capitalize">
        {value}
      </div>
    </div>
  );
}

function Pill({ children, ok }: { children: React.ReactNode; ok?: boolean }) {
  return (
    <span
      className={
        "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium ring-1 backdrop-blur " +
        (ok
          ? "bg-emerald-400/20 text-emerald-100 ring-emerald-300/40"
          : "bg-white/15 text-white ring-white/25")
      }
    >
      {children}
    </span>
  );
}
