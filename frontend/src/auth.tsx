import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api, ApiError, TokenResponse } from "./api";

interface Session {
  username: string;
  fullName: string | null;
  role: string;
  wingId: number;
  features: string[] | null;   // allowed modules; null = all
}
interface AuthCtx {
  session: Session | null;
  loading: boolean;
  login: (u: string, p: string) => Promise<Session>;
  logout: () => Promise<void>;
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
        setSession({ username: me.username, fullName: me.full_name ?? null, role: me.role, wingId: me.wing_id, features: me.features ?? null });
      })
      .catch(() => {
        localStorage.removeItem(KEY);
        localStorage.removeItem(SESS);
        setSession(null);
      })
      .finally(() => setLoading(false));
  }, []);

  // heartbeat keeps the seat lease alive while the tab is open. If the server
  // ever rejects the token (401), drop the session locally — api.ts will also
  // bounce the user to /login.
  useEffect(() => {
    if (!session) return;
    const id = setInterval(async () => {
      const tok = localStorage.getItem(KEY);
      if (!tok) return;
      try {
        const res = await fetch(
          `${import.meta.env.VITE_API_BASE_URL || "http://localhost:8000"}/auth/heartbeat`,
          { method: "POST", headers: { Authorization: `Bearer ${tok}` } },
        );
        if (res.status === 401) {
          localStorage.removeItem(KEY);
          localStorage.removeItem(SESS);
          setSession(null);
          if (!window.location.pathname.startsWith("/login")) window.location.assign("/login");
        }
      } catch {
        /* network blip — ignore */
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [session]);

  async function login(u: string, p: string): Promise<Session> {
    const tok: TokenResponse = await api.login(u, p);
    localStorage.setItem(KEY, tok.access_token);
    // Pull the full profile (incl. allowed modules) so the session is complete.
    const me = await api.me();
    const s: Session = { username: me.username, fullName: me.full_name ?? null, role: me.role, wingId: me.wing_id, features: me.features ?? null };
    localStorage.setItem(SESS, JSON.stringify(s));
    setSession(s);
    return s;
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

  return <Ctx.Provider value={{ session, loading, login, logout }}>{children}</Ctx.Provider>;
}
