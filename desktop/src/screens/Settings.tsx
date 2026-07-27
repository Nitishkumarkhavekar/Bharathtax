import { useEffect, useMemo, useState } from "react";
import { ApiError, api } from "../api";

// Three-tab Settings screen wired into the sidebar. Everything lives in
// electron-store (persisted across launches) except account details which
// live server-side and are patched via /auth/profile.

type TabKey = "account" | "preferences" | "updates";

export default function Settings({ onSignOut }: { onSignOut: () => void }) {
  const [tab, setTab] = useState<TabKey>("account");
  return (
    <div className="w-full h-full flex flex-col px-8 py-6 gap-4">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
        <p className="text-[13.5px] text-slate-500 mt-0.5">
          Manage your account, appearance, notifications, and updates for the desktop app.
        </p>
      </header>

      <nav className="border-b border-slate-200 flex items-center gap-1">
        {(["account", "preferences", "updates"] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)}
            className={"px-4 py-2 -mb-px text-[13.5px] font-medium border-b-2 " +
              (tab === k ? "border-navy-700 text-navy-800" : "border-transparent text-slate-500 hover:text-slate-800")}
          >
            {k === "account" ? "Account" : k === "preferences" ? "Preferences" : "Updates"}
          </button>
        ))}
      </nav>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === "account" && <AccountTab onSignOut={onSignOut} />}
        {tab === "preferences" && <PreferencesTab />}
        {tab === "updates" && <UpdatesTab />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reusable primitives -------------------------------------------------------
// ---------------------------------------------------------------------------

function Card({ title, subtitle, children }: {
  title: string; subtitle?: string; children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl bg-white ring-1 ring-slate-200 shadow-sm p-6 mb-5">
      <div className="mb-4">
        <div className="text-[15px] font-semibold text-slate-900">{title}</div>
        {subtitle && <div className="text-[12.5px] text-slate-500 mt-0.5">{subtitle}</div>}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[220px_1fr] gap-4 items-start">
      <div className="pt-1.5">
        <div className="text-[13.5px] font-medium text-slate-800">{label}</div>
        {hint && <div className="text-[12px] text-slate-500 mt-0.5 leading-snug">{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input {...props}
      className={"w-full max-w-md rounded-md border border-slate-200 px-3 py-2 text-[14px] focus:outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-500/20 " + (props.className || "")} />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props}
      className={"w-full max-w-md rounded-md border border-slate-200 px-3 py-2 text-[14px] bg-white focus:outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-500/20 " + (props.className || "")} />
  );
}

function Toggle({ checked, onChange, label }: {
  checked: boolean; onChange: (v: boolean) => void; label?: string;
}) {
  return (
    <button type="button" onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2.5 group">
      <span className={"relative w-10 h-6 rounded-full transition-colors " + (checked ? "bg-navy-700" : "bg-slate-300")}>
        <span className={"absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform " + (checked ? "translate-x-4" : "translate-x-0")} />
      </span>
      {label && <span className="text-[13.5px] text-slate-700 group-hover:text-slate-900">{label}</span>}
    </button>
  );
}

function Btn({ tone = "primary", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "primary" | "ghost" | "danger";
}) {
  const map: Record<string, string> = {
    primary: "bg-navy-800 text-white hover:bg-navy-700 disabled:opacity-60",
    ghost: "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-60",
    danger: "bg-white text-ashoka-700 ring-1 ring-ashoka-200 hover:bg-ashoka-50 disabled:opacity-60",
  };
  return (
    <button {...rest}
      className={"h-9 px-3.5 rounded-md text-[13.5px] font-semibold " + map[tone] + " " + (rest.className || "")} />
  );
}

function Banner({ kind, children }: { kind: "info" | "success" | "error"; children: React.ReactNode }) {
  const cls =
    kind === "success" ? "bg-emerald-50 text-emerald-800 border-emerald-200"
    : kind === "error" ? "bg-ashoka-50 text-ashoka-700 border-ashoka-200"
    : "bg-navy-50 text-navy-800 border-navy-200";
  return (
    <div className={"text-[13px] px-3 py-2 rounded-md border " + cls}>{children}</div>
  );
}

// ---------------------------------------------------------------------------
// Account tab: profile + password + license + sign out of other devices
// ---------------------------------------------------------------------------
function AccountTab({ onSignOut }: { onSignOut: () => void }) {
  const [me, setMe] = useState<Awaited<ReturnType<typeof api.me>> | null>(null);
  const [fullName, setFullName] = useState("");
  const [designation, setDesignation] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const [lic, setLic] = useState<any>(null);
  const [licBusy, setLicBusy] = useState(false);

  const [otherBusy, setOtherBusy] = useState(false);
  const [otherMsg, setOtherMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const m = await api.me();
        setMe(m);
        setFullName(m.full_name || "");
        setDesignation(m.designation || "");
        setOrganisation(m.organisation || "");
      } catch { /* silent */ }
      refreshLicense();
    })();
  }, []);

  async function refreshLicense() {
    setLicBusy(true);
    try { setLic(await api.licenseStatus({ silent: true })); }
    catch { /* silent */ }
    finally { setLicBusy(false); }
  }

  async function saveProfile() {
    setSavingProfile(true); setProfileMsg(null);
    try {
      await api.updateProfile({
        full_name: fullName.trim(),
        designation: designation.trim(),
        organisation: organisation.trim(),
      });
      setProfileMsg({ kind: "success", text: "Profile updated." });
      const m = await api.me();
      setMe(m);
    } catch (e: any) {
      setProfileMsg({ kind: "error", text: e instanceof ApiError ? e.message : String(e) });
    } finally { setSavingProfile(false); }
  }

  async function savePassword() {
    setPwMsg(null);
    if (!current || !next) { setPwMsg({ kind: "error", text: "Enter both your current and new password." }); return; }
    if (next.length < 6) { setPwMsg({ kind: "error", text: "New password must be at least 6 characters." }); return; }
    if (next !== confirm) { setPwMsg({ kind: "error", text: "The confirmation doesn't match the new password." }); return; }
    setSavingPw(true);
    try {
      await api.updateProfile({ current_password: current, new_password: next });
      setPwMsg({ kind: "success", text: "Password updated. Use it the next time you sign in." });
      setCurrent(""); setNext(""); setConfirm("");
    } catch (e: any) {
      setPwMsg({ kind: "error", text: e instanceof ApiError ? e.message : String(e) });
    } finally { setSavingPw(false); }
  }

  async function signOutOthers() {
    setOtherBusy(true); setOtherMsg(null);
    try {
      const r = await api.logoutOthers();
      setOtherMsg({ kind: "success", text: r.revoked
        ? `Signed out ${r.revoked} other session${r.revoked === 1 ? "" : "s"}.`
        : "You have no other active sessions." });
    } catch (e: any) {
      setOtherMsg({ kind: "error", text: e instanceof ApiError ? e.message : String(e) });
    } finally { setOtherBusy(false); }
  }

  return (
    <>
      <Card title="Profile" subtitle="Displayed on the dashboard and used in exported drafts.">
        <Row label="Username">
          <TextInput value={me?.username || ""} readOnly disabled />
        </Row>
        <Row label="Email">
          <TextInput value={me?.email || "—"} readOnly disabled />
        </Row>
        <Row label="Full name">
          <TextInput value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Anita Sharma" />
        </Row>
        <Row label="Designation" hint="Used on the header and as a signature line on drafts.">
          <TextInput value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="CIT(A)-1 · NFAC" />
        </Row>
        <Row label="Organisation">
          <TextInput value={organisation} onChange={(e) => setOrganisation(e.target.value)} placeholder="Income-tax Department" />
        </Row>
        {profileMsg && <Banner kind={profileMsg.kind}>{profileMsg.text}</Banner>}
        <div className="pt-1">
          <Btn onClick={saveProfile} disabled={savingProfile}>
            {savingProfile ? "Saving…" : "Save profile"}
          </Btn>
        </div>
      </Card>

      <Card title="Password" subtitle="Change the password you use to sign in.">
        <Row label="Current password">
          <TextInput type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </Row>
        <Row label="New password" hint="At least 6 characters.">
          <TextInput type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        </Row>
        <Row label="Confirm new password">
          <TextInput type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </Row>
        {pwMsg && <Banner kind={pwMsg.kind}>{pwMsg.text}</Banner>}
        <div className="pt-1">
          <Btn onClick={savePassword} disabled={savingPw}>
            {savingPw ? "Updating…" : "Update password"}
          </Btn>
        </div>
      </Card>

      <Card title="Sessions" subtitle="A session is created every time you sign in to the desktop or web app.">
        <Row label="Sign out of other devices" hint="Keeps this device signed in; kicks every other open session immediately.">
          <div className="flex items-center gap-2">
            <Btn tone="ghost" onClick={signOutOthers} disabled={otherBusy}>
              {otherBusy ? "Working…" : "Sign out other sessions"}
            </Btn>
            <Btn tone="danger" onClick={onSignOut}>Sign out this device</Btn>
          </div>
        </Row>
        {otherMsg && <Banner kind={otherMsg.kind}>{otherMsg.text}</Banner>}
      </Card>

      <Card title="License" subtitle="Assigned by your administrator. The desktop signs you out automatically if it's deactivated.">
        <Row label="License key">
          <TextInput value={lic?.license_key || "—"} readOnly disabled />
        </Row>
        <Row label="Valid until">
          <TextInput
            value={lic?.valid_until ? new Date(lic.valid_until).toLocaleString([], { dateStyle: "long", timeStyle: "short" }) : "—"}
            readOnly disabled
          />
        </Row>
        <div className="pt-1">
          <Btn tone="ghost" onClick={refreshLicense} disabled={licBusy}>
            {licBusy ? "Refreshing…" : "Refresh license status"}
          </Btn>
        </div>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Preferences tab: theme, density, font scale, sidebar, notifications,
// drafts folder.
// ---------------------------------------------------------------------------
function PreferencesTab() {
  const [prefs, setPrefs] = useState<BharatConfig | null>(null);
  const [draftsRoot, setDraftsRoot] = useState<string>("");

  useEffect(() => {
    (async () => {
      setPrefs(await window.bharat.config.get());
      try { setDraftsRoot(await window.bharat.drafts.root()); } catch { /* silent */ }
    })();
  }, []);

  async function patch(p: Partial<BharatConfig>) {
    const next = await window.bharat.config.set(p);
    setPrefs(next);
    // Broadcast so the shell can re-apply theme / density / font-scale
    // without needing to re-render Settings itself.
    window.dispatchEvent(new CustomEvent("bharat:prefs", { detail: next }));
  }

  if (!prefs) return <div className="text-slate-500 text-sm">Loading preferences…</div>;

  return (
    <>
      <Card title="Appearance" subtitle="Applies immediately across the app.">
        <Row label="Theme" hint="The desktop app is designed for the Income-tax Department's light appearance.">
          <Select value="light" disabled>
            <option value="light">Light</option>
          </Select>
        </Row>
        <Row label="Density" hint="Compact reduces padding across lists and cards.">
          <Select value={prefs.density} onChange={(e) => patch({ density: e.target.value as any })}>
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </Select>
        </Row>
        <Row label="Font scale" hint={`Currently ${Math.round(prefs.fontScale * 100)}%.`}>
          <div className="flex items-center gap-3 max-w-md">
            <input type="range" min={0.85} max={1.25} step={0.05} value={prefs.fontScale}
              onChange={(e) => patch({ fontScale: parseFloat(e.target.value) })}
              className="flex-1"
            />
            <span className="text-[12.5px] text-slate-500 tabular-nums w-10 text-right">
              {Math.round(prefs.fontScale * 100)}%
            </span>
            <Btn tone="ghost" onClick={() => patch({ fontScale: 1 })}>Reset</Btn>
          </div>
        </Row>
      </Card>

      <Card title="Sidebar" subtitle="Controls whether the sidebar opens expanded or collapsed at launch.">
        <Row label="Default state">
          <Select value={prefs.sidebarDefault} onChange={(e) => patch({ sidebarDefault: e.target.value as any })}>
            <option value="last">Remember last</option>
            <option value="expanded">Always expanded</option>
            <option value="collapsed">Always collapsed</option>
          </Select>
        </Row>
      </Card>

      <Card title="Notifications" subtitle="Desktop toasts fire even when the window is minimised.">
        <Row label="Support replies" hint="Toast when an administrator replies to one of your tickets.">
          <Toggle checked={prefs.notifSupport} onChange={(v) => patch({ notifSupport: v })} />
        </Row>
        <Row label="Update ready" hint="Toast when a new version has finished downloading.">
          <Toggle checked={prefs.notifUpdate} onChange={(v) => patch({ notifUpdate: v })} />
        </Row>
        <Row label="Sound" hint="Play the default OS notification sound.">
          <Toggle checked={prefs.notifSound} onChange={(v) => patch({ notifSound: v })} />
        </Row>
      </Card>

      <Card title="Drafts folder" subtitle="Every appeal you draft is saved to a folder on this machine.">
        <Row label="Current location">
          <div className="flex items-stretch gap-2 max-w-2xl">
            <div className="flex-1 inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-navy-700 shrink-0">
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>
              </svg>
              <span className="font-mono text-[13px] text-slate-700 truncate select-all" title={draftsRoot}>
                {draftsRoot || "…"}
              </span>
            </div>
            <button
              type="button"
              onClick={() => window.bharat.drafts.openFolder()}
              className="group inline-flex items-center gap-2 shrink-0 h-auto px-4 py-2 rounded-md
                         bg-gradient-to-b from-navy-700 to-navy-800 text-white font-semibold text-[13.5px]
                         shadow-sm shadow-navy-900/20 ring-1 ring-navy-900/30
                         hover:from-navy-600 hover:to-navy-700 hover:shadow-md hover:shadow-navy-900/30
                         active:from-navy-800 active:to-navy-900
                         transition-all whitespace-nowrap"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                   className="transition-transform group-hover:-translate-y-px">
                <path d="M15 3h6v6"/>
                <path d="M10 14 21 3"/>
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              </svg>
              Open in Explorer
            </button>
          </div>
          <p className="mt-1.5 text-[11.5px] text-slate-500">
            Opens <span className="font-mono text-slate-700">{draftsRoot || "the drafts folder"}</span> in Windows Explorer.
          </p>
        </Row>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Updates tab: current version, check now, channel, auto-install
// ---------------------------------------------------------------------------
function UpdatesTab() {
  const [version, setVersion] = useState<string>("");
  const [prefs, setPrefs] = useState<BharatConfig | null>(null);
  const [state, setState] = useState<UpdaterEvent | null>(null);
  const status = useMemo(() => describeUpdater(state), [state]);

  useEffect(() => {
    window.bharat.app.version().then(setVersion).catch(() => setVersion("unknown"));
    window.bharat.config.get().then(setPrefs).catch(() => {});
    const off = window.bharat.updater.on((ev) => setState(ev));
    return () => { off(); };
  }, []);

  async function patch(p: Partial<BharatConfig>) {
    const next = await window.bharat.config.set(p);
    setPrefs(next);
  }

  if (!prefs) return <div className="text-slate-500 text-sm">Loading…</div>;

  return (
    <>
      <Card title="Version" subtitle="Auto-update checks the server every 30 minutes.">
        <Row label="Installed version">
          <div className="flex items-center gap-3 max-w-md">
            <div className="font-mono text-[14px] px-2 py-1 rounded bg-slate-100 text-slate-800">v{version}</div>
            <Btn tone="ghost" onClick={() => window.bharat.updater.check()}>Check for updates now</Btn>
          </div>
        </Row>
        <Row label="Status">
          <div className={"text-[13px] " + status.tone}>{status.text}</div>
        </Row>
        {state?.kind === "downloaded" && (
          <div className="pt-1">
            <Btn onClick={() => window.bharat.updater.install()}>
              Restart & install v{state.version}
            </Btn>
          </div>
        )}
      </Card>

      <Card title="Behaviour" subtitle="Change how updates are handled once they're available.">
        <Row label="Channel" hint="Stable follows tested releases. Beta pulls new features earlier and may include rough edges.">
          <Select value={prefs.updateChannel} onChange={(e) => patch({ updateChannel: e.target.value as any })}>
            <option value="latest">Stable</option>
            <option value="beta">Beta (early access)</option>
          </Select>
        </Row>
        <Row label="Download automatically" hint="Off = you'll be told a new version exists but nothing is downloaded until you click.">
          <Toggle checked={prefs.autoDownload} onChange={(v) => patch({ autoDownload: v })} />
        </Row>
        <Row label="Install on next quit" hint="Off = each new version prompts before installing.">
          <Toggle checked={prefs.autoInstallOnQuit} onChange={(v) => patch({ autoInstallOnQuit: v })} />
        </Row>
      </Card>
    </>
  );
}

function describeUpdater(ev: UpdaterEvent | null): { text: string; tone: string } {
  if (!ev) return { text: "Idle — the app checks every 30 minutes, or use \"Check for updates now\" to force it.", tone: "text-slate-500" };
  switch (ev.kind) {
    case "checking": return { text: "Checking for updates…", tone: "text-slate-500" };
    case "available": return { text: `Update available — v${ev.version}. Downloading now.`, tone: "text-navy-700" };
    case "not-available": return { text: `You're on the latest version (v${ev.version}).`, tone: "text-emerald-700" };
    case "download-progress": return { text: `Downloading — ${ev.percent}% (${Math.round(ev.bytesPerSecond / 1024)} KB/s)`, tone: "text-navy-700" };
    case "downloaded": return { text: `v${ev.version} is ready. Restart to install.`, tone: "text-emerald-700 font-semibold" };
    case "error": return { text: `Update check failed: ${ev.message}`, tone: "text-ashoka-700" };
  }
}
