import { useEffect, useRef, useState } from "react";
import {
  api, clearSession, forceLogoutWithReason, resetSessionState,
  subscribeSession, type AppealCase,
} from "./api";
import LoginScreen from "./screens/LoginScreen";
import AppealsList from "./screens/AppealsList";
import AppealCaseScreen from "./screens/AppealCase";
import LicenseExpired from "./screens/LicenseExpired";
import Dashboard from "./screens/Dashboard";
import ReportIssue from "./screens/ReportIssue";
import Settings from "./screens/Settings";
import AppShell, { type NavKey } from "./components/AppShell";
import NewCaseDialog from "./components/NewCaseDialog";

type Stage =
  | { kind: "boot" }
  | { kind: "login" }
  | {
      kind: "ready";
      username: string;
      licenseValidUntil: string | null;
      nav: NavKey;
      caseSlug: string | null;
    }
  | { kind: "locked"; reason: string; message: string };

// Apply visual preferences (density / font scale) to the root <html>
// element. Called on boot and whenever Settings dispatches a "bharat:prefs"
// event so a change reflects immediately without a reload.
//
// Theme is intentionally locked to "light" -- the Income-tax Department UI
// is a light-mode design; dark isn't offered.
function applyPreferences(p: Preferences | null | undefined) {
  if (!p) return;
  const html = document.documentElement;
  html.classList.remove("dark");
  html.dataset.density = p.density;
  // Chromium honours `zoom` on the root element — scales every px unit
  // proportionally, which is what officers expect from a font-size slider.
  html.style.zoom = String(p.fontScale || 1);
  // Also stash the raw prefs so AppShell can consult sidebarDefault on mount
  // without a round-trip to main.
  (window as any).__btPrefs = p;
  // If a user had "dark" or "system" saved from an earlier build, quietly
  // migrate them to "light" so the stored preference matches what the UI
  // actually offers.
  if (p.theme !== "light") {
    window.bharat?.config?.set?.({ theme: "light" }).catch(() => {});
  }
}

export default function App() {
  const [stage, setStage] = useState<Stage>({ kind: "boot" });
  const [newCaseOpen, setNewCaseOpen] = useState(false);
  const [supportUnread, setSupportUnread] = useState(0);
  const supportUnreadRef = useRef<number>(0);
  const sessionTokenRef = useRef<string | null>(null);

  // Load stored preferences early so the very first paint has the right
  // theme / font-scale / density. Also subscribe to live prefs changes from
  // the Settings screen.
  useEffect(() => {
    (async () => {
      try {
        const cfg = await window.bharat.config.get();
        applyPreferences(cfg);
      } catch { /* silent */ }
    })();
    const onPrefs = (e: Event) => applyPreferences((e as CustomEvent).detail);
    window.addEventListener("bharat:prefs", onPrefs as EventListener);
    return () => {
      window.removeEventListener("bharat:prefs", onPrefs as EventListener);
    };
  }, []);

  useEffect(() => {
    return subscribeSession((s) => {
      if (s.kind === "expired") {
        setStage({ kind: "locked", reason: s.reason, message: s.message });
      }
    });
  }, []);

  // ------------- desktop session tracking -------------------------------
  async function startSession() {
    try {
      const v = await window.bharat.app.version();
      const r = await api.sessionStart(v);
      sessionTokenRef.current = r.session_token;
    } catch { /* silent */ }
  }
  async function endSession() {
    const tok = sessionTokenRef.current;
    if (!tok) return;
    sessionTokenRef.current = null;
    try { await api.sessionEnd(tok); } catch { /* silent */ }
  }

  // Heartbeat + unread poll + license/session watchdog while signed in.
  // The watchdog is what enforces admin-side license deactivation: if the
  // admin flips the licence to "deactivated" we detect it within 30s and
  // sign the user out. Quota exhaustion and natural licence expiry come back
  // as `state: "blocked"` and DO NOT force a logout -- the user stays signed
  // in and can still use non-paid parts of the app.
  useEffect(() => {
    if (stage.kind !== "ready") return;
    let cancelled = false;

    const checkSession = async () => {
      try {
        const st = await api.sessionStatus({ silent: true });
        if (cancelled) return;
        if (st.state === "logout") {
          await endSession();
          await forceLogoutWithReason(
            st.reason === "user_disabled" ? "unauthorised" : "license",
            st.message || "Your session has been ended by the administrator.",
          );
        }
        // "blocked" -> stay signed in. The individual feature calls will
        // still 402 and surface the token/quota screen when the user actually
        // tries to draft, which is the intended behaviour.
      } catch { /* silent -- next tick will retry */ }
    };

    const bumpUnread = (n: number) => {
      if (n > supportUnreadRef.current) {
        const delta = n - supportUnreadRef.current;
        // Fire an OS toast — main honours the notif-support preference and
        // silently no-ops when the officer has disabled it.
        window.bharat?.notify?.show({
          channel: "support",
          title: "Support reply",
          body: delta === 1
            ? "An administrator replied to your ticket."
            : `${delta} new replies from support.`,
        }).catch(() => {});
      }
      supportUnreadRef.current = n;
      setSupportUnread(n);
    };
    const iv = window.setInterval(async () => {
      const tok = sessionTokenRef.current;
      if (tok) {
        try { await api.sessionHeartbeat(tok, `screen:${stage.nav}`, 0); } catch { /* silent */ }
      }
      try { const r = await api.supportUnreadCount(); bumpUnread(r.unread); } catch { /* silent */ }
      checkSession();
    }, 20000);

    // Immediate checks on nav change so the badge / lockout are fresh.
    (async () => { try { const r = await api.supportUnreadCount(); bumpUnread(r.unread); } catch { /* silent */ } })();
    checkSession();

    // Also re-check whenever the window regains focus so an officer who was
    // away doesn't come back to a stale, deactivated session.
    const onFocus = () => { checkSession(); };
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(iv);
      window.removeEventListener("focus", onFocus);
    };
  }, [stage.kind === "ready" ? stage.nav : ""]);

  // ------------- boot ---------------------------------------------------
  useEffect(() => {
    (async () => {
      const cfg = await window.bharat.config.get();
      if (!cfg.jwt) { setStage({ kind: "login" }); return; }
      try {
        const me = await api.me({ silent: true });
        // We still consult the licence status on boot so the header can show
        // the expiry date, but users no longer activate keys themselves --
        // that's an admin operation. If licence is missing/expired we just
        // continue and let the individual paid features surface the 402.
        let validUntil: string | null = null;
        try {
          const lic = await api.licenseStatus({ silent: true });
          validUntil = lic.valid_until;
        } catch { /* not fatal on boot */ }
        setStage({ kind: "ready", username: me.username, licenseValidUntil: validUntil, nav: "dashboard", caseSlug: null });
        startSession();
      } catch {
        await clearSession();
        setStage({ kind: "login" });
      }
    })();
    const onBeforeUnload = () => { endSession(); };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const handleLoggedIn = async () => {
    try {
      const me = await api.me();
      let validUntil: string | null = null;
      try {
        const lic = await api.licenseStatus({ silent: true });
        validUntil = lic.valid_until;
      } catch { /* not fatal */ }
      setStage({ kind: "ready", username: me.username, licenseValidUntil: validUntil, nav: "dashboard", caseSlug: null });
      startSession();
    } catch { setStage({ kind: "login" }); }
  };

  // ------------- shell nav ----------------------------------------------

  const goDashboard = () => setStage((s) => s.kind === "ready" ? { ...s, nav: "dashboard", caseSlug: null } : s);
  const goAppeals   = () => setStage((s) => s.kind === "ready" ? { ...s, nav: "appeals",   caseSlug: null } : s);
  const goReport    = () => setStage((s) => s.kind === "ready" ? { ...s, nav: "report",    caseSlug: null } : s);
  const goSettings  = () => setStage((s) => s.kind === "ready" ? { ...s, nav: "settings",  caseSlug: null } : s);
  const openCase    = (c: AppealCase) => setStage((s) => s.kind === "ready" ? { ...s, nav: "case", caseSlug: c.slug } : s);

  const handleSignOut = async () => {
    await endSession();
    await clearSession();
    resetSessionState();
    setStage({ kind: "login" });
  };

  // ------------- render --------------------------------------------------

  if (stage.kind === "boot")    return <BootScreen />;
  if (stage.kind === "login")   return <LoginScreen onLoggedIn={handleLoggedIn} />;
  if (stage.kind === "locked")  return (
    <LicenseExpired
      reason={stage.reason}
      message={stage.message}
      onSignIn={() => { resetSessionState(); setStage({ kind: "login" }); }}
    />
  );

  // ready
  return (
    <AppShell
      username={stage.username}
      licenseValidUntil={stage.licenseValidUntil}
      activeKey={stage.nav}
      activeCaseSlug={stage.caseSlug}
      onGoDashboard={goDashboard}
      onGoAppeals={goAppeals}
      onOpenCase={openCase}
      onNewCase={() => setNewCaseOpen(true)}
      onGoReport={goReport}
      onGoSettings={goSettings}
      supportUnread={supportUnread}
      onSignOut={handleSignOut}
    >
      {stage.nav === "dashboard" && (
        <Dashboard
          licenseValidUntil={stage.licenseValidUntil}
          onOpenAppeals={goAppeals}
          onNewCase={() => setNewCaseOpen(true)}
          onOpenCase={openCase}
        />
      )}
      {stage.nav === "appeals" && (
        <AppealsList
          onOpenCase={openCase}
          licenseValidUntil={stage.licenseValidUntil}
          onNewCase={() => setNewCaseOpen(true)}
        />
      )}
      {stage.nav === "case" && stage.caseSlug && (
        <AppealCaseScreen slug={stage.caseSlug} onBack={goAppeals} />
      )}
      {stage.nav === "report" && <ReportIssue />}
      {stage.nav === "settings" && <Settings onSignOut={handleSignOut} />}

      {newCaseOpen && (
        <NewCaseDialog
          onClose={() => setNewCaseOpen(false)}
          onCreated={(c) => { setNewCaseOpen(false); openCase(c); }}
        />
      )}
    </AppShell>
  );
}

function BootScreen() {
  return (
    <div className="min-h-screen grid place-items-center bg-slate-100 text-slate-500">
      <div className="text-center">
        <div className="animate-pulse text-lg font-medium">Loading…</div>
        <div className="text-sm mt-1">Connecting to BharatTax server</div>
      </div>
    </div>
  );
}
