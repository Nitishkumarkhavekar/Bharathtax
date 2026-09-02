import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api, ApiError, TokenResponse, API_BASE } from "./api";

interface Session {
  username: string;
  fullName: string | null;
  role: string;
  wingId: number;
  workspaceProfile: string | null;   // primary function / "all" / "custom"; null until picked
  workspaceWings: string[] | null;   // chosen functions when profile === "custom"
  designation: string | null;        // rank/designation key — drives the role desk
  features: string[] | null;   // allowed modules; null = all
}
interface AuthCtx {
  session: Session | null;
  loading: boolean;
  login: (u: string, p: string) => Promise<Session>;
  logout: () => Promise<void>;
  setWorkspaceProfile: (key: string | null, wings?: string[] | null) => void;
}

/**
 * The landing page after login (and the default route).
 * Admins start on the admin dashboard; everyone else goes to the chat.
 */
export function landingPath(role?: string | null): string {
  return role === "super_admin" || role === "wing_admin" ? "/admin/dashboard" : "/ask";
}

const Ctx = createContext<AuthCtx>(null!);
export const useAuth = () => useContext(Ctx);

const KEY = "bharathtax_token";
const SESS = "bharathtax_session";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const raw = localStorage.getItem(SESS);
    const tok = localStorage.getItem(KEY);
    if (!raw || !tok) {
      setLoading(false);
      return;
    }
    // Validate the stored token against the API. If the token has expired,
    // /auth/me returns 401; api.ts will already clear storage + redirect.
    api
      .me()
      .then((me) => {
        const s: Session = { username: me.username, fullName: me.full_name ?? null, role: me.role, wingId: me.wing_id, workspaceProfile: me.workspace_profile ?? null, workspaceWings: me.workspace_wings ?? null, designation: me.designation ?? null, features: me.features ?? null };
        localStorage.setItem(SESS, JSON.stringify(s));
        setSession(s);
      })
      .catch(() => {
        localStorage.removeItem(KEY);
        localStorage.removeItem(SESS);
        setSession(null);
      })
      .finally(() => setLoading(false));
  }, []);

  // heartbeat keeps the seat lease alive while the tab is open. Additionally,
  // we poll the session-status probe so admin actions (license deactivation,
  // account disable) kick the user out within ~60s even if they're just
  // reading a page and never trigger an API 401. Quota exhaustion and licence
  // expiry return state="blocked" -- we leave them signed in for those.
  useEffect(() => {
    if (!session) return;
    const drop = () => {
      localStorage.removeItem(KEY);
      localStorage.removeItem(SESS);
      setSession(null);
      if (!window.location.pathname.startsWith("/login")) window.location.assign("/login");
    };
    const id = setInterval(async () => {
      const tok = localStorage.getItem(KEY);
      if (!tok) return;
      const base = API_BASE;
      try {
        const res = await fetch(`${base}/auth/heartbeat`, {
          method: "POST", headers: { Authorization: `Bearer ${tok}` },
        });
        if (res.status === 401) { drop(); return; }
      } catch { /* network blip — ignore */ }
      try {
        const r = await fetch(`${base}/auth/session/status`, {
          headers: { Authorization: `Bearer ${tok}` },
        });
        if (r.status === 401) { drop(); return; }
        if (r.ok) {
          const j = await r.json();
          if (j?.state === "logout") {
            try { await api.logout(); } catch { /* best-effort */ }
            drop();
          }
        }
      } catch { /* silent */ }
    }, 60_000);
    return () => clearInterval(id);
  }, [session]);

  async function login(u: string, p: string): Promise<Session> {
    const tok: TokenResponse = await api.login(u, p);
    localStorage.setItem(KEY, tok.access_token);
    // Pull the full profile (incl. allowed modules) so the session is complete.
    const me = await api.me();
    const s: Session = { username: me.username, fullName: me.full_name ?? null, role: me.role, wingId: me.wing_id, workspaceProfile: me.workspace_profile ?? null, workspaceWings: me.workspace_wings ?? null, designation: me.designation ?? null, features: me.features ?? null };
    localStorage.setItem(SESS, JSON.stringify(s));
    setSession(s);
    return s;
  }

  function setWorkspaceProfile(key: string | null, wings: string[] | null = null) {
    setSession((prev) => {
      if (!prev) return prev;
      const next = { ...prev, workspaceProfile: key, workspaceWings: key === "custom" ? wings : null };
      localStorage.setItem(SESS, JSON.stringify(next));
      return next;
    });
  }

  async function logout() {
    try {
      await api.logout();
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
    }
    localStorage.removeItem(KEY);
    localStorage.removeItem(SESS);
    setSession(null);
  }

  return <Ctx.Provider value={{ session, loading, login, logout, setWorkspaceProfile }}>{children}</Ctx.Provider>;
}
