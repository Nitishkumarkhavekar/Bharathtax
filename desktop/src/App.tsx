import { useEffect, useState } from "react";
import { api, clearSession, resetSessionState, subscribeSession } from "./api";
import LoginScreen from "./screens/LoginScreen";
import LicenseScreen from "./screens/LicenseScreen";
import AppealFlow from "./screens/AppealFlow";
import LicenseExpired from "./screens/LicenseExpired";
import SettingsBar from "./components/SettingsBar";

type Stage =
  | { kind: "boot" }
  | { kind: "login" }
  | { kind: "license"; pendingKey: string | null }
  | { kind: "ready"; username: string; licenseValidUntil: string | null }
  | { kind: "locked"; reason: string; message: string };

export default function App() {
  const [stage, setStage] = useState<Stage>({ kind: "boot" });

  // Global lockout listener — any 401/402/403/network error from api.ts
  // pushes us to the locked screen with a friendly message.
  useEffect(() => {
    return subscribeSession((s) => {
      if (s.kind === "expired") {
        setStage({ kind: "locked", reason: s.reason, message: s.message });
      }
    });
  }, []);

  // Boot: if we already have a JWT, jump straight to license/ready. Otherwise
  // send the user to login.
  useEffect(() => {
    (async () => {
      const cfg = await window.bharat.config.get();
      if (!cfg.jwt) {
        setStage({ kind: "login" });
        return;
      }
      try {
        const me = await api.me({ silent: true });
        const lic = await api.licenseStatus({ silent: true });
        if (lic.required && !lic.licensed) {
          setStage({ kind: "license", pendingKey: lic.pending_key ?? null });
        } else {
          setStage({
            kind: "ready",
            username: me.username,
            licenseValidUntil: lic.valid_until,
          });
        }
      } catch {
        // Silent probe failed — treat as logged out.
        await clearSession();
        setStage({ kind: "login" });
      }
    })();
  }, []);

  const handleLoggedIn = async () => {
    // After a fresh login, decide license vs ready.
    try {
      const me = await api.me();
      const lic = await api.licenseStatus();
      if (lic.required && !lic.licensed) {
        setStage({ kind: "license", pendingKey: lic.pending_key ?? null });
      } else {
        setStage({
          kind: "ready",
          username: me.username,
          licenseValidUntil: lic.valid_until,
        });
      }
    } catch {
      setStage({ kind: "login" });
    }
  };

  const handleLicenseActivated = async () => {
    try {
      const me = await api.me();
      const lic = await api.licenseStatus();
      setStage({
        kind: "ready",
        username: me.username,
        licenseValidUntil: lic.valid_until,
      });
    } catch {
      setStage({ kind: "login" });
    }
  };

  const handleSignOut = async () => {
    await clearSession();
    resetSessionState();
    setStage({ kind: "login" });
  };

  return (
    <div className="min-h-screen flex flex-col">
      <SettingsBar
        username={stage.kind === "ready" ? stage.username : null}
        onSignOut={stage.kind === "ready" ? handleSignOut : undefined}
      />

      <main className="flex-1 flex items-stretch">
        {stage.kind === "boot" && <BootScreen />}
        {stage.kind === "login" && <LoginScreen onLoggedIn={handleLoggedIn} />}
        {stage.kind === "license" && (
          <LicenseScreen
            pendingKey={stage.pendingKey}
            onActivated={handleLicenseActivated}
            onSignOut={handleSignOut}
          />
        )}
        {stage.kind === "ready" && (
          <AppealFlow
            username={stage.username}
            licenseValidUntil={stage.licenseValidUntil}
          />
        )}
        {stage.kind === "locked" && (
          <LicenseExpired
            reason={stage.reason}
            message={stage.message}
            onSignIn={() => {
              resetSessionState();
              setStage({ kind: "login" });
            }}
          />
        )}
      </main>
    </div>
  );
}

function BootScreen() {
  return (
    <div className="flex-1 grid place-items-center text-slate-500">
      <div className="text-center">
        <div className="animate-pulse text-lg font-medium">Loading…</div>
        <div className="text-sm mt-1">Connecting to BharatTax server</div>
      </div>
    </div>
  );
}
