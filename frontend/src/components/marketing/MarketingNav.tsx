import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Menu, X } from "lucide-react";

/**
 * Shared marketing navbar — used by the Landing page and every marketing
 * sub-page (Contact, Terms, Privacy, Docs) via <MarketingShell>. Single
 * source of truth so nav items, dropdowns and mobile drawer stay in sync
 * across the public surface.
 *
 * If you add a link to the homepage nav, it appears on Contact / Terms /
 * Privacy / Docs automatically — no per-page edits.
 */
export function MarketingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.documentElement.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [mobileOpen]);

  return (
    <header
      className={
        "sticky top-0 z-40 transition-all " +
        (scrolled
          ? "bg-white/85 backdrop-blur border-b border-slate-200"
          : "bg-transparent")
      }
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 h-[88px] sm:h-[96px] flex items-center gap-3 sm:gap-6">
        <Link to="/" className="flex items-center">
          <img
            src="/bharattax-logo.png"
            alt="BharatTax"
            className="h-16 sm:h-20 w-auto select-none mix-blend-multiply"
            draggable={false}
          />
        </Link>
        <nav className="hidden lg:flex items-center gap-1 text-[14px] text-slate-700">
          <NavDrop
            label="Products"
            items={[
              ["Ask", "Cited answers on the Income-tax Act, Rules, CBDT circulars & case law", "/#features"],
              ["Appeals", "Six-module drafting pipeline for CIT(A) / NFAC appellate orders", "/#features"],
            ]}
          />
          <NavDrop
            label="Solutions"
            items={[
              ["For chartered accountants", "Cited computations, sale-deed reads, client-ready memos", "/#use-cases"],
              ["For CIT(A) & AOs", "Verification points, questionnaires, and fully-cited draft orders", "/#use-cases"],
              ["For CFOs & counsel", "Board briefs, risk ratings, SC / HC / ITAT case-law research", "/#use-cases"],
              ["For founders & students", "Plain-English answers, worked examples, exam-ready explanations", "/#use-cases"],
            ]}
          />
          <NavDrop
            label="Resources"
            items={[
              ["Documentation", "Getting started & tool guides", "/docs"],
              ["Releases", "Latest desktop-app releases", "/releases"],
              ["Contact", "Talk to sales or support", "/contact"],
            ]}
          />
          <NavLink to="/docs">Documentation</NavLink>
          <NavLink to="/#pricing">Pricing</NavLink>
          <NavLink to="/releases">Releases</NavLink>
          <NavLink to="/contact">Contact</NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Link
            to="/login"
            className="inline-flex items-center h-9 px-3 sm:px-4 rounded-md bg-slate-900 text-white text-[13.5px] font-semibold hover:bg-slate-800 transition-colors shadow-sm"
          >
            Sign in
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="lg:hidden inline-flex items-center justify-center size-9 rounded-md text-slate-700 hover:bg-slate-900/5"
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <>
          <div
            className="lg:hidden fixed inset-0 z-40 bg-slate-900/40"
            onClick={() => setMobileOpen(false)}
          />
          <div className="lg:hidden fixed inset-y-0 right-0 z-50 w-[86%] max-w-sm bg-white shadow-2xl flex flex-col animate-fade-up">
            <div className="h-[76px] px-5 border-b border-slate-200 flex items-center gap-2.5">
              <img
                src="/bharattax-logo.png"
                alt="BharatTax"
                className="h-11 w-auto select-none mix-blend-multiply"
                draggable={false}
              />
              <button
                onClick={() => setMobileOpen(false)}
                className="ml-auto size-9 rounded-md text-slate-600 hover:bg-slate-100 inline-flex items-center justify-center"
                aria-label="Close menu"
              >
                <X className="size-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-4 space-y-1 text-[15px]">
              {([
                ["Features", "/#features"],
                ["How it works", "/#how-it-works"],
                ["Pricing", "/#pricing"],
                ["FAQ", "/#faq"],
              ] as const).map(([l, to]) => (
                <a
                  key={l}
                  href={to}
                  onClick={() => setMobileOpen(false)}
                  className="block px-3 py-3 rounded-lg text-slate-800 hover:bg-slate-100 font-medium"
                >
                  {l}
                </a>
              ))}
              <Link
                to="/docs"
                onClick={() => setMobileOpen(false)}
                className="block px-3 py-3 rounded-lg text-slate-800 hover:bg-slate-100 font-medium"
              >
                Documentation
              </Link>
              <Link
                to="/releases"
                onClick={() => setMobileOpen(false)}
                className="block px-3 py-3 rounded-lg text-slate-800 hover:bg-slate-100 font-medium"
              >
                Releases
              </Link>
              <Link
                to="/contact"
                onClick={() => setMobileOpen(false)}
                className="block px-3 py-3 rounded-lg text-slate-800 hover:bg-slate-100 font-medium"
              >
                Contact
              </Link>
            </nav>
            <div className="p-4 border-t border-slate-200 space-y-2">
              <Link
                to="/register"
                onClick={() => setMobileOpen(false)}
                className="block w-full text-center h-11 rounded-lg bg-primary text-white font-semibold leading-[44px]"
              >
                Start free trial
              </Link>
              <Link
                to="/login"
                onClick={() => setMobileOpen(false)}
                className="block w-full text-center h-11 rounded-lg ring-1 ring-slate-200 text-slate-800 font-semibold leading-[44px]"
              >
                Sign in
              </Link>
            </div>
          </div>
        </>
      )}
    </header>
  );
}

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  // Hash links on the landing page use plain <a> so the browser handles the
  // in-page scroll; everything else uses react-router <Link>.
  const external = to.startsWith("#") || to.startsWith("/#");
  const Cmp: any = external ? "a" : Link;
  const props: any = external ? { href: to } : { to };
  return (
    <Cmp
      {...props}
      className="px-3 py-2 rounded-md text-slate-700 hover:text-slate-900 hover:bg-slate-900/5"
    >
      {children}
    </Cmp>
  );
}

function NavDrop({
  label,
  items,
}: {
  label: string;
  items: readonly (readonly [string, string, string])[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button className="px-3 py-2 rounded-md text-slate-700 hover:text-slate-900 hover:bg-slate-900/5 inline-flex items-center gap-1">
        {label} <ChevronDown className="size-3.5 text-slate-400" />
      </button>
      {open && (
        <div className="absolute top-full left-0 pt-2 z-30 min-w-[320px]">
          <div className="rounded-xl bg-white ring-1 ring-slate-200 shadow-lg p-2 animate-fade-up">
            {items.map(([t, s, to]) => {
              const external = to.startsWith("#") || to.startsWith("/#") || to.startsWith("http");
              const Cmp: any = external ? "a" : Link;
              const props: any = external ? { href: to } : { to };
              return (
                <Cmp
                  key={t}
                  {...props}
                  className="block px-3 py-2.5 rounded-lg hover:bg-slate-50 group"
                >
                  <div className="text-[13.5px] font-semibold text-slate-900 group-hover:text-primary">
                    {t}
                  </div>
                  <div className="text-[12px] text-slate-500 leading-snug mt-0.5">
                    {s}
                  </div>
                </Cmp>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
