import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Mail, ArrowLeft } from "lucide-react";
import { MarketingNav } from "./MarketingNav";

// Shared header + footer for the public marketing sub-pages (Contact, Terms,
// Privacy, Docs) so nav + footer stay consistent and every link resolves.

// Header now delegates to MarketingNav — the same rich nav (Products /
// Solutions / Resources dropdowns + mobile drawer) used by the homepage,
// so every marketing page has identical navigation.
export function MarketingHeader() {
  return <MarketingNav />;
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10 grid sm:grid-cols-4 gap-8 text-[13.5px] text-slate-600">
        <div>
          <img
            src="/bharattax-logo.png"
            alt="BharatTax"
            className="h-10 w-auto select-none mix-blend-multiply"
            draggable={false}
          />
          <p className="mt-3 text-[12.5px] leading-relaxed">
            Citation-grounded research and drafting for the Income-tax Department,
            CIT(A) benches and legal counsel.
          </p>
        </div>
        <FooterCol title="Product">
          <FooterLink to="/#features">Features</FooterLink>
          <FooterLink to="/#pricing">Pricing</FooterLink>
          <FooterLink to="/releases">Releases</FooterLink>
          <FooterLink to="/docs">Documentation</FooterLink>
        </FooterCol>
        <FooterCol title="Company">
          <FooterLink to="/contact">Contact us</FooterLink>
          <FooterLink to="/#use-cases">Use cases</FooterLink>
        </FooterCol>
        <FooterCol title="Legal">
          <FooterLink to="/terms">Terms of Service</FooterLink>
          <FooterLink to="/privacy">Privacy Policy</FooterLink>
        </FooterCol>
      </div>
      <div className="border-t border-slate-200 py-4 text-center text-[12px] text-slate-500 flex items-center justify-center gap-3 flex-wrap px-4">
        <span>&copy; {new Date().getFullYear()} BharatTax</span>
        <span className="text-slate-300">·</span>
        <span className="inline-flex items-center gap-1"><Mail className="size-3" /> hello@bharattax.wenvia.global</span>
      </div>
    </footer>
  );
}

function FooterCol({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[11.5px] font-semibold uppercase tracking-wider text-slate-800 mb-2">{title}</div>
      <ul className="space-y-1.5">{children}</ul>
    </div>
  );
}
function FooterLink({ to, children }: { to: string; children: ReactNode }) {
  return <li><Link to={to} className="hover:text-slate-900">{children}</Link></li>;
}

// Full-page wrapper for a content sub-page: header, a titled hero, the body,
// and the footer. Keeps every marketing page visually consistent.
export function MarketingShell({
  eyebrow,
  title,
  intro,
  children,
  wide = false,
}: {
  eyebrow?: string;
  title: string;
  intro?: string;
  children: ReactNode;
  // Default max-w-3xl (768px) is right for prose (Terms, Privacy, Docs).
  // Set wide=true for pages that host a two-column layout — Contact's form
  // + channels sidebar — where 768px is too cramped.
  wide?: boolean;
}) {
  const widthCls = wide ? "max-w-5xl" : "max-w-3xl";
  return (
    <div className="min-h-screen bg-[#FBFCFD] text-slate-900 antialiased flex flex-col">
      <MarketingHeader />
      <main className="flex-1">
        <div className={`mx-auto ${widthCls} px-4 sm:px-6 pt-12 sm:pt-16 pb-6`}>
          <Link to="/" className="inline-flex items-center gap-1 text-[13px] text-slate-500 hover:text-slate-800 mb-6">
            <ArrowLeft className="size-3.5" /> Back to home
          </Link>
          {eyebrow && (
            <div className="text-[12px] uppercase tracking-[0.18em] text-primary font-semibold">{eyebrow}</div>
          )}
          <h1 className="mt-2 font-serif text-[32px] sm:text-[42px] font-semibold tracking-[-0.02em] leading-[1.08] text-slate-900">
            {title}
          </h1>
          {intro && <p className="mt-4 text-[16px] text-slate-600 leading-relaxed">{intro}</p>}
        </div>
        <div className={`mx-auto ${widthCls} px-4 sm:px-6 pb-20`}>{children}</div>
      </main>
      <MarketingFooter />
    </div>
  );
}
