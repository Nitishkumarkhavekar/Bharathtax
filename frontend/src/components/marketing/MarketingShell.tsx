import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Scale, Mail, ArrowLeft } from "lucide-react";

// Shared header + footer for the public marketing sub-pages (Contact, Terms,
// Privacy, Docs) so nav + footer stay consistent and every link resolves.

export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-40 bg-white/85 backdrop-blur border-b border-slate-200">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center gap-4">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="size-8 rounded-lg bg-primary text-white grid place-items-center ring-1 ring-primary/20">
            <Scale className="size-4" />
          </div>
          <span className="text-[17px] font-semibold tracking-tight text-slate-900">BharathTax</span>
        </Link>
        <nav className="hidden sm:flex items-center gap-1 text-[14px] text-slate-700 ml-2">
          <Link to="/#features" className="px-3 py-2 rounded-md hover:bg-slate-900/5">Features</Link>
          <Link to="/docs" className="px-3 py-2 rounded-md hover:bg-slate-900/5">Documentation</Link>
          <Link to="/#pricing" className="px-3 py-2 rounded-md hover:bg-slate-900/5">Pricing</Link>
          <Link to="/contact" className="px-3 py-2 rounded-md hover:bg-slate-900/5">Contact</Link>
          <Link to="/releases" className="px-3 py-2 rounded-md hover:bg-slate-900/5">Releases</Link>
        </nav>
        <Link
          to="/login"
          className="ml-auto inline-flex items-center h-9 px-4 rounded-md bg-slate-900 text-white text-[13.5px] font-semibold hover:bg-slate-800 transition-colors"
        >
          Sign in
        </Link>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10 grid sm:grid-cols-4 gap-8 text-[13.5px] text-slate-600">
        <div>
          <div className="flex items-center gap-2 text-slate-900">
            <div className="size-7 rounded-lg bg-primary grid place-items-center text-white"><Scale className="size-4" /></div>
            <span className="font-semibold">BharathTax</span>
          </div>
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
        <span>&copy; {new Date().getFullYear()} BharathTax</span>
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
}: {
  eyebrow?: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#FBFCFD] text-slate-900 antialiased flex flex-col">
      <MarketingHeader />
      <main className="flex-1">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 pt-12 sm:pt-16 pb-6">
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
        <div className="mx-auto max-w-3xl px-4 sm:px-6 pb-20">{children}</div>
      </main>
      <MarketingFooter />
    </div>
  );
}
