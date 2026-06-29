import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Scale,
  ShieldCheck,
  BookText,
  Gavel,
  Mail,
  Lock,
  Loader2,
  ArrowRight,
} from "lucide-react";
import { landingPath, useAuth } from "../auth";
import { ApiError } from "../api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const s = await login(email.trim(), password);
      nav(landingPath(s.role), { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      {/* Brand panel */}
      <div className="hidden lg:flex flex-col justify-between bg-sidebar text-sidebar-foreground p-12">
        <div className="flex items-center gap-2">
          <Scale className="size-7 text-primary" />
          <span className="text-xl font-semibold">BharathTax</span>
        </div>
        <div className="space-y-6 max-w-md">
          <h2 className="text-3xl font-semibold leading-tight">
            Citation-grounded tax research & order drafting for the department.
          </h2>
          <ul className="space-y-3 text-sidebar-foreground/80 text-sm">
            <li className="flex gap-3"><ShieldCheck className="size-5 text-primary shrink-0" /> Answers only from primary law — it refuses rather than hallucinate.</li>
            <li className="flex gap-3"><BookText className="size-5 text-primary shrink-0" /> Every claim cited to the exact section and source.</li>
            <li className="flex gap-3"><Gavel className="size-5 text-primary shrink-0" /> Research, case law, and appeal-order drafting in one place.</li>
          </ul>
        </div>
        <p className="text-xs text-sidebar-foreground/60">Self-hosted · seat-licensed · audit-logged</p>
      </div>

      {/* Form */}
      <div className="flex items-center justify-center p-6 sm:p-8 bg-background">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5">
          <div className="lg:hidden flex items-center gap-2 mb-2">
            <Scale className="size-6 text-primary" />
            <span className="text-lg font-semibold">BharathTax</span>
          </div>
          <div>
            <h1 className="text-2xl font-semibold">Sign in</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Use your email and password.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400 pointer-events-none" />
              <Input
                id="email"
                type="email"
                autoComplete="email"
                className="pl-9"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.gov.in"
                autoFocus
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="p">Password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400 pointer-events-none" />
              <Input
                id="p"
                type="password"
                autoComplete="current-password"
                className="pl-9"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
          </div>
          {error && (
            <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
              {error}
            </div>
          )}
          <Button type="submit" className="w-full" size="lg" disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Signing in…
              </>
            ) : (
              <>Sign in <ArrowRight className="size-4" /></>
            )}
          </Button>
          <div className="text-center text-sm text-slate-600">
            Don't have an account?{" "}
            <Link
              to="/register"
              className="font-semibold text-primary hover:underline"
            >
              Register
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
