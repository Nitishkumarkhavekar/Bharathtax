import { Link } from "react-router-dom";
import { Scale, Sparkles } from "lucide-react";

// Shared shell for the public auth pages (login / register / forgot / reset).
// A soft periwinkle-to-cream gradient on the left with a marketing headline,
// a clean centered card on the right holding the form.

export default function AuthShell({
  title, subtitle, children, footer, badge,
}: {
  title: string;
  subtitle?: string;
  badge?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="min-h-screen w-full bt-marketing-bg text-slate-900 antialiased">
      <div className="mx-auto max-w-6xl px-6 h-16 flex items-center">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="size-8 rounded-lg bg-primary text-white grid place-items-center shadow-sm ring-1 ring-primary/30">
            <Scale className="size-4.5" />
          </div>
          <span className="text-[17px] font-semibold tracking-tight">BharatTax</span>
        </Link>
        <div className="ml-auto text-[13px] text-slate-600">
          <Link to="/" className="hover:text-slate-900">← Back to home</Link>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 pt-6 pb-16 grid lg:grid-cols-[1.05fr_0.95fr] gap-12 items-center">
        <div className="hidden lg:block max-w-lg">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-[12px] font-semibold ring-1 ring-primary/20">
            <Sparkles className="size-3.5" /> AI-Powered Tax Research & Drafting
          </span>
          <h1 className="mt-5 text-[42px] xl:text-[50px] font-semibold tracking-tight leading-[1.02]">
            More Appellate Orders <br />
            <span className="text-primary">With AI</span>
          </h1>
          <p className="mt-5 text-[15px] text-slate-600 leading-relaxed">
            Draft cited appellate orders, research the Income-tax Act, and generate
            audit-ready decisions on one intelligent platform.
          </p>
          <ul className="mt-6 space-y-2 text-[13.5px] text-slate-700">
            {["Answers footnoted to the exact section","Six-module CIT(A) drafting pipeline","Wing-scoped seat licensing and audit logs"].map((t) => (
              <li key={t} className="flex items-start gap-2">
                <span className="mt-1.5 size-1.5 rounded-full bg-primary" />
                {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="w-full">
          <div className="mx-auto max-w-[440px] bg-white rounded-2xl ring-1 ring-slate-200 shadow-xl shadow-slate-400/10 p-8">
            {badge && (
              <div className="mb-3">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[11.5px] font-semibold ring-1 ring-emerald-200">
                  <span className="size-1.5 rounded-full bg-emerald-500" /> {badge}
                </span>
              </div>
            )}
            <h2 className="text-[24px] font-semibold tracking-tight text-slate-900">{title}</h2>
            {subtitle && <p className="mt-1 text-[13.5px] text-slate-500">{subtitle}</p>}
            <div className="mt-6">{children}</div>
            {footer && (
              <div className="mt-6 text-center text-[13px] text-slate-600">{footer}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
