import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Scale,
  ShieldCheck,
  BookText,
  Gavel,
  Mail,
  Lock,
  User as UserIcon,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { ApiError, api } from "../api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Register() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const r = await api.register({
        email: email.trim(),
        password,
        full_name: fullName.trim() || undefined,
      });
      setDoneMsg(r.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  // Success state.
  if (doneMsg) {
    return <RegistrationSuccess email={email} message={doneMsg} />;
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
            Create your account in one minute.
          </h2>
          <ul className="space-y-3 text-sidebar-foreground/80 text-sm">
            <li className="flex gap-3">
              <ShieldCheck className="size-5 text-primary shrink-0" />
              Accounts are reviewed by an administrator before access is granted.
            </li>
            <li className="flex gap-3">
              <BookText className="size-5 text-primary shrink-0" />
              You can fill in your organisation and other details from your
              profile once you sign in.
            </li>
            <li className="flex gap-3">
              <Gavel className="size-5 text-primary shrink-0" />
              Once approved, you'll get full access to chat, appeals and document research.
            </li>
          </ul>
        </div>
        <p className="text-xs text-sidebar-foreground/60">Self-hosted · seat-licensed · audit-logged</p>
      </div>

      {/* Form */}
      <div className="flex items-center justify-center p-6 sm:p-8 bg-background">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4">
          <div className="lg:hidden flex items-center gap-2 mb-2">
            <Scale className="size-6 text-primary" />
            <span className="text-lg font-semibold">BharathTax</span>
          </div>
          <div>
            <h1 className="text-2xl font-semibold">Create an account</h1>
            <p className="text-sm text-muted-foreground mt-1">
              An administrator will review your registration before you can sign in.
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
                required
                autoFocus
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="fullName">Full name</Label>
            <div className="relative">
              <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400 pointer-events-none" />
              <Input
                id="fullName"
                className="pl-9"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400 pointer-events-none" />
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                className="pl-9"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min. 6 characters"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm">Confirm password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400 pointer-events-none" />
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                className="pl-9"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Re-enter password"
                required
              />
            </div>
          </div>

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2 flex items-start gap-2">
              <AlertCircle className="size-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button type="submit" className="w-full" size="lg" disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Creating account…
              </>
            ) : (
              "Create account"
            )}
          </Button>

          <div className="text-center text-sm text-slate-600">
            Already have an account?{" "}
            <Link to="/login" className="font-semibold text-primary hover:underline">
              Sign in
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}

function RegistrationSuccess({ email, message }: { email: string; message: string }) {
  const nav = useNavigate();
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden animate-fade-up">
        <div className="bg-gradient-to-br from-emerald-600 via-emerald-500 to-teal-500 text-white px-6 py-6 text-center">
          <div className="mx-auto size-12 rounded-2xl bg-white/15 ring-1 ring-white/30 flex items-center justify-center">
            <CheckCircle2 className="size-6" />
          </div>
          <h2 className="mt-3 text-xl font-semibold tracking-tight">Account created</h2>
          <p className="text-[12.5px] text-white/90 mt-1">
            We've sent your details to the administrator.
          </p>
        </div>
        <div className="p-6 space-y-3 text-sm text-slate-700">
          <p>{message}</p>
          <p className="text-[12.5px] text-slate-500 leading-relaxed">
            You'll be able to sign in with{" "}
            <span className="font-mono">{email}</span> as soon as your account
            is approved. We'll send you a confirmation if email is configured
            on this deployment.
          </p>
          <Button
            className="w-full mt-2"
            onClick={() => nav("/login", { replace: true })}
          >
            Back to sign in
          </Button>
        </div>
      </div>
    </div>
  );
}
