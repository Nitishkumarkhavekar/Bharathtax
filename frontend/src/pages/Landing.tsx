import { Link } from "react-router-dom";
import {
  Scale,
  ShieldCheck,
  BookOpen,
  Gavel,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  MessageSquareText,
  FileText,
  Brain,
  Users,
  KeyRound,
  Server,
  LayoutDashboard,
  Clock,
  Plus,
  Minus,
  Quote,
  Github,
  Mail,
  Search,
  Layers,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export default function Landing() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <Nav />
      <Hero />
      <TrustBar />
      <Features />
      <ProductPreview />
      <HowItWorks />
      <UseCases />
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
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <header
      className={
        "sticky top-0 z-30 transition-colors " +
        (scrolled ? "bg-white/85 backdrop-blur border-b border-slate-200" : "bg-transparent")
      }
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-16 flex items-center gap-4">
        <Link to="/" className="flex items-center gap-2">
          <div className="size-9 rounded-lg bg-primary/10 ring-1 ring-primary/30 flex items-center justify-center">
            <Scale className="size-5 text-primary" />
          </div>
          <span className="text-lg font-semibold tracking-tight">BharathTax</span>
        </Link>
        <nav className="hidden md:flex items-center gap-1 ml-6 text-sm">
          <a href="#features" className="px-3 py-2 rounded-md text-slate-700 hover:bg-slate-100 hover:text-slate-900">Features</a>
          <a href="#how-it-works" className="px-3 py-2 rounded-md text-slate-700 hover:bg-slate-100 hover:text-slate-900">How it works</a>
          <a href="#pricing" className="px-3 py-2 rounded-md text-slate-700 hover:bg-slate-100 hover:text-slate-900">Pricing</a>
          <a href="#faq" className="px-3 py-2 rounded-md text-slate-700 hover:bg-slate-100 hover:text-slate-900">FAQ</a>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Link
            to="/login"
            className="hidden sm:inline-flex items-center text-sm font-medium text-slate-700 hover:text-slate-900 px-3 py-2 rounded-md hover:bg-slate-100"
          >
            Sign in
          </Link>
          <Link to="/register">
            <Button size="sm" className="gap-1.5">
              Get started <ArrowRight className="size-3.5" />
            </Button>
          </Link>
        </div>
      </div>
    </header>
  );
}

// ============================================================== Hero
function Hero() {
  return (
    <section className="relative overflow-hidden">
      <BackgroundOrnaments />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-12 sm:pt-20 pb-16 sm:pb-24 grid lg:grid-cols-12 gap-10 items-center">
        <div className="lg:col-span-7 space-y-6 animate-fade-up">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r from-primary/15 via-sky-500/15 to-violet-500/15 text-primary text-[12px] font-semibold ring-1 ring-primary/20 backdrop-blur">
            <Sparkles className="size-3.5" />
            Purpose-built for the Income-tax Department
          </span>
          <h1 className="text-[34px] sm:text-5xl lg:text-[60px] leading-[1.03] font-semibold tracking-tight">
            The tax-research copilot that{" "}
            <span className="bg-gradient-to-r from-primary via-sky-500 to-violet-500 bg-clip-text text-transparent">
              cites every claim
            </span>
            {" "}& drafts every order.
          </h1>
          <p className="text-[15.5px] sm:text-lg text-slate-600 max-w-2xl leading-relaxed">
            BharathTax is a citation-grounded assistant for Indian income-tax
            officers, CIT(A) benches, chartered accountants and legal counsel.
            Ask a question, get a footnoted answer sourced from the Act, Rules
            and CBDT circulars — or upload an appeal file and generate a
            fully-drafted appellate order in six auditable modules.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link to="/register">
              <button className="bt-btn-primary h-12 px-6 text-[15px] rounded-xl">
                Start for free <ArrowRight className="size-4" />
              </button>
            </Link>
            <Link to="/login">
              <button className="bt-btn-ghost h-12 px-6 text-[15px] rounded-xl">
                Sign in
              </button>
            </Link>
          </div>
          <ul className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-2 text-[13px] text-slate-600">
            <li className="flex items-center gap-1.5">
              <CheckCircle2 className="size-4 text-emerald-500" /> No credit card required
            </li>
            <li className="flex items-center gap-1.5">
              <CheckCircle2 className="size-4 text-emerald-500" /> Admin approves your account
            </li>
            <li className="flex items-center gap-1.5">
              <CheckCircle2 className="size-4 text-emerald-500" /> Audit-logged · seat-licensed
            </li>
          </ul>
          {/* Inline stat strip — social proof without needing external logos. */}
          <div className="grid grid-cols-3 gap-3 max-w-lg pt-4">
            <HeroStat value="120k+" label="Statutes indexed" />
            <HeroStat value="6-module" label="Appeal pipeline" />
            <HeroStat value="< 4s" label="Median citation time" />
          </div>
        </div>
        <div className="lg:col-span-5">
          <HeroPreview />
        </div>
      </div>
    </section>
  );
}

function HeroStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl bg-white/70 backdrop-blur ring-1 ring-slate-200/70 px-3 py-2.5 shadow-sm">
      <div className="text-[18px] font-semibold bt-gradient-text leading-none">
        {value}
      </div>
      <div className="text-[11px] text-slate-500 mt-1 uppercase tracking-wider">
        {label}
      </div>
    </div>
  );
}

function BackgroundOrnaments() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-0" aria-hidden>
      <div className="absolute -top-32 -left-24 size-96 rounded-full bg-primary/10 blur-3xl" />
      <div className="absolute top-10 right-0 size-[28rem] rounded-full bg-violet-200/40 blur-3xl" />
      <div className="absolute bottom-0 left-1/3 size-[26rem] rounded-full bg-sky-200/40 blur-3xl" />
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgb(15 23 42) 1px, transparent 0)",
          backgroundSize: "24px 24px",
        }}
      />
    </div>
  );
}

function HeroPreview() {
  return (
    <div className="relative animate-fade-up">
      {/* Halo */}
      <div className="absolute -inset-4 -z-10 rounded-3xl bg-gradient-to-br from-primary/15 via-sky-200/40 to-violet-200/40 blur-2xl" />
      <div className="rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 overflow-hidden">
        {/* Window chrome */}
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-slate-200 bg-slate-50">
          <span className="size-2.5 rounded-full bg-rose-300" />
          <span className="size-2.5 rounded-full bg-amber-300" />
          <span className="size-2.5 rounded-full bg-emerald-300" />
          <span className="ml-3 text-[11px] font-medium text-slate-500">
            BharathTax · Ask Bot
          </span>
        </div>
        <div className="p-5 space-y-4 bg-gradient-to-br from-white via-slate-50/40 to-white">
          {/* User bubble */}
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl bg-primary text-primary-foreground px-3.5 py-2 text-[13px] leading-relaxed shadow-sm">
              What is the max deduction under section 80C?
            </div>
          </div>
          {/* Assistant bubble */}
          <div className="flex gap-2.5">
            <div className="size-7 shrink-0 rounded-lg bg-primary/10 ring-1 ring-primary/30 flex items-center justify-center">
              <Scale className="size-3.5 text-primary" />
            </div>
            <div className="rounded-2xl bg-white border border-slate-200 px-3.5 py-2.5 shadow-sm space-y-2 text-[13px] leading-relaxed text-slate-800">
              <p>
                The maximum aggregate deduction under{" "}
                <span className="px-1 py-0.5 rounded text-[11px] font-medium bg-primary/10 text-primary">
                  §80C
                </span>{" "}
                is{" "}
                <span className="font-semibold text-slate-900">₹1,50,000</span>{" "}
                in a financial year.
                <span className="inline-flex items-center justify-center min-w-[1.25rem] h-4 px-1 ml-1 rounded-full bg-primary/10 text-primary text-[10px] font-semibold">
                  1
                </span>
              </p>
              <div className="grid grid-cols-2 gap-1.5 pt-1.5">
                <SourcePill label="Income Tax Act, 1961" tag="§80C" />
                <SourcePill label="Income Tax Act, 1961" tag="§80CCE" />
              </div>
            </div>
          </div>
          {/* Composer */}
          <div className="mt-2 rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="px-3 pt-2 text-[12.5px] text-slate-400">
              Ask a tax-law question…
            </div>
            <div className="flex items-center gap-2 px-2 py-2">
              <span className="text-[10.5px] font-medium px-2 py-1 rounded-md bg-slate-100 text-slate-700">
                All modules
              </span>
              <span className="text-[10.5px] font-medium px-2 py-1 rounded-md bg-slate-100 text-slate-700">
                Explanatory
              </span>
              <div className="ml-auto size-7 rounded-full bg-primary text-white grid place-items-center">
                <ArrowRight className="size-3.5" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SourcePill({ label, tag }: { label: string; tag: string }) {
  return (
    <div className="rounded-md border border-slate-200 px-2 py-1.5 bg-white">
      <div className="text-[11px] text-slate-800 truncate">{label}</div>
      <div className="text-[10px] text-slate-500 font-mono">{tag}</div>
    </div>
  );
}

// ============================================================== TrustBar
function TrustBar() {
  const items = [
    { icon: ShieldCheck, label: "Self-hosted" },
    { icon: BookOpen, label: "Income-tax Act + Rules + Circulars" },
    { icon: Gavel, label: "Appeal drafting" },
    { icon: Sparkles, label: "Citation-grounded" },
    { icon: Server, label: "On-prem · audit-logged" },
  ];
  return (
    <section className="border-y border-slate-200/70 bg-slate-50/50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-5">
        <ul className="flex flex-wrap items-center gap-x-8 gap-y-3 justify-center text-slate-600">
          {items.map((i, idx) => (
            <li key={idx} className="flex items-center gap-1.5 text-[12.5px] font-medium">
              <i.icon className="size-4 text-slate-400" />
              {i.label}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ============================================================== Features
function Features() {
  const FEATURES = [
    {
      icon: MessageSquareText,
      title: "Grounded answers",
      desc: "Every claim points back to the exact section, rule or CBDT circular. If primary sources don't cover it, BharathTax refuses rather than hallucinate.",
      accent: "from-sky-100 to-white",
      iconBg: "bg-sky-100 text-sky-700",
    },
    {
      icon: Brain,
      title: "Smart fallback",
      desc: "When the grounded model can't find a match, a general income-tax LLM answers basic questions while staying strictly on Indian tax.",
      accent: "from-violet-100 to-white",
      iconBg: "bg-violet-100 text-violet-700",
    },
    {
      icon: Gavel,
      title: "Appeal drafting",
      desc: "Spin up draft orders, structured by issue, with citations to the underlying case law and statute. Edit and export to DOCX.",
      accent: "from-amber-100 to-white",
      iconBg: "bg-amber-100 text-amber-700",
    },
    {
      icon: FileText,
      title: "Document Q&A",
      desc: "Drop in a PDF — assessment order, show-cause, departmental note — and ask questions against that document only.",
      accent: "from-emerald-100 to-white",
      iconBg: "bg-emerald-100 text-emerald-700",
    },
    {
      icon: Users,
      title: "Wings & seats",
      desc: "Multi-team workspace with concurrent-seat licensing. Officers, auditors and wing admins each see their own scope.",
      accent: "from-rose-100 to-white",
      iconBg: "bg-rose-100 text-rose-700",
    },
    {
      icon: LayoutDashboard,
      title: "Admin console",
      desc: "Live overview of users, queries, revenue, system health and licenses. Approve registrations in one click.",
      accent: "from-slate-100 to-white",
      iconBg: "bg-slate-200 text-slate-700",
    },
  ];
  return (
    <section id="features" className="py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="Features"
          title="Everything you need for grounded tax research"
          subtitle="From a quick lookup of a sub-section to drafting a full appeal order — one workspace, every claim cited."
        />
        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f, i) => (
            <div
              key={i}
              className={
                "group relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br p-5 hover:shadow-lg hover:-translate-y-0.5 transition-all " +
                f.accent
              }
            >
              <div
                className={
                  "size-10 rounded-xl flex items-center justify-center " + f.iconBg
                }
              >
                <f.icon className="size-5" />
              </div>
              <h3 className="mt-4 text-[16px] font-semibold tracking-tight">
                {f.title}
              </h3>
              <p className="mt-1.5 text-[13.5px] text-slate-600 leading-relaxed">
                {f.desc}
              </p>
              {/* corner blob */}
              <div
                aria-hidden
                className="pointer-events-none absolute -top-16 -right-12 size-40 rounded-full blur-2xl opacity-50 bg-white"
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SectionHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[11.5px] font-semibold tracking-wider uppercase">
        {eyebrow}
      </span>
      <h2 className="mt-4 text-3xl sm:text-[42px] font-semibold tracking-tight leading-tight">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-3 text-[15px] text-slate-600 leading-relaxed">
          {subtitle}
        </p>
      )}
    </div>
  );
}

// ============================================================== Product Preview
function ProductPreview() {
  return (
    <section className="relative py-20 sm:py-28 bg-gradient-to-br from-[#0b1d36] via-[#0f2748] to-[#13325b] text-white overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none opacity-40"
      >
        <div className="absolute -top-32 -left-24 size-[28rem] rounded-full bg-sky-400/20 blur-3xl" />
        <div className="absolute -bottom-32 -right-10 size-[28rem] rounded-full bg-violet-400/20 blur-3xl" />
      </div>
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 grid lg:grid-cols-12 gap-12 items-center">
        <div className="lg:col-span-5 space-y-5">
          <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-white/15 text-white text-[11.5px] font-semibold tracking-wider uppercase ring-1 ring-white/20">
            Inside BharathTax
          </span>
          <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight leading-tight">
            Built like a real research tool.
          </h2>
          <p className="text-white/85 leading-relaxed">
            A clean ChatGPT-style chat with structured answers, source cards
            and conversation history. An admin console with KPIs, charts and
            CRUD for users, models, revenue and licensing.
          </p>
          <ul className="space-y-2.5 text-[14px] text-white/90">
            {[
              "Topic-titled chat threads in a sidebar",
              "Per-message source cards with section / rule pointers",
              "Word-by-word streaming with live status",
              "Mobile-responsive across the whole product",
            ].map((t, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <CheckCircle2 className="size-5 text-emerald-300 shrink-0 mt-0.5" />
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="lg:col-span-7">
          <div className="relative">
            <div className="absolute -inset-4 -z-10 rounded-3xl bg-sky-400/20 blur-3xl" />
            <div className="rounded-2xl ring-1 ring-white/15 bg-white/[0.04] backdrop-blur p-3 shadow-2xl">
              <div className="rounded-xl bg-white/[0.04] ring-1 ring-white/10 p-3 space-y-3">
                <DashboardPreviewRow />
                <DashboardPreviewRow />
                <DashboardPreviewRow />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function DashboardPreviewRow() {
  return (
    <div className="grid grid-cols-4 gap-3">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="rounded-lg bg-white/[0.06] ring-1 ring-white/10 px-3 py-3"
        >
          <div className="text-[9.5px] uppercase tracking-wider text-white/55 font-semibold">
            metric {i + 1}
          </div>
          <div className="text-xl font-semibold mt-1 text-white tabular-nums">
            {(120 + i * 37).toLocaleString()}
          </div>
          <div className="h-1 rounded-full bg-white/10 mt-2 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-sky-400 to-violet-400"
              style={{ width: `${30 + i * 18}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================== How it works
function HowItWorks() {
  const STEPS = [
    {
      title: "Register",
      desc: "Sign up with your government / firm email and pick your wing. An administrator approves your account.",
      icon: Users,
    },
    {
      title: "Ask",
      desc: "Ask any tax-law question. Use natural language — 'what is the max deduction under 80C?', 'when does s.68 apply?'",
      icon: MessageSquareText,
    },
    {
      title: "Verify",
      desc: "Every answer cites the exact section, rule or CBDT circular. Click through to confirm in primary law.",
      icon: ShieldCheck,
    },
    {
      title: "Draft",
      desc: "When you're ready, spin up an appeal draft or export the answer. Audit-logged on your wing's seat.",
      icon: Gavel,
    },
  ];
  return (
    <section id="how-it-works" className="py-20 sm:py-28 bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="How it works"
          title="Four steps. Cited the whole way."
          subtitle="No mysterious 'AI did it' — every answer maps back to a primary source you can verify."
        />
        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {STEPS.map((s, i) => (
            <div
              key={i}
              className="relative rounded-2xl border border-slate-200 bg-white p-5 hover:shadow-md transition-shadow"
            >
              <div className="absolute -top-3 left-5 size-7 rounded-full bg-primary text-white text-[12px] font-bold grid place-items-center shadow-md">
                {i + 1}
              </div>
              <s.icon className="size-6 text-primary mt-2" />
              <h3 className="mt-3 text-[15.5px] font-semibold">{s.title}</h3>
              <p className="mt-1 text-[13px] text-slate-600 leading-relaxed">
                {s.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================================== Use cases
function UseCases() {
  const CARDS: {
    icon: typeof Search;
    tone: "primary" | "violet" | "amber";
    title: string;
    desc: string;
    points: string[];
  }[] = [
    {
      icon: Search,
      tone: "primary",
      title: "Research grounded in primary law",
      desc: "Ask in plain English. Every answer names the exact section, rule or CBDT circular it drew from — and refuses when the corpus can't support it.",
      points: [
        "Refuses rather than hallucinate",
        "Inline citations you can click through",
        "Web-search fallback for recent circulars",
      ],
    },
    {
      icon: Gavel,
      tone: "violet",
      title: "Draft appellate orders in six modules",
      desc: "Upload the appeal file. The pipeline runs deficiency, scope, compliance, issue matrix, findings, and a fully-assembled draft order — auditable end-to-end.",
      points: [
        "Deficiency + scope + compliance checks",
        "Issue-wise findings with case-law grounding",
        "Word-editable draft in Times New Roman",
      ],
    },
    {
      icon: Layers,
      tone: "amber",
      title: "Auditable, seat-licensed, self-hosted",
      desc: "Runs inside your infrastructure. Every query, every draft, every model call is logged against a per-officer seat lease — with token spend broken down by task.",
      points: [
        "Per-officer seat leases",
        "Full audit log of every query & draft",
        "Token spend visible per task, per user",
      ],
    },
  ];
  return (
    <section className="py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="What it does"
          title="Three capabilities. One workspace."
          subtitle="From a quick section lookup to a fully-drafted appellate order — every step is grounded, cited, and audit-logged."
        />
        <div className="mt-12 grid lg:grid-cols-3 gap-5">
          {CARDS.map((c, i) => {
            const tones = {
              primary: {
                wrap: "from-sky-50/80 to-white ring-primary/15",
                tile: "from-primary/15 to-sky-100 text-primary ring-primary/25",
                accent: "from-primary/25 via-sky-400/20 to-violet-500/25",
              },
              violet: {
                wrap: "from-violet-50/80 to-white ring-violet-200",
                tile: "from-violet-200/70 to-fuchsia-100 text-violet-700 ring-violet-300",
                accent: "from-violet-400/30 via-fuchsia-400/20 to-primary/25",
              },
              amber: {
                wrap: "from-amber-50/80 to-white ring-amber-200",
                tile: "from-amber-200/70 to-orange-100 text-amber-700 ring-amber-300",
                accent: "from-amber-400/30 via-orange-400/20 to-rose-400/25",
              },
            }[c.tone];
            return (
              <div
                key={i}
                className={
                  "group relative rounded-2xl border border-slate-200 bg-gradient-to-br p-6 ring-1 hover:shadow-lg hover:-translate-y-0.5 transition-all " +
                  tones.wrap
                }
              >
                {/* Halo behind the icon on hover */}
                <div
                  className={
                    "absolute -inset-1 rounded-3xl opacity-0 group-hover:opacity-100 blur-2xl transition-opacity pointer-events-none bg-gradient-to-br " +
                    tones.accent
                  }
                  aria-hidden
                />
                <div className="relative">
                  <div
                    className={
                      "size-12 rounded-xl bg-gradient-to-br ring-1 flex items-center justify-center shadow-sm " +
                      tones.tile
                    }
                  >
                    <c.icon className="size-5" />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold text-slate-900">
                    {c.title}
                  </h3>
                  <p className="mt-1.5 text-[13.5px] text-slate-600 leading-relaxed">
                    {c.desc}
                  </p>
                  <ul className="mt-4 space-y-1.5 text-[13px] text-slate-700">
                    {c.points.map((p) => (
                      <li key={p} className="flex items-start gap-2">
                        <CheckCircle2 className="size-4 mt-0.5 shrink-0 text-emerald-500" />
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ============================================================== Stats
function Stats() {
  const STATS = [
    { value: "3 Acts", label: "Income-tax Act 1961, Income-tax Act 2025, Rules" },
    { value: "1000s", label: "Sections, rules & CBDT circulars indexed" },
    { value: "100%", label: "Cited claims — refuses if no primary source" },
    { value: "30-day", label: "Sessions — sign in once, work all month" },
  ];
  return (
    <section className="py-20 bg-slate-50 border-y border-slate-200">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 text-center">
          {STATS.map((s, i) => (
            <div key={i}>
              <div className="text-3xl sm:text-4xl font-semibold text-slate-900 tabular-nums tracking-tight">
                {s.value}
              </div>
              <div className="mt-1 text-[12.5px] text-slate-600 leading-snug">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================================== Testimonial
function Testimonial() {
  return (
    <section className="py-20 sm:py-28">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <div className="relative rounded-3xl border border-slate-200 bg-white p-8 sm:p-10 shadow-lg">
          <Quote className="absolute top-6 left-6 size-8 text-primary/20" />
          <p className="mt-8 text-[18px] sm:text-2xl text-slate-800 font-medium leading-relaxed">
            "We used to keep five tabs open: the Act, the Rules, circulars, a
            search engine and a Word doc. BharathTax collapsed all of that
            into one chat with verifiable citations."
          </p>
          <div className="mt-6 flex items-center gap-3">
            <div className="size-10 rounded-full bg-gradient-to-br from-primary to-primary/60 text-white grid place-items-center font-semibold uppercase">
              R
            </div>
            <div>
              <div className="text-[14px] font-semibold text-slate-900">
                Senior Officer · Investigation Wing
              </div>
              <div className="text-[12px] text-slate-500">Pilot user, internal deployment</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ============================================================== Pricing
function Pricing() {
  const PLANS = [
    {
      name: "Starter",
      price: "Free",
      blurb: "For evaluation and small teams.",
      features: [
        "Up to 5 concurrent seats",
        "Citation-grounded chat",
        "Document Q&A (uploads)",
        "Email-based approvals",
        "30-day sessions",
      ],
      cta: "Get started",
      to: "/register",
      featured: false,
    },
    {
      name: "Wing",
      price: "₹—",
      blurb: "Most popular for departmental wings.",
      features: [
        "10–25 concurrent seats",
        "Multi-wing admin console",
        "Appeal-order drafting",
        "Revenue & license CRUD",
        "Live model + server metrics",
        "Priority support",
      ],
      cta: "Talk to us",
      to: "/login",
      featured: true,
    },
    {
      name: "Department",
      price: "Custom",
      blurb: "On-prem rollout, custom SSO.",
      features: [
        "Unlimited seats",
        "Self-hosted on your infra",
        "Custom corpora & ingestion",
        "SSO + role mapping",
        "Dedicated success engineer",
      ],
      cta: "Contact sales",
      to: "/login",
      featured: false,
    },
  ];
  return (
    <section id="pricing" className="py-20 sm:py-28 bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="Pricing"
          title="Simple, seat-based pricing."
          subtitle="Pay per concurrent seat per wing. The pool refills as sessions end."
        />
        <div className="mt-12 grid lg:grid-cols-3 gap-5">
          {PLANS.map((p, i) => (
            <div
              key={i}
              className={
                "relative rounded-2xl border bg-white p-6 transition-all " +
                (p.featured
                  ? "border-primary shadow-xl scale-[1.02] ring-2 ring-primary/20"
                  : "border-slate-200 hover:shadow-md")
              }
            >
              {p.featured && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-primary text-white text-[11px] font-semibold shadow">
                  Most popular
                </span>
              )}
              <div className="text-[13px] font-semibold uppercase tracking-wider text-slate-500">
                {p.name}
              </div>
              <div className="mt-3 text-3xl sm:text-4xl font-semibold tracking-tight text-slate-900">
                {p.price}
              </div>
              <div className="mt-1 text-[13px] text-slate-600">{p.blurb}</div>
              <ul className="mt-5 space-y-2 text-[13.5px] text-slate-700">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <CheckCircle2 className="size-4 mt-0.5 text-emerald-500 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link to={p.to} className="block mt-6">
                <Button
                  className="w-full"
                  variant={p.featured ? "default" : "outline"}
                >
                  {p.cta}
                </Button>
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================================== FAQ
function FAQ() {
  const Q = [
    {
      q: "Does BharathTax actually verify its answers?",
      a: "Yes. The chat is grounded against primary Indian tax law (Income-tax Act, Rules and CBDT circulars). Every claim is cited with a section / rule pointer. If the model can't find a primary source, it refuses to answer.",
    },
    {
      q: "How are accounts approved?",
      a: "Registration is self-service: a new user signs up with their email, password and wing. They land in a 'pending' state. An administrator approves them from the admin console in one click — only then can they sign in.",
    },
    {
      q: "Is my data shared with anyone?",
      a: "No. BharathTax is self-hosted: the database, indices, model gateway and audit log all live on your infrastructure. Nothing leaves your network unless you configure it to.",
    },
    {
      q: "Which Acts and corpora are covered?",
      a: "Out of the box: Income-tax Act 1961, Income-tax Act 2025, Income-tax Rules and ingested CBDT circulars / notifications. The corpus is extensible — drop new sources into the ingestion pipeline and BharathTax will index them.",
    },
    {
      q: "How does licensing work?",
      a: "Concurrent seats per wing. Each live JWT session holds a seat; the pool refills as sessions log out or expire. Admins issue license keys (BHTX-XXXX-XXXX-XXXX-XXXX) with a validity window and assignee.",
    },
    {
      q: "Can I draft appeal orders?",
      a: "Yes — Appeals is a built-in module. Create a case, upload documents, run the analysis, edit the draft, and export to DOCX. Each issue is structured with citations to the underlying case law and statute.",
    },
  ];
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="py-20 sm:py-28">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="FAQ"
          title="Common questions"
          subtitle="The answers we get asked most often by officers and partners trying BharathTax."
        />
        <div className="mt-10 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
          {Q.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={i}>
                <button
                  className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-slate-50"
                  onClick={() => setOpen(isOpen ? null : i)}
                >
                  <span className="flex-1 text-[14.5px] font-semibold text-slate-900">
                    {item.q}
                  </span>
                  {isOpen ? (
                    <Minus className="size-4 text-slate-500 shrink-0" />
                  ) : (
                    <Plus className="size-4 text-slate-500 shrink-0" />
                  )}
                </button>
                {isOpen && (
                  <div className="px-5 pb-4 -mt-1 text-[13.5px] text-slate-600 leading-relaxed animate-fade-up">
                    {item.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ============================================================== CTA
function CTA() {
  return (
    <section className="py-20 sm:py-24">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0b1d36] via-[#13325b] to-[#1c4a85] text-white p-8 sm:p-12 shadow-2xl">
          <div className="absolute inset-0 pointer-events-none opacity-40" aria-hidden>
            <div className="absolute -top-16 -right-20 size-72 rounded-full bg-sky-400/40 blur-3xl" />
            <div className="absolute -bottom-20 -left-10 size-72 rounded-full bg-violet-400/30 blur-3xl" />
          </div>
          <div className="relative grid lg:grid-cols-3 gap-8 items-center">
            <div className="lg:col-span-2">
              <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
                Ready to stop guessing?
              </h2>
              <p className="mt-2 text-white/85 max-w-xl leading-relaxed">
                Create an account, get approved, and ask your first tax
                question — with citations — in under a minute.
              </p>
            </div>
            <div className="flex sm:justify-end">
              <Link to="/register" className="block w-full sm:w-auto">
                <Button
                  size="lg"
                  className="w-full sm:w-auto gap-2 h-12 text-[15px] px-6 bg-white text-primary hover:bg-white/90 shadow-lg"
                >
                  Start for free <ArrowRight className="size-4" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ============================================================== Footer
function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
        <div>
          <Link to="/" className="flex items-center gap-2">
            <div className="size-8 rounded-lg bg-primary/10 ring-1 ring-primary/30 flex items-center justify-center">
              <Scale className="size-4 text-primary" />
            </div>
            <span className="font-semibold tracking-tight">BharathTax</span>
          </Link>
          <p className="mt-3 text-[12.5px] text-slate-600 leading-relaxed max-w-xs">
            Citation-grounded research and appeal drafting for Indian
            income-tax.
          </p>
        </div>
        <FooterCol
          title="Product"
          items={[
            { label: "Features", href: "#features" },
            { label: "How it works", href: "#how-it-works" },
            { label: "Pricing", href: "#pricing" },
            { label: "FAQ", href: "#faq" },
          ]}
        />
        <FooterCol
          title="Account"
          items={[
            { label: "Sign in", href: "/login" },
            { label: "Register", href: "/register" },
          ]}
        />
        <div>
          <div className="text-[12.5px] font-semibold uppercase tracking-wider text-slate-500">
            Contact
          </div>
          <ul className="mt-3 space-y-2 text-[13px] text-slate-700">
            <li className="flex items-center gap-2">
              <Mail className="size-4 text-slate-400" />
              hello@bharathtax.com
            </li>
            <li className="flex items-center gap-2">
              <Github className="size-4 text-slate-400" />
              github.com/bharathtax
            </li>
            <li className="flex items-center gap-2">
              <Clock className="size-4 text-slate-400" />
              Replies within 1 working day
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4 flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
          <span>© {new Date().getFullYear()} BharathTax. All rights reserved.</span>
          <span className="ml-auto inline-flex items-center gap-1">
            <KeyRound className="size-3.5 text-slate-400" /> Self-hosted ·
            seat-licensed · audit-logged
          </span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({
  title,
  items,
}: {
  title: string;
  items: { label: string; href: string }[];
}) {
  return (
    <div>
      <div className="text-[12.5px] font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </div>
      <ul className="mt-3 space-y-2 text-[13px]">
        {items.map((i) => {
          const isHash = i.href.startsWith("#");
          if (isHash) {
            return (
              <li key={i.label}>
                <a href={i.href} className="text-slate-700 hover:text-slate-900">
                  {i.label}
                </a>
              </li>
            );
          }
          return (
            <li key={i.label}>
              <Link to={i.href} className="text-slate-700 hover:text-slate-900">
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
