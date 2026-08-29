import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";

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
    <div className="min-h-screen flex flex-col w-full bt-marketing-bg text-slate-900 antialiased">
      <header className="shrink-0 mx-auto w-full max-w-6xl px-6 h-24 flex items-center">
        <Link to="/" className="flex items-center">
          <img
            src="/bharattax-logo.png"
            alt="BharatTax"
            className="h-16 w-auto select-none mix-blend-multiply"
            draggable={false}
          />
        </Link>
        <div className="ml-auto text-[13px] text-slate-600">
          <Link to="/" className="hover:text-slate-900">← Back to home</Link>
        </div>
      </header>

      {/* flex-1 + items-center centres the form in the space below the header,
          so small content never forces a scrollbar; it only scrolls if the form
          genuinely can't fit a very short viewport. */}
      <main className="flex-1 flex items-center px-6 py-6">
      <div className="mx-auto w-full max-w-6xl grid lg:grid-cols-[1.05fr_0.95fr] gap-12 items-center">
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
            {[
              { t: "Answers footnoted to the exact section", tone: "bg-primary" },
              { t: "Six-module CIT(A) drafting pipeline", tone: "bg-brand-orange" },
              { t: "Wing-scoped seat licensing and audit logs", tone: "bg-brand-green" },
            ].map(({ t, tone }) => (
              <li key={t} className="flex items-start gap-2">
                <span className={`mt-1.5 size-1.5 rounded-full ${tone}`} />
                {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="w-full">
          <div className="mx-auto max-w-[440px] bg-white rounded-2xl ring-1 ring-slate-200/80 shadow-[0_2px_24px_rgba(15,23,42,0.05)] p-8">
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
      </main>
    </div>
  );
}
