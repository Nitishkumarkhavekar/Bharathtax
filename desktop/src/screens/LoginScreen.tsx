import { useState } from "react";
import { api, ApiError, setJwt } from "../api";

interface Props {
  onLoggedIn: () => void;
}

export default function LoginScreen({ onLoggedIn }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!email.trim() || !password) {
      setErr("Enter your email and password.");
      return;
    }
    setBusy(true);
    try {
      const r = await api.login(email.trim(), password);
      await setJwt(r.access_token, r.expires_at);
      onLoggedIn();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message;
      setErr(msg || "Sign in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 grid place-items-center p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-slate-200 p-8"
      >
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-slate-800">Sign in</h1>
          <p className="text-sm text-slate-500 mt-1">
            Use your BharatTax account. Your license and token balance stay on
            the server.
          </p>
        </div>

        <label className="block text-sm font-medium text-slate-700 mb-1">
          Email
        </label>
        <input
          type="email"
          autoComplete="username"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-brand-500"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="officer@example.gov.in"
          disabled={busy}
        />

        <label className="block text-sm font-medium text-slate-700 mb-1">
          Password
        </label>
        <input
          type="password"
          autoComplete="current-password"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-brand-500"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
        />

        {err && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mb-4">
            {err}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <p className="text-xs text-slate-500 mt-4 text-center">
          No account? Ask your administrator to register one on the BharatTax web
          portal.
        </p>
      </form>
    </div>
  );
}
