import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { ApiError } from "../api";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState("officer1");
  const [password, setPassword] = useState("officer123");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username, password);
      nav("/ask");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <form onSubmit={submit} className="bg-white rounded-xl shadow p-8 w-96 space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">TaxMedha</h1>
          <p className="text-sm text-slate-500">Citation-grounded tax research</p>
        </div>
        <label className="block text-sm">
          Username
          <input className="mt-1 w-full border rounded px-3 py-2" value={username}
                 onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label className="block text-sm">
          Password
          <input type="password" className="mt-1 w-full border rounded px-3 py-2" value={password}
                 onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <div className="text-sm text-red-600">{error}</div>}
        <button disabled={busy}
                className="w-full bg-brand text-white rounded py-2 hover:bg-brand-dark disabled:opacity-50">
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="text-xs text-slate-400">Demo: officer1 / officer123</p>
      </form>
    </div>
  );
}
