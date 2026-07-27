import { Link } from "react-router-dom";
import {
  Scale,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  FileText,
  Search,
  ShieldCheck,
  Users,
  Zap,
  Brain,
  Gavel,
  ChevronDown,
  Plus,
  Minus,
  Quote,
  Mail,
  LineChart,
  Layers,
  Bell,
  MessageSquareText,
  Menu,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

// Marketing landing page — calm, near-white ground, a serif display hero with
// one accent word, twin CTAs, a browser-chromed product preview, then feature
// blocks. Flat surfaces + hairline borders; the type and spacing carry it.

export default function Landing() {
  return (
    <div className="min-h-screen bt-marketing-bg text-slate-900 antialiased overflow-hidden">
      <Nav />
      <Hero />
      <TrustBar />
      <Features />
      <ProductPreview />
      <HowItWorks />
      <Stats />
      <Testimonial />
      <Pricing />
      <FAQ />
      <CTA />
      <Footer />
    </div>
  );
}

// ============================================================== Nav
function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    // Lock body scroll while the mobile drawer is open.
    document.documentElement.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.documentElement.style.overflow = ""; };
  }, [mobileOpen]);

  return (
    <header
      className={
        "sticky top-0 z-40 transition-all " +
        (scrolled ? "bg-white/85 backdrop-blur border-b border-slate-200" : "bg-transparent")
      }
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 h-[64px] sm:h-[68px] flex items-center gap-3 sm:gap-6">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="size-8 rounded-lg bg-primary text-white grid place-items-center shadow-sm ring-1 ring-primary/30">
            <Scale className="size-4.5" />
          </div>
          <span className="text-[17px] sm:text-[18px] font-semibold tracking-tight text-slate-900">BharathTax</span>
        </Link>
        <nav className="hidden lg:flex items-center gap-1 text-[14px] text-slate-700">
          <NavDrop label="Products" items={[
            ["Ask", "AI-cited answers on the Income-tax Act, Rules & CBDT circulars", "#features"],
            ["Appeals", "6-module drafting pipeline for CIT(A) / NFAC orders", "#features"],
            ["Documents", "Upload · index · retrieve — enterprise search over your paper", "#features"],
          ]} />
          <NavDrop label="Solutions" items={[
            ["For CIT(A) benches", "Draft appellate orders in hours, not days", "#use-cases"],
            ["For firms", "Cited memos for every client engagement", "#use-cases"],
            ["For counsel", "Fast, defensible research for court filings", "#use-cases"],
          ]} />
          <NavDrop label="Resources" items={[
            ["Documentation", "Guides and integration references", "#"],
            ["Releases", "Latest desktop-app releases", "/releases"],
            ["Blog", "Coming soon", "#"],
          ]} />
          <NavLink to="#pricing">Pricing</NavLink>
          <NavLink to="/releases">Releases</NavLink>
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
          <div
            className="lg:hidden fixed inset-y-0 right-0 z-50 w-[86%] max-w-sm bg-white shadow-2xl flex flex-col animate-fade-up"
          >
            <div className="h-[64px] px-5 border-b border-slate-200 flex items-center gap-2.5">
              <div className="size-7 rounded-md bg-primary text-white grid place-items-center">
                <Scale className="size-4" />
              </div>
              <span className="text-[16px] font-semibold">BharathTax</span>
              <button
                onClick={() => setMobileOpen(false)}
                className="ml-auto size-9 rounded-md text-slate-600 hover:bg-slate-100 inline-flex items-center justify-center"
                aria-label="Close menu"
              >
                <X className="size-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-4 space-y-1 text-[15px]">
              {[
                ["Features", "#features"],
                ["How it works", "#how-it-works"],
                ["Pricing", "#pricing"],
                ["FAQ", "#faq"],
              ].map(([l, to]) => (
                <a
                  key={l} href={to} onClick={() => setMobileOpen(false)}
                  className="block px-3 py-3 rounded-lg text-slate-800 hover:bg-slate-100 font-medium"
                >
                  {l}
                </a>
              ))}
              <Link
                to="/releases" onClick={() => setMobileOpen(false)}
                className="block px-3 py-3 rounded-lg text-slate-800 hover:bg-slate-100 font-medium"
              >
                Releases
              </Link>
            </nav>
            <div className="p-4 border-t border-slate-200 space-y-2">
              <Link
                to="/register" onClick={() => setMobileOpen(false)}
                className="block w-full text-center h-11 rounded-lg bg-primary text-white font-semibold leading-[44px]"
              >
                Start free trial
              </Link>
              <Link
                to="/login" onClick={() => setMobileOpen(false)}
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
  const external = to.startsWith("#");
  const Cmp: any = external ? "a" : Link;
  const props: any = external ? { href: to } : { to };
  return (
    <Cmp {...props} className="px-3 py-2 rounded-md text-slate-700 hover:text-slate-900 hover:bg-slate-900/5">
      {children}
    </Cmp>
  );
}
function NavDrop({ label, items }: { label: string; items: [string, string, string][] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button className="px-3 py-2 rounded-md text-slate-700 hover:text-slate-900 hover:bg-slate-900/5 inline-flex items-center gap-1">
        {label} <ChevronDown className="size-3.5 text-slate-400" />
      </button>
      {open && (
        <div className="absolute top-full left-0 pt-2 z-30 min-w-[320px]">
          <div className="rounded-xl bg-white ring-1 ring-slate-200 shadow-lg p-2 animate-fade-up">
            {items.map(([t, s, to]) => {
              const external = to.startsWith("#") || to.startsWith("http");
              const Cmp: any = external ? "a" : Link;
              const props: any = external ? { href: to } : { to };
              return (
                <Cmp key={t} {...props} className="block px-3 py-2.5 rounded-lg hover:bg-slate-50 group">
                  <div className="text-[13.5px] font-semibold text-slate-900 group-hover:text-primary">{t}</div>
                  <div className="text-[12px] text-slate-500 leading-snug mt-0.5">{s}</div>
                </Cmp>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================== Hero
function Hero() {
  return (
    <section className="relative">
      <div className="absolute inset-0 bt-dot-grid opacity-40 -z-0" />
      <div className="relative mx-auto max-w-6xl px-4 sm:px-6 pt-14 sm:pt-20 pb-8 text-center">
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-[12.5px] font-semibold ring-1 ring-primary/20">
          <Sparkles className="size-3.5" /> AI-Powered Tax Research & Drafting
        </span>
        <h1 className="mt-6 font-serif text-[38px] sm:text-[58px] lg:text-[72px] leading-[1.05] font-semibold tracking-[-0.02em] text-slate-900">
          More appellate orders,<br />
          <span className="text-primary">with AI.</span>
        </h1>
        <p className="mt-6 text-[16px] sm:text-[18px] text-slate-600 max-w-2xl mx-auto leading-relaxed">
          Draft cited appellate orders, research the Income-tax Act, and generate
          audit-ready decisions using one intelligent platform purpose-built for the
          Income-tax Department, CIT(A) benches, CAs and legal counsel.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/register"
            className="inline-flex items-center gap-2 h-12 px-6 rounded-xl bg-primary text-white text-[15px] font-semibold shadow-sm hover:bg-primary/90 transition-colors"
          >
            Start free trial
          </Link>
          <a
            href="#features"
            className="inline-flex items-center gap-2 h-12 px-6 rounded-xl bg-white text-slate-800 text-[15px] font-semibold ring-1 ring-slate-200 shadow-sm hover:bg-slate-50 transition-colors"
          >
            Request a demo
          </a>
        </div>
        <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] text-slate-600">
          <li className="flex items-center gap-1.5"><CheckCircle2 className="size-4 text-emerald-500" /> No credit card required</li>
          <li className="flex items-center gap-1.5"><CheckCircle2 className="size-4 text-emerald-500" /> Admin-approved accounts</li>
          <li className="flex items-center gap-1.5"><CheckCircle2 className="size-4 text-emerald-500" /> Every claim cited</li>
        </ul>
      </div>
      <HeroPreview />
    </section>
  );
}

// Browser-chromed dashboard mock — sits below the hero copy.
function HeroPreview() {
  return (
    <div className="relative mx-auto max-w-6xl px-4 sm:px-6 mt-10 pb-16 sm:pb-24">
      <div className="rounded-2xl sm:rounded-3xl overflow-hidden ring-1 ring-slate-200 shadow-lg bg-white">
        {/* Fake browser chrome */}
        <div className="h-9 bg-slate-100 border-b border-slate-200 flex items-center px-3 gap-2">
          <div className="flex items-center gap-1.5">
            <span className="size-3 rounded-full bg-rose-400/80" />
            <span className="size-3 rounded-full bg-amber-400/80" />
            <span className="size-3 rounded-full bg-emerald-400/80" />
          </div>
          <div className="ml-4 mx-auto text-[10.5px] sm:text-[11.5px] text-slate-500 bg-white px-2 sm:px-3 py-0.5 rounded-md ring-1 ring-slate-200 max-w-[70%] truncate">
            app.bharattax.wenvia.global/dashboard
          </div>
        </div>
        {/* Dashboard interior — sidebar hides on small screens so the main
            panel gets the full width. */}
        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] min-h-[380px] md:h-[430px]">
          {/* Sidebar */}
          <aside className="hidden md:block border-r border-slate-200 p-3 bg-slate-50/60">
            <div className="flex items-center gap-2 px-2 py-2 mb-3">
              <div className="size-6 rounded-md bg-primary grid place-items-center text-white">
                <Scale className="size-3.5" />
              </div>
              <span className="text-[13px] font-semibold">Wing · I&CI</span>
              <ChevronDown className="ml-auto size-3.5 text-slate-400" />
            </div>
            <SidebarItem icon={<LineChart className="size-4" />} label="Dashboard" active />
            <SidebarItem icon={<Bell className="size-4" />} label="Notifications" />
            <div className="mt-4 text-[10.5px] uppercase tracking-wider text-slate-400 px-2 mb-1">Work</div>
            <SidebarItem icon={<MessageSquareText className="size-4" />} label="Ask" />
            <SidebarItem icon={<Gavel className="size-4" />} label="Appeals" />
            <SidebarItem icon={<FileText className="size-4" />} label="Documents" />
            <SidebarItem icon={<Layers className="size-4" />} label="Rulings" />
            <SidebarItem icon={<Users className="size-4" />} label="Contacts" />
          </aside>
          {/* Main */}
          <div className="p-4 sm:p-6">
            <div className="text-[17px] sm:text-[19px] font-semibold text-slate-900">Welcome back, Officer Sharma</div>
            <div className="text-[12px] sm:text-[12.5px] text-slate-500">Here's what's happening in your wing this week.</div>
            <div className="mt-4 rounded-xl bg-primary text-white p-4 sm:p-5 grid grid-cols-1 md:grid-cols-[1fr_auto] items-center gap-4">
              <div>
                <div className="text-[15px] font-semibold">Build faster appeals with the drafting pipeline</div>
                <div className="text-[12.5px] text-white/85 mt-1">
                  Upload the appeal file, verify facts, then let BharathTax draft the fully-cited order in six modules.
                </div>
                <div className="mt-3 flex gap-2">
                  <span className="inline-flex items-center h-8 px-3 rounded-md bg-white text-primary text-[12.5px] font-semibold">
                    Try Appeals
                  </span>
                  <span className="inline-flex items-center h-8 px-3 rounded-md bg-primary/60 ring-1 ring-white/25 text-[12.5px] font-semibold">
                    Learn more
                  </span>
                </div>
              </div>
              <div className="hidden md:block relative">
                <div className="w-[180px] h-[110px] rounded-lg bg-white/95 ring-1 ring-white/40 p-2 text-slate-800">
                  <div className="text-[10px] font-semibold text-primary uppercase">Notices</div>
                  <div className="mt-1 h-1.5 rounded-full bg-slate-200 relative overflow-hidden">
                    <div className="absolute inset-y-0 left-0 w-2/3 bg-primary rounded-full" />
                  </div>
                  <div className="mt-2 space-y-1">
                    <div className="h-1.5 rounded-full bg-slate-200" />
                    <div className="h-1.5 rounded-full bg-slate-200 w-5/6" />
                    <div className="h-1.5 rounded-full bg-slate-200 w-2/3" />
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3">
              <MockStat label="Open drafts" value="12" />
              <MockStat label="Cited answers" value="286" />
              <MockStat label="This week" value="47" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
function SidebarItem({ icon, label, active }: { icon: React.ReactNode; label: string; active?: boolean }) {
  return (
    <div className={"flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] " + (active ? "bg-primary text-white shadow-sm" : "text-slate-700 hover:bg-slate-100")}>
      {icon}
      {label}
    </div>
  );
}
function MockStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg ring-1 ring-slate-200 bg-white px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-[20px] font-semibold text-slate-900 tabular-nums leading-none mt-1">{value}</div>
    </div>
  );
}

// ============================================================== Trust bar
function TrustBar() {
  const items = [
    "CIT(A) benches", "NFAC", "Chartered accountants", "Legal counsel", "Income-tax Department",
  ];
  return (
    <section className="mx-auto max-w-6xl px-4 sm:px-6 py-10">
      <div className="text-center text-[12px] uppercase tracking-[0.18em] text-slate-500 font-semibold">
        Trusted by tax professionals across
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-10 gap-y-3 text-slate-600 text-[14px] font-medium">
        {items.map((x) => <span key={x} className="opacity-80">{x}</span>)}
      </div>
    </section>
  );
}

// ============================================================== Features
function Features() {
  const cards = [
    { icon: <Search className="size-5" />, title: "Ask, cited from the Act", desc: "Every answer footnoted to the exact section, sub-clause or CBDT circular. No hallucinations, no orphan claims." },
    { icon: <FileText className="size-5" />, title: "Six-module appeal drafting", desc: "Facts, deficiencies, scope, compliance, findings, order — each generated, cited and editable before you sign." },
    { icon: <Brain className="size-5" />, title: "Grounded retrieval", desc: "Statutes, rules and rulings are indexed with citation-preserving chunking. Refuses when the corpus can't support the answer." },
    { icon: <ShieldCheck className="size-5" />, title: "Audit-logged", desc: "Every query and document access is recorded. Seat leases, role-based sections, admin console — control lives with your wing." },
    { icon: <Zap className="size-5" />, title: "Fast where it matters", desc: "Median citation < 4s. Full 6-module order in under 5 minutes on average." },
    { icon: <Users className="size-5" />, title: "Built for teams", desc: "Wing-scoped seat pools, per-officer allowlists, admin-managed licenses and support tickets." },
  ];
  return (
    <section id="features" className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-20">
      <div className="text-center max-w-2xl mx-auto">
        <div className="text-[12px] uppercase tracking-[0.18em] text-primary font-semibold">Features</div>
        <h2 className="mt-2 font-serif text-[26px] sm:text-[40px] font-semibold tracking-tight">Everything your bench needs, in one workspace.</h2>
        <p className="mt-3 text-slate-600">Ask, research, draft and audit — without stitching together six vendors.</p>
      </div>
      <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((c) => (
          <div key={c.title} className="group rounded-2xl bg-white ring-1 ring-slate-200 p-6 hover:ring-primary/30 hover:shadow-lg hover:shadow-primary/10 transition-all">
            <div className="size-10 rounded-xl bg-primary/10 text-primary grid place-items-center mb-4">{c.icon}</div>
            <div className="text-[16px] font-semibold text-slate-900">{c.title}</div>
            <div className="text-[13.5px] text-slate-600 mt-1.5 leading-relaxed">{c.desc}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ============================================================== Product preview blocks
function ProductPreview() {
  return (
    <section className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-20 space-y-16">
      <SplitBlock
        eyebrow="Ask"
        title="Citation-grounded answers, in seconds."
        desc="Every response points at the exact section, rule or circular it relies on. If the corpus can't support the claim, BharathTax refuses — no confident invention."
        bullets={["Answers with inline citations", "Follow-up suggestions", "Domain filters (Income-tax, GST, Companies)"]}
        preview={<AskPreview />}
      />
      <SplitBlock
        reverse
        eyebrow="Appeals"
        title="A drafting pipeline built for CIT(A)."
        desc="Upload the appeal file. BharathTax generates facts, deficiencies, scope, compliance, findings and the order — each editable, each cited, exported to a signable .docx."
        bullets={["6-module pipeline", "Manual + AI edits round-trip through the same doc", "Export to Word or PDF"]}
        preview={<AppealPreview />}
      />
    </section>
  );
}
function SplitBlock({ eyebrow, title, desc, bullets, preview, reverse }: {
  eyebrow: string; title: string; desc: string; bullets: string[]; preview: React.ReactNode; reverse?: boolean;
}) {
  return (
    <div className={"grid lg:grid-cols-2 gap-8 lg:gap-14 items-center " + (reverse ? "lg:[&>*:first-child]:order-2" : "")}>
      <div>
        <div className="text-[12px] uppercase tracking-[0.18em] text-primary font-semibold">{eyebrow}</div>
        <h3 className="mt-2 text-[28px] sm:text-[34px] font-semibold tracking-tight leading-tight">{title}</h3>
        <p className="mt-3 text-slate-600 text-[15px] leading-relaxed">{desc}</p>
        <ul className="mt-5 space-y-2.5">
          {bullets.map((b) => (
            <li key={b} className="flex items-start gap-2 text-[14px] text-slate-700">
              <CheckCircle2 className="size-4 text-emerald-500 mt-0.5 shrink-0" /> {b}
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-2xl overflow-hidden ring-1 ring-slate-200 shadow-md bg-white">
        {preview}
      </div>
    </div>
  );
}
function AskPreview() {
  return (
    <div className="p-5 bg-slate-50/60">
      <div className="rounded-xl bg-white ring-1 ring-slate-200 p-4">
        <div className="text-[12px] text-slate-500 mb-2">bharattax — Chat</div>
        <div className="rounded-full bg-primary text-white text-[13px] px-3 py-1.5 self-start inline-block">
          What is the maximum deduction under section 80C?
        </div>
        <div className="mt-3 flex gap-2">
          <div className="size-6 rounded-full bg-primary/10 text-primary grid place-items-center text-[10px] font-bold">BT</div>
          <div className="text-[13px] text-slate-800 flex-1">
            The maximum aggregate deduction under section 80C is
            <span className="font-semibold"> Rs 1,50,000</span>
            <sup className="text-primary ml-0.5">1</sup> per financial year, covering LIC, EPF, PPF, ELSS and specified other instruments.
          </div>
        </div>
        <div className="mt-3 rounded-lg bg-slate-50 ring-1 ring-slate-200 px-3 py-2 text-[12px] text-slate-700 flex items-center gap-2">
          <span className="font-semibold text-primary">1</span>
          <span>Income-tax Act 1961 · s.80C(1)</span>
          <span className="ml-auto text-primary underline underline-offset-2">source</span>
        </div>
      </div>
    </div>
  );
}
function AppealPreview() {
  const steps = ["Facts", "Deficiencies", "Scope", "Compliance", "Findings", "Order"];
  return (
    <div className="p-5">
      <div className="text-[12px] text-slate-500 mb-2">Appeal · ITA 214 / 2024-25</div>
      <div className="grid grid-cols-3 gap-2">
        {steps.map((s, i) => (
          <div key={s} className={"rounded-lg px-2.5 py-2 text-[12px] font-medium ring-1 " +
            (i < 4 ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : i === 4 ? "bg-primary/10 text-primary ring-primary/25" : "bg-slate-50 text-slate-500 ring-slate-200")}>
            <div className="text-[10px] uppercase tracking-wider opacity-70">Module {i+1}</div>
            {s}
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-xl bg-slate-50 ring-1 ring-slate-200 p-3">
        <div className="text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold">Draft preview</div>
        <div className="mt-2 space-y-1.5">
          <div className="h-1.5 rounded-full bg-slate-200 w-11/12" />
          <div className="h-1.5 rounded-full bg-slate-200 w-full" />
          <div className="h-1.5 rounded-full bg-slate-200 w-9/12" />
          <div className="h-1.5 rounded-full bg-slate-200 w-10/12" />
          <div className="h-1.5 rounded-full bg-slate-200 w-8/12" />
        </div>
      </div>
    </div>
  );
}

// ============================================================== How it works
function HowItWorks() {
  const steps = [
    { n: 1, t: "Sign in", d: "Your admin approves your seat and issues a license. No card, no wait." },
    { n: 2, t: "Ask or upload", d: "Ask a research question, or upload the appeal file for drafting." },
    { n: 3, t: "Review the cites", d: "Every claim is footnoted. Change what you want; leave what you like." },
    { n: 4, t: "Export the order", d: "Signable .docx or fully-formatted PDF. Audit-logged automatically." },
  ];
  return (
    <section id="how-it-works" className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-20">
      <div className="text-center max-w-2xl mx-auto">
        <div className="text-[12px] uppercase tracking-[0.18em] text-primary font-semibold">Workflow</div>
        <h2 className="mt-2 font-serif text-[26px] sm:text-[40px] font-semibold tracking-tight">Four steps, one draft.</h2>
      </div>
      <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {steps.map((s) => (
          <div key={s.n} className="rounded-2xl bg-white ring-1 ring-slate-200 p-6">
            <div className="size-8 rounded-lg bg-primary text-white grid place-items-center font-semibold">{s.n}</div>
            <div className="text-[16px] font-semibold text-slate-900 mt-3">{s.t}</div>
            <div className="text-[13.5px] text-slate-600 mt-1.5 leading-relaxed">{s.d}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ============================================================== Stats
function Stats() {
  const items = [
    ["120k+", "Statutes indexed"],
    ["6-module", "Appeal pipeline"],
    ["<4s", "Median citation"],
    ["100%", "Cited answers"],
  ];
  return (
    <section className="mx-auto max-w-6xl px-4 sm:px-6 py-14">
      <div className="rounded-3xl bg-primary text-white p-6 sm:p-12 shadow-lg grid grid-cols-2 sm:grid-cols-4 gap-6">
        {items.map(([v, l]) => (
          <div key={l}>
            <div className="text-[28px] sm:text-[42px] font-semibold leading-none tabular-nums">{v}</div>
            <div className="text-[12.5px] text-white/85 mt-1.5 uppercase tracking-wider">{l}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ============================================================== Testimonial
function Testimonial() {
  return (
    <section className="mx-auto max-w-4xl px-4 sm:px-6 py-14">
      <div className="rounded-3xl bg-white ring-1 ring-slate-200 p-8 sm:p-12 shadow-md relative">
        <Quote className="absolute top-6 right-6 size-12 text-primary/10" />
        <p className="text-[19px] sm:text-[22px] leading-snug text-slate-800 font-medium">
          "We used to spend three days drafting an order. With BharathTax the first
          full draft is on my screen in under ten minutes — and every citation is
          already there. It changed how our bench works."
        </p>
        <div className="mt-6 flex items-center gap-3">
          <div className="size-11 rounded-full bg-primary grid place-items-center text-white font-semibold">AS</div>
          <div>
            <div className="text-[14px] font-semibold text-slate-900">Anita Sharma</div>
            <div className="text-[12.5px] text-slate-500">CIT(A)-1, I&CI Wing</div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ============================================================== Pricing
function Pricing() {
  const plans = [
    { name: "Free trial", price: "₹0", per: "30 days", desc: "For officers exploring the platform.", features: ["100,000 tokens", "Cited research", "6-module drafting", "Email support"], cta: "Start free trial", to: "/register", featured: false },
    { name: "Wing", price: "Custom", per: "per bench", desc: "Team-wide seat licensing for a CIT(A) bench.", features: ["Everything in Free", "Seat pools & admin console", "Priority support", "SLA & audit logs"], cta: "Talk to sales", to: "mailto:sales@wenvia.global", featured: true },
    { name: "Enterprise", price: "Contact", per: "for scale", desc: "Custom deployment across departments.", features: ["Everything in Wing", "SSO", "On-prem or private cloud", "Dedicated CSM"], cta: "Talk to sales", to: "mailto:sales@wenvia.global", featured: false },
  ];
  return (
    <section id="pricing" className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-20">
      <div className="text-center max-w-2xl mx-auto">
        <div className="text-[12px] uppercase tracking-[0.18em] text-primary font-semibold">Pricing</div>
        <h2 className="mt-2 font-serif text-[26px] sm:text-[40px] font-semibold tracking-tight">Pick the plan that fits.</h2>
        <p className="mt-3 text-slate-600">Free trial with no card. Wing and Enterprise plans scale to your bench.</p>
      </div>
      <div className="mt-10 grid md:grid-cols-3 gap-4">
        {plans.map((p) => (
          <div key={p.name} className={
            "rounded-2xl p-6 flex flex-col " +
            (p.featured
              ? "bg-slate-900 text-white ring-1 ring-slate-900 shadow-lg"
              : "bg-white text-slate-900 ring-1 ring-slate-200")
          }>
            <div className={"text-[13px] uppercase tracking-wider font-semibold " + (p.featured ? "text-primary" : "text-primary")}>{p.name}</div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <div className="text-[34px] font-semibold tracking-tight">{p.price}</div>
              <div className={"text-[13px] " + (p.featured ? "text-white/70" : "text-slate-500")}>· {p.per}</div>
            </div>
            <div className={"text-[13.5px] mt-2 " + (p.featured ? "text-white/80" : "text-slate-600")}>{p.desc}</div>
            <ul className="mt-4 space-y-2 flex-1">
              {p.features.map((f) => (
                <li key={f} className={"flex items-start gap-2 text-[13.5px] " + (p.featured ? "text-white/90" : "text-slate-700")}>
                  <CheckCircle2 className={"size-4 mt-0.5 shrink-0 " + (p.featured ? "text-emerald-300" : "text-emerald-500")} />
                  {f}
                </li>
              ))}
            </ul>
            {p.to.startsWith("mailto:") ? (
              <a href={p.to} className={"mt-6 inline-flex items-center justify-center h-11 rounded-lg font-semibold text-[14px] " + (p.featured ? "bg-primary text-white hover:bg-primary/90" : "bg-slate-900 text-white hover:bg-slate-800")}>
                {p.cta}
              </a>
            ) : (
              <Link to={p.to} className={"mt-6 inline-flex items-center justify-center h-11 rounded-lg font-semibold text-[14px] " + (p.featured ? "bg-primary text-white hover:bg-primary/90" : "bg-slate-900 text-white hover:bg-slate-800")}>
                {p.cta}
              </Link>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// ============================================================== FAQ
function FAQ() {
  const items = [
    ["Where do the citations come from?", "BharathTax indexes the Income-tax Act, Rules, and CBDT circulars. Every answer is anchored to the exact section or clause and the raw source is one click away."],
    ["Is my case data private?", "Yes. Documents you upload are stored in your wing's tenant. Every access is audit-logged. No corpus you upload is used to train shared models."],
    ["What if the corpus can't answer?", "The system refuses rather than confabulate. If the statutes don't support the claim, you'll see a clear 'insufficient support' response — not a made-up citation."],
    ["Which formats can I export?", "Signable Microsoft Word (.docx) and fully-formatted PDF. Both are audit-logged automatically."],
    ["Can I use it offline?", "The desktop app talks to a hosted server for research and drafting, but drafts you generate are stored locally in an Appeal Drafts folder so you always have them on disk."],
  ];
  return (
    <section id="faq" className="mx-auto max-w-3xl px-4 sm:px-6 py-16 sm:py-20">
      <div className="text-center max-w-2xl mx-auto">
        <div className="text-[12px] uppercase tracking-[0.18em] text-primary font-semibold">FAQ</div>
        <h2 className="mt-2 font-serif text-[26px] sm:text-[40px] font-semibold tracking-tight">Answers before you ask.</h2>
      </div>
      <div className="mt-10 space-y-3">
        {items.map(([q, a]) => <FaqItem key={q} q={q} a={a} />)}
      </div>
    </section>
  );
}
function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl bg-white ring-1 ring-slate-200 overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="w-full px-5 py-4 flex items-center gap-3 text-left hover:bg-slate-50">
        <div className="flex-1 font-medium text-slate-900 text-[15px]">{q}</div>
        {open ? <Minus className="size-4 text-slate-500" /> : <Plus className="size-4 text-slate-500" />}
      </button>
      {open && <div className="px-5 pb-4 -mt-1 text-[13.5px] text-slate-600 leading-relaxed">{a}</div>}
    </div>
  );
}

// ============================================================== CTA
function CTA() {
  return (
    <section className="mx-auto max-w-5xl px-4 sm:px-6 py-16">
      <div className="rounded-3xl bg-slate-900 text-white p-10 sm:p-14 text-center relative overflow-hidden ring-1 ring-slate-800">
        <div className="relative">
          <h3 className="text-[24px] sm:text-[36px] font-semibold tracking-tight">
            Ready to draft your next appeal in minutes?
          </h3>
          <p className="mt-3 text-white/80 max-w-xl mx-auto">
            Start a 30-day free trial, no credit card required. Your admin will
            approve the seat and you're in.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link to="/register" className="inline-flex items-center gap-2 h-12 px-6 rounded-xl bg-primary text-white font-semibold text-[15px] shadow-sm hover:bg-primary/90">
              Start free trial <ArrowRight className="size-4" />
            </Link>
            <a href="mailto:sales@wenvia.global" className="inline-flex items-center gap-2 h-12 px-6 rounded-xl bg-white/10 ring-1 ring-white/20 text-white font-semibold text-[15px] hover:bg-white/20">
              Talk to sales
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

// ============================================================== Footer
function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white/70 backdrop-blur">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10 grid sm:grid-cols-4 gap-8 text-[13.5px] text-slate-600">
        <div>
          <div className="flex items-center gap-2 text-slate-900">
            <div className="size-7 rounded-lg bg-primary grid place-items-center text-white"><Scale className="size-4" /></div>
            <span className="font-semibold">BharathTax</span>
          </div>
          <p className="mt-3 text-[12.5px] leading-relaxed">Citation-grounded research and drafting for the Income-tax Department, CIT(A) benches and legal counsel.</p>
        </div>
        <FooterCol title="Product">
          <FooterLink to="#features">Features</FooterLink>
          <FooterLink to="/releases">Releases</FooterLink>
          <FooterLink to="#pricing">Pricing</FooterLink>
        </FooterCol>
        <FooterCol title="Company">
          <FooterLink href="mailto:sales@wenvia.global">Contact sales</FooterLink>
          <FooterLink href="mailto:support@wenvia.global">Contact support</FooterLink>
        </FooterCol>
        <FooterCol title="Legal">
          <FooterLink to="#">Terms</FooterLink>
          <FooterLink to="#">Privacy</FooterLink>
        </FooterCol>
      </div>
      <div className="border-t border-slate-200 py-4 text-center text-[12px] text-slate-500 flex items-center justify-center gap-3">
        <span>&copy; {new Date().getFullYear()} BharathTax</span>
        <span className="text-slate-300">·</span>
        <span className="inline-flex items-center gap-1"><Mail className="size-3" /> hello@bharattax.wenvia.global</span>
      </div>
    </footer>
  );
}
function FooterCol({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11.5px] font-semibold uppercase tracking-wider text-slate-800 mb-2">{title}</div>
      <ul className="space-y-1.5">{children}</ul>
    </div>
  );
}
function FooterLink({ to, href, children }: { to?: string; href?: string; children: React.ReactNode }) {
  if (href) return <li><a href={href} className="hover:text-slate-900">{children}</a></li>;
  const external = (to || "").startsWith("#");
  const Cmp: any = external ? "a" : Link;
  const props: any = external ? { href: to } : { to };
  return <li><Cmp {...props} className="hover:text-slate-900">{children}</Cmp></li>;
}
