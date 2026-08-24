import { Link, useLocation } from "react-router-dom";
import {
  Scale,
  Sparkles,
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  FileText,
  Search,
  ShieldCheck,
  Users,
  Brain,
  Gavel,
  Plus,
  Minus,
  Mail,
  BookOpen,
  Calculator,
  MessageSquareText,
  PenSquare,
  CalendarClock,
  Bell,
  StickyNote,
} from "lucide-react";
import { useEffect, useState } from "react";
import { MarketingNav } from "@/components/marketing/MarketingNav";

// Marketing landing page — calm, near-white ground, a serif display hero with
// one accent word, twin CTAs, a browser-chromed product preview, then feature
// blocks. Flat surfaces + hairline borders; the type and spacing carry it.

export default function Landing() {
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const el = document.querySelector(hash);
    if (el) {
      const t = setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
      return () => clearTimeout(t);
    }
  }, [hash]);
  return (
    <div className="min-h-screen bt-marketing-bg text-slate-900 antialiased overflow-hidden">
      <MarketingNav />
      <Hero />
      <TrustBar />
      <Features />
      <WorkspaceFeatures />
      <ProductPreview />
      <UseCases />
      <HowItWorks />
      <Stats />
      <Pricing />
      <FAQ />
      <CTA />
      <Footer />
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
          <Sparkles className="size-3.5" /> The AI research desk for Indian income tax
        </span>
        <h1 className="mt-6 font-serif text-[38px] sm:text-[58px] lg:text-[72px] leading-[1.05] font-semibold tracking-[-0.02em] text-slate-900">
          Tax answers you can<br />
          <span className="text-primary">actually cite.</span>
        </h1>
        <p className="mt-6 text-[16px] sm:text-[18px] text-slate-600 max-w-2xl mx-auto leading-relaxed">
          Defensible answers on Indian income tax — footnoted to the exact section,
          rule or judgment behind every claim. When the source is silent, BharatTax
          says so instead of inventing an answer.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/register"
            className="inline-flex items-center gap-2 h-12 px-6 rounded-xl bg-primary text-white text-[15px] font-semibold shadow-sm hover:bg-primary/90 transition-colors"
          >
            Start free trial
          </Link>
          <Link
            to="/contact"
            className="inline-flex items-center gap-2 h-12 px-6 rounded-xl bg-white text-slate-800 text-[15px] font-semibold ring-1 ring-slate-200 shadow-sm hover:bg-slate-50 transition-colors"
          >
            Request a demo
          </Link>
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

// Browser-chromed chat empty-state mock — matches the actual /ask page. The
// sidebar carries GENERIC / illustrative chat titles only (never real user
// data) so the marketing surface stays safe to screenshot.
function HeroPreview() {
  // Fake chat titles, safe to publish. Chosen to reflect the kinds of asks
  // BharatTax actually handles — sale-deed reads, sec-68 defence, sec-50C
  // computation, sec-148 reopening, ESOP tax, penalty analysis.
  const chatsToday = [
    "Section 50C — missing SDV in deed",
    "Section 68 defence — five loan cos.",
    "Capital gains on Bangalore flat",
    "Section 148 reopening safeguards",
    "ESOP taxation — grant vs exercise",
  ];
  const chatsYesterday = [
    "270A penalty — under-reporting",
    "Sale-deed review — inferred SDV risk",
    "Section 56(2)(x) worked example",
  ];
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
            bharattax.wenvia.global/ask
          </div>
        </div>
        {/* Chat interior — sidebar hides on small screens so the composer gets
            the full width. */}
        <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] min-h-[440px] md:h-[520px]">
          {/* Sidebar — dummy content only */}
          <aside className="hidden md:flex flex-col border-r border-slate-200 bg-slate-50/60">
            <div className="p-3">
              <div className="flex items-center px-1 py-1.5 mb-3">
                <img
                  src="/bharattax-logo.png"
                  alt="BharatTax"
                  className="h-8 w-auto select-none mix-blend-multiply"
                  draggable={false}
                />
              </div>
              <button
                type="button"
                className="w-full inline-flex items-center justify-center gap-2 h-9 rounded-lg bg-slate-900 text-white px-3 text-[12.5px] font-semibold hover:bg-slate-800 transition-colors"
              >
                <PenSquare className="size-3.5" /> New chat
              </button>
              <div className="mt-3 relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
                <input
                  className="w-full pl-8 pr-2 h-8 rounded-md bg-white ring-1 ring-slate-200 text-[12px] text-slate-500 outline-none placeholder:text-slate-400"
                  placeholder="Search chats"
                  readOnly
                  aria-hidden
                />
              </div>
            </div>
            <div className="px-3 flex-1 overflow-hidden">
              <SidebarChatGroup label="Today" items={chatsToday} />
              <SidebarChatGroup label="Yesterday" items={chatsYesterday} />
            </div>
            {/* User pill */}
            <div className="border-t border-slate-200 p-2.5 flex items-center gap-2">
              <div className="size-7 rounded-full bg-primary/10 text-primary grid place-items-center text-[11px] font-semibold">
                CA
              </div>
              <div className="min-w-0">
                <div className="text-[12px] font-semibold text-slate-800 truncate">Priya, CA</div>
                <div className="text-[10px] text-emerald-600 leading-none mt-0.5">● Online</div>
              </div>
            </div>
          </aside>
          {/* Main — chat empty state */}
          <div className="p-6 sm:p-8 flex flex-col items-center justify-center text-center bg-bt-marketing-bg">
            <div className="size-12 rounded-xl bg-white grid place-items-center shadow-sm ring-1 ring-slate-200 overflow-hidden">
              <img src="/favicon.png" alt="BharatTax" className="size-10 object-contain" draggable={false} />
            </div>
            <span className="mt-4 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-semibold ring-1 ring-primary/20">
              <Sparkles className="size-3" /> Citation-grounded · primary Indian tax law
            </span>
            <h3 className="mt-4 font-serif text-[22px] sm:text-[30px] font-semibold tracking-tight leading-tight text-slate-900">
              Hello. <span className="text-primary">What would you like to research today?</span>
            </h3>
            <p className="mt-2 text-[12.5px] sm:text-[13.5px] text-slate-500 max-w-md">
              Ask anything on the Income-tax Act, Rules, or CBDT circulars. Every answer is
              footnoted with its source.
            </p>
            {/* Composer mock */}
            <div className="mt-5 w-full max-w-lg rounded-xl ring-1 ring-slate-200 bg-white p-3 shadow-sm text-left">
              <div className="text-[12.5px] text-slate-400 py-1.5">
                Ask a tax-law question — e.g. when is an addition under s.68 sustainable?
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  className="size-7 rounded-md ring-1 ring-slate-200 grid place-items-center text-slate-500 hover:bg-slate-50"
                >
                  <Plus className="size-3.5" />
                </button>
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-[10.5px] text-slate-400 hidden sm:inline">citation-grounded</span>
                  <button
                    type="button"
                    className="size-7 rounded-md bg-primary text-white grid place-items-center shadow-sm"
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                </div>
              </div>
            </div>
            {/* Suggested starter tiles */}
            <div className="mt-4 grid grid-cols-2 gap-2 w-full max-w-lg">
              <StarterTile
                icon={<Calculator className="size-3.5" />}
                eyebrow="Deductions"
                title="Deduction limit under s.80D for senior citizens"
              />
              <StarterTile
                icon={<BookOpen className="size-3.5" />}
                eyebrow="Exemptions"
                title="Agricultural income — is it fully exempt under s.10(1)?"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
function SidebarChatGroup({ label, items }: { label: string; items: string[] }) {
  return (
    <>
      <div className="text-[9.5px] uppercase tracking-wider text-slate-400 font-semibold mt-2 mb-1 px-1">
        {label}
      </div>
      <div className="space-y-0.5">
        {items.map((t) => (
          <div
            key={t}
            className="flex items-center gap-2 px-2 py-1.5 rounded-md text-[12px] text-slate-700 hover:bg-white/70 cursor-default truncate"
          >
            <MessageSquareText className="size-3 text-slate-400 shrink-0" />
            <span className="truncate">{t}</span>
          </div>
        ))}
      </div>
    </>
  );
}
function StarterTile({ icon, eyebrow, title }: { icon: React.ReactNode; eyebrow: string; title: string }) {
  return (
    <div className="rounded-lg ring-1 ring-slate-200 bg-white p-3 text-left hover:ring-primary/30 hover:shadow-sm transition-all cursor-default">
      <div className="flex items-center gap-1.5 text-primary">
        {icon}
        <span className="text-[10px] uppercase tracking-wider font-semibold">{eyebrow}</span>
      </div>
      <div className="text-[12px] text-slate-700 mt-1 leading-snug">{title}</div>
    </div>
  );
}

// ============================================================== Trust bar
function TrustBar() {
  const items = [
    "Chartered accountants", "CIT(A) & NFAC benches", "Corporate CFO & CS teams",
    "Tax counsel", "CA-Final students", "Individual taxpayers",
  ];
  return (
    <section className="mx-auto max-w-6xl px-4 sm:px-6 py-10">
      <div className="text-center text-[12px] uppercase tracking-[0.18em] text-slate-500 font-semibold">
        Built for every seat at the tax table
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
    { icon: <Search className="size-5" />, title: "Cited from primary law", desc: "Every claim tags the section, rule, circular or judgment it stands on. If the corpus cannot support a point, BharatTax says so instead of inventing one." },
    { icon: <FileText className="size-5" />, title: "Read the document, not the OCR", desc: "Upload a sale deed, an assessment notice, a Board judgment. BharatTax extracts verbatim facts, flags what's missing, and answers only from what's actually in the file." },
    { icon: <Users className="size-5" />, title: "Right-shaped for who's asking", desc: "A CA gets a computation framework. An AO gets verification points. A founder gets 'what to do, what to keep'. Same evidence, different depth." },
    { icon: <ShieldCheck className="size-5" />, title: "Self-audited answers", desc: "Post-generation checks catch reverse-engineered figures, initials-only case names, and over-confident claims — and prepend a visible warning before the answer." },
    { icon: <Gavel className="size-5" />, title: "Six-module appeal drafting", desc: "Facts, deficiencies, scope, compliance, findings and the order — each generated, cited, and editable before you sign the .docx." },
    { icon: <Brain className="size-5" />, title: "Multi-agent research", desc: "A planner scopes the ask, a researcher pulls statute and case law from IndianKanoon, a composer assembles the answer under a strict evidence discipline." },
  ];
  return (
    <section id="features" className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-20">
      <div className="text-center max-w-2xl mx-auto">
        <div className="text-[12px] uppercase tracking-[0.18em] text-primary font-semibold">Features</div>
        <h2 className="mt-2 font-serif text-[26px] sm:text-[40px] font-semibold tracking-tight">Serious tax work, without the confabulation.</h2>
        <p className="mt-3 text-slate-600">Research, read, reason and draft — with the receipts attached to every claim.</p>
      </div>
      <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((c, i) => {
          // Rotate each card's icon chip across the three BharatTax logo
          // tones (navy → orange → green) so the grid mirrors the brand
          // palette rather than being a wall of navy.
          const tones = [
            "bg-primary/10 text-primary",
            "bg-brand-orange/12 text-brand-orange",
            "bg-brand-green/12 text-brand-green",
          ];
          const tone = tones[i % tones.length];
          return (
            <div key={c.title} className="group rounded-2xl bg-white ring-1 ring-slate-200 p-6 hover:ring-primary/30 hover:shadow-lg hover:shadow-primary/10 transition-all">
              <div className={`size-10 rounded-xl ${tone} grid place-items-center mb-4`}>{c.icon}</div>
              <div className="text-[16px] font-semibold text-slate-900">{c.title}</div>
              <div className="text-[13.5px] text-slate-600 mt-1.5 leading-relaxed">{c.desc}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ============================================================== Daily workspace
function WorkspaceFeatures() {
  const cards = [
    { icon: <CalendarClock className="size-5" />, title: "Limitation calendar", desc: "Enter one trigger date; every statutory deadline — time-barring under §153, appeal windows, the DRP clock — is computed, section-cited and dropped onto your calendar." },
    { icon: <Bell className="size-5" />, title: "Reminders & notifications", desc: "A notification bell surfaces due reminders the moment they fire, with escalating nudges — so nothing goes time-barred on your watch." },
    { icon: <StickyNote className="size-5" />, title: "Matters & sticky notes", desc: "Track every case by PAN, AY and appeal number, and pin colour-coded notes to a matter, a section or a citation." },
    { icon: <Calculator className="size-5" />, title: "Statutory calculators", desc: "Interest u/s 234A/B/C & 220(2), tax u/s 115BBE, slab tax and capital gains — each with the workings shown." },
    { icon: <Scale className="size-5" />, title: "AIS / 26AS reconciliation", desc: "Match two entry sets — 26AS against AIS or the books — and flag only the genuine mismatches worth a query." },
    { icon: <Users className="size-5" />, title: "Templates & collaboration", desc: "Reusable notice and order templates, section & assessee watchlists, and share a matter across your wing, circle or firm." },
  ];
  return (
    <section className="bg-slate-50/60 border-y border-slate-100">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-20">
        <div className="text-center max-w-2xl mx-auto">
          <div className="text-[12px] uppercase tracking-[0.18em] text-primary font-semibold">Your daily workspace</div>
          <h2 className="mt-2 font-serif text-[26px] sm:text-[40px] font-semibold tracking-tight">Not just a chatbot — your desk.</h2>
          <p className="mt-3 text-slate-600">BharatTax organises your working life around the dates that matter: matters, deadlines, reminders, notes, calculators and reconciliation — in one place.</p>
        </div>
        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {cards.map((c, i) => {
            const tones = ["bg-primary/10 text-primary", "bg-brand-orange/12 text-brand-orange", "bg-brand-green/12 text-brand-green"];
            const tone = tones[i % tones.length];
            return (
              <div key={c.title} className="group rounded-2xl bg-white ring-1 ring-slate-200 p-6 hover:ring-primary/30 hover:shadow-lg hover:shadow-primary/10 transition-all">
                <div className={`size-10 rounded-xl ${tone} grid place-items-center mb-4`}>{c.icon}</div>
                <div className="text-[16px] font-semibold text-slate-900">{c.title}</div>
                <div className="text-[13.5px] text-slate-600 mt-1.5 leading-relaxed">{c.desc}</div>
              </div>
            );
          })}
        </div>
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
        title="Answers you can hand to a client."
        desc="Ask in plain English or attach a document. Every claim points at the section, rule, circular or judgment it stands on — and the source is one click away. When a critical figure is missing, BharatTax asks for it instead of guessing."
        bullets={["Inline footnotes to primary law", "Persona-shaped answers (CA, AO, CFO, founder)", "Follow-up suggestions after every reply"]}
        preview={<AskPreview />}
      />
      <SplitBlock
        reverse
        eyebrow="Appeals"
        title="Six-module drafting for CIT(A) & NFAC."
        desc="Upload the appeal file. BharatTax drafts facts, deficiencies, scope, compliance, findings and the order — each cited, each editable, exported to a signable Word document you can put in front of a bench."
        bullets={["6-module pipeline, each cited", "AI + manual edits round-trip through one doc", "Export to signable .docx or PDF"]}
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

// ============================================================== Use cases
function UseCases() {
  const cases = [
    { who: "Chartered accountants & firms", d: "Draft cited computation frameworks for capital gains, defend Section 68 additions, and turn a sale deed into an ITR-ready position — with every figure tagged to the section that governs it.", points: ["Cited Section 50C / 56 / 68 analysis", "Read sale deeds & assessment notices", "Client-ready computation memos"] },
    { who: "Assessing Officers & CIT(A) benches", d: "Turn a filed appeal into a fully-cited draft order in minutes. Verify a deed against reported figures, spot missing evidence, and draft the six-module appellate order for signature.", points: ["6-module CIT(A) drafting pipeline", "AO verification points & questionnaires", "Signable .docx / PDF export"] },
    { who: "CFOs, Company Secretaries & counsel", d: "Executive verdicts on tax exposure, board-note-ready checklists, and defensible research on any point that could turn into an assessment — plus SC / HC / ITAT case law with the judgment one click away.", points: ["Board-note briefs with risk ratings", "SC / HC / ITAT case-law search", "Compliance & due-diligence checklists"] },
    { who: "Founders, taxpayers & students", d: "Plain-English answers on what to do, what to keep, and what could go wrong — without the jargon. Pedagogical explanations for CA-Final and law-school revision, with worked examples.", points: ["'What to do / what to keep' briefs", "Worked numerical examples", "Step-by-step case-study answers"] },
  ];
  return (
    <section id="use-cases" className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-20">
      <div className="text-center max-w-2xl mx-auto">
        <div className="text-[12px] uppercase tracking-[0.18em] text-primary font-semibold">Use cases</div>
        <h2 className="mt-2 font-serif text-[26px] sm:text-[40px] font-semibold tracking-tight">Built for everyone on the file.</h2>
        <p className="mt-3 text-slate-600">Same evidence discipline, tuned to how each role actually works.</p>
      </div>
      <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cases.map((c) => (
          <div key={c.who} className="rounded-2xl bg-white ring-1 ring-slate-200 p-6 flex flex-col">
            <div className="text-[16px] font-semibold text-slate-900">{c.who}</div>
            <p className="text-[13.5px] text-slate-600 mt-2 leading-relaxed">{c.d}</p>
            <ul className="mt-4 space-y-2 flex-1">
              {c.points.map((p) => (
                <li key={p} className="flex items-start gap-2 text-[13.5px] text-slate-700">
                  <CheckCircle2 className="size-4 text-emerald-500 mt-0.5 shrink-0" /> {p}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

// ============================================================== How it works
function HowItWorks() {
  const steps = [
    { n: 1, t: "Sign in", d: "Your admin approves the seat and issues a license. No card, no wait." },
    { n: 2, t: "Ask or attach", d: "Type a question, or attach a sale deed, notice, judgment or client file." },
    { n: 3, t: "Read the receipts", d: "Every claim is tagged to a section or judgment. If anything is inferred rather than confirmed, you'll see a coloured evidence flag." },
    { n: 4, t: "Export or reply", d: "Copy the answer, export the appellate order as a signable .docx, or ask the follow-up questions BharatTax already suggested." },
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

// ============================================================== Coverage
// Replaces the old "big-number" Stats card with a grid of what BharatTax
// actually indexes. Concrete beats abstract.
function Stats() {
  const areas = [
    { icon: <Scale className="size-4" />, title: "Income-tax Act, 1961", desc: "Every section, sub-clause and amendment — including Finance Act edits up to the latest year." },
    { icon: <BookOpen className="size-4" />, title: "Income-tax Rules, 1962", desc: "Full rules text with cross-references to the parent sections and CBDT circulars they operationalise." },
    { icon: <FileText className="size-4" />, title: "CBDT circulars & notifications", desc: "Numbered circulars, notifications, instructions and press releases — all citable by number and date." },
    { icon: <Gavel className="size-4" />, title: "Live case law", desc: "Supreme Court, High Courts and ITAT judgments pulled from IndianKanoon — with the full reporter citation, not a made-up initials-only name." },
    { icon: <Brain className="size-4" />, title: "GST & Companies Act cross-refs", desc: "Cross-reference into CGST notifications and MCA filings for the questions that straddle direct and indirect tax." },
    { icon: <ShieldCheck className="size-4" />, title: "Your uploaded documents", desc: "Sale deeds, assessment notices, appellate orders, client contracts — OCR'd, indexed, and answered from verbatim." },
  ];
  return (
    <section className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-20">
      <div className="text-center max-w-2xl mx-auto">
        <div className="text-[12px] uppercase tracking-[0.18em] text-primary font-semibold">Coverage</div>
        <h2 className="mt-2 font-serif text-[26px] sm:text-[40px] font-semibold tracking-tight">Indexed to the section, cited to the judgment.</h2>
        <p className="mt-3 text-slate-600">Six live corpora — plus your own paper — searched with citation-preserving retrieval.</p>
      </div>
      <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {areas.map((a, i) => {
          // Rotate icon chip through navy → orange → green so the corpora
          // grid mirrors the BharatTax logo palette.
          const tones = [
            "bg-primary/10 text-primary",
            "bg-brand-orange/12 text-brand-orange",
            "bg-brand-green/12 text-brand-green",
          ];
          const tone = tones[i % tones.length];
          return (
            <div key={a.title} className="rounded-2xl bg-white ring-1 ring-slate-200 p-5 hover:ring-primary/30 transition-all">
              <div className="flex items-center gap-2.5">
                <div className={`size-8 rounded-lg ${tone} grid place-items-center`}>{a.icon}</div>
                <div className="text-[14.5px] font-semibold text-slate-900">{a.title}</div>
              </div>
              <p className="mt-2.5 text-[13px] text-slate-600 leading-relaxed">{a.desc}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}


// ============================================================== Pricing
function Pricing() {
  // Billing cycle toggle — headline price + subline switch on this.
  const [cycle, setCycle] = useState<"monthly" | "yearly">("yearly");

  // BharatTax pricing is metered by TOKENS (matches monthly_token_allowance
  // in our SubscriptionPlan model). Token math from live 20-case test:
  //   * Doc-attached question   — ~30K tokens
  //   * Multi-agent research    — ~60K tokens
  //   * Six-module appellate    — ~200K tokens
  // Every plan is SINGLE-LOGIN. Firm differs by capacity + support, not seats.
  // Yearly totals are 20% off the monthly × 12 sticker (annual pre-pay discount).
  const plans = [
    {
      name: "BharatTax Annual License",
      priceMonthly: "₹3,833",
      priceYearly: "₹45,999",
      monthlyEquivalent: "₹3,833 / month effective · billed annually",
      badge: "Per user / year",
      desc: "A simple per-seat license for income-tax officers, wings, benches and CAs — every capability included.",
      savings: "Exclusive of 18% GST",
      features: [
        "Unlimited cited research on the Act, Rules & CBDT circulars",
        "Live SC / HC / ITAT case-law lookup",
        "Six-module appellate order drafting (.docx export)",
        "Every notice & order template · Document Q&A",
        "Limitation calendar, reminders, sticky notes & docket",
        "Calculators, templates, watchlists & reconciliation",
        "Role-based access, full audit trail — hosted & secured in India",
        "30-day free trial · priority support & onboarding",
      ],
      cta: "Talk to sales",
      to: "/contact",
      featured: true,
    },
  ];
  return (
    <section id="pricing" className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-20">
      <div className="text-center max-w-2xl mx-auto">
        <div className="text-[12px] uppercase tracking-[0.18em] text-primary font-semibold">Pricing</div>
        <h2 className="mt-2 font-serif text-[26px] sm:text-[40px] font-semibold tracking-tight">One license. Everything included.</h2>
        <p className="mt-3 text-slate-600">
          A single per-seat annual license — every capability in the product, no feature gates, no tier maze. Prices exclusive of GST; enterprise, departmental seat plans and on-prem / air-gap available on request. Talk to sales to arrange a demo, walkthrough or subscription.
        </p>
      </div>
      {/* Monthly / Yearly toggle */}
      <div className="mt-8 flex justify-center">
        <div className="inline-flex items-center rounded-full bg-slate-100 ring-1 ring-slate-200 p-1 gap-1" role="tablist" aria-label="Billing cycle">
          <button
            type="button"
            role="tab"
            aria-selected={cycle === "monthly"}
            onClick={() => setCycle("monthly")}
            className={
              "px-4 h-9 rounded-full text-[13px] font-semibold transition-colors " +
              (cycle === "monthly" ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:text-slate-900")
            }
          >
            Monthly
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={cycle === "yearly"}
            onClick={() => setCycle("yearly")}
            className={
              "px-4 h-9 rounded-full text-[13px] font-semibold transition-colors inline-flex items-center gap-1.5 " +
              (cycle === "yearly" ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:text-slate-900")
            }
          >
            Yearly
            <span className={
              "text-[10.5px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded " +
              (cycle === "yearly" ? "bg-emerald-400/25 text-emerald-200" : "bg-emerald-100 text-emerald-700")
            }>
              Billed yearly
            </span>
          </button>
        </div>
      </div>
      <div className="mt-10 max-w-md mx-auto">
        {plans.map((p) => {
          const price = cycle === "monthly" ? p.priceMonthly : p.priceYearly;
          const per = cycle === "monthly" ? "/ month" : "/ year";
          return (
            <div key={p.name} className={
              "rounded-2xl p-6 flex flex-col relative " +
              (p.featured
                ? "bg-slate-900 text-white ring-1 ring-slate-900 shadow-lg"
                : "bg-white text-slate-900 ring-1 ring-slate-200")
            }>
              {p.featured && p.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-[11px] uppercase tracking-wider font-semibold bg-brand-orange text-white px-2.5 py-1 rounded-full shadow-sm">
                  {p.badge}
                </div>
              )}
              <div className="text-[13px] uppercase tracking-wider font-semibold text-primary">{p.name}</div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <div className="text-[34px] font-semibold tracking-tight tabular-nums">{price}</div>
                <div className={"text-[13px] " + (p.featured ? "text-white/70" : "text-slate-500")}>{per}</div>
              </div>
              {cycle === "yearly" && p.monthlyEquivalent && (
                <div className={"text-[11.5px] mt-1 " + (p.featured ? "text-white/60" : "text-slate-500")}>
                  {p.monthlyEquivalent}
                </div>
              )}
              {p.savings && (
                <div className={"text-[12px] mt-2 font-medium italic " + (p.featured ? "text-emerald-300" : "text-emerald-600")}>
                  {p.savings}
                </div>
              )}
              <div className={"text-[13.5px] mt-3 " + (p.featured ? "text-white/80" : "text-slate-600")}>{p.desc}</div>
              <ul className="mt-4 space-y-2 flex-1">
                {p.features.map((f) => (
                  <li key={f} className={"flex items-start gap-2 text-[13.5px] " + (p.featured ? "text-white/90" : "text-slate-700")}>
                    <CheckCircle2 className={"size-4 mt-0.5 shrink-0 " + (p.featured ? "text-emerald-300" : "text-emerald-500")} />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link to={p.to} className="mt-6 inline-flex items-center justify-center h-11 rounded-lg font-semibold text-[14px] bg-primary text-white hover:bg-primary/90 transition-colors">
                {p.cta}
              </Link>
            </div>
          );
        })}
      </div>
      <div className="mt-8 text-center text-[12px] text-slate-500 space-y-1">
        <p>All prices exclude applicable GST. Token usage is metered in real time on your Billing page — you can top up tokens mid-cycle without upgrading the plan.</p>
        <p>Need more than 100M tokens / month, on-prem deployment, or a custom SLA? <a href="mailto:sales@wenvia.global" className="text-primary hover:underline">Talk to sales</a>.</p>
      </div>
    </section>
  );
}

// ============================================================== FAQ
function FAQ() {
  const items = [
    ["Where do the citations come from?", "BharatTax indexes the Income-tax Act, Rules, CBDT circulars, GST notifications and MCA filings, and pulls live case law from IndianKanoon (Supreme Court, High Courts, ITAT). Every answer is anchored to the exact section, clause or judgment, and the source is one click away."],
    ["What kinds of documents can I upload?", "Sale deeds (English and bilingual), assessment notices, show-cause letters, appellate orders, CBDT circulars, contracts, judgments. BharatTax OCRs image PDFs, extracts verbatim facts, and answers only from what's actually in the file — not from what should be there."],
    ["What happens if a critical figure is missing from my document?", "BharatTax refuses to invent it. If a Section 50C question depends on the Stamp Duty Value and the deed doesn't state it, you'll get a short 'please provide SDV or upload the valuation certificate' response — never a reverse-engineered guess dressed up as a conclusion."],
    ["Is my case data private?", "Yes. Documents you upload are stored in your tenant. Every access is audit-logged. Nothing you upload is used to train shared models."],
    ["Which models power BharatTax?", "Google Gemini via Vertex AI (currently gemini-flash-latest with a fallback chain to gemini-2.5-pro). A dedicated composer prompt enforces evidence tags, conditional language and a self-audit pass on every answer."],
    ["Which formats can I export?", "Signable Microsoft Word (.docx) and fully-formatted PDF for appellate orders. Chat answers can be copied as rich markdown to email or Word. All exports are audit-logged."],
    ["How many concurrent users does one seat pool support?", "Comfortably 5–10 concurrent researchers per pool during Indian business hours. Larger deployments run on regional Vertex endpoints or reserved throughput — talk to sales."],
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
            Ask your first cited tax question in the next minute.
          </h3>
          <p className="mt-3 text-white/80 max-w-xl mx-auto">
            30-day free trial, no credit card. Upload a deed, ask a Section 50C
            question, or draft an appellate order — and read the receipts.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link to="/register" className="inline-flex items-center gap-2 h-12 px-6 rounded-xl bg-primary text-white font-semibold text-[15px] shadow-sm hover:bg-primary/90">
              Start free trial <ArrowRight className="size-4" />
            </Link>
            <Link to="/contact" className="inline-flex items-center gap-2 h-12 px-6 rounded-xl bg-white/10 ring-1 ring-white/20 text-white font-semibold text-[15px] hover:bg-white/20">
              Talk to sales
            </Link>
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
          <img
            src="/bharattax-logo.png"
            alt="BharatTax"
            className="h-10 w-auto select-none mix-blend-multiply"
            draggable={false}
          />
          <p className="mt-3 text-[12.5px] leading-relaxed">Citation-grounded research and drafting for Indian income tax — for CAs, Assessing Officers, CFOs, counsel, founders and students.</p>
        </div>
        <FooterCol title="Product">
          <FooterLink to="#features">Features</FooterLink>
          <FooterLink to="#pricing">Pricing</FooterLink>
          <FooterLink to="/releases">Releases</FooterLink>
          <FooterLink to="/docs">Documentation</FooterLink>
        </FooterCol>
        <FooterCol title="Company">
          <FooterLink to="/contact">Contact us</FooterLink>
          <FooterLink to="#use-cases">Use cases</FooterLink>
        </FooterCol>
        <FooterCol title="Legal">
          <FooterLink to="/terms">Terms of Service</FooterLink>
          <FooterLink to="/privacy">Privacy Policy</FooterLink>
        </FooterCol>
      </div>
      <div className="border-t border-slate-200 py-4 text-center text-[12px] text-slate-500 flex items-center justify-center gap-3">
        <span>&copy; {new Date().getFullYear()} BharatTax</span>
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
