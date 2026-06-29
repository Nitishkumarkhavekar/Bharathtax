import { Link } from "react-router-dom";
import {
  ShieldCheck, Quote, ServerCog, Layers, FileSearch, Scale, Gavel,
  BookOpen, Lock, ArrowRight, CheckCircle2, Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// Public marketing landing page (the app's front door, shown to logged-out
// visitors). Positioning vs. commentary-based tools (taxmann.ai / taxsutra):
// grounded ONLY in primary law, fully self-hosted, and it refuses rather than
// hallucinate.

const VALUE_PROPS = [
  { icon: Quote, title: "Every answer is cited",
    body: "Responses quote the exact section, rule or circular and link to the source. No paraphrased commentary — only primary law." },
  { icon: ShieldCheck, title: "It refuses, never invents",
    body: "If the law doesn't cover it, the bot says so. An anti-hallucination gate blocks any answer that isn't grounded in retrieved text." },
  { icon: ServerCog, title: "Fully self-hosted",
    body: "Runs entirely on your servers. Queries, documents and audit logs stay in-country — nothing is sent to an external AI service." },
  { icon: Layers, title: "Multi-domain modules",
    body: "Income Tax today; GST, Customs and case-law slot in by config. One engine, many tax domains." },
];

const FEATURES = [
  { icon: FileSearch, title: "Ask Bot",
    body: "Natural-language questions on Indian tax law, answered with inline citations to the Act, Rules and CBDT circulars in seconds." },
  { icon: BookOpen, title: "Document Q&A",
    body: "Upload a notice, order or return and ask questions answered only from that document — kept in a private per-user namespace." },
  { icon: Gavel, title: "Appeal drafting",
    body: "Turn case facts into a structured, citation-backed draft — assistive output an officer reviews, never a black box." },
  { icon: Scale, title: "Case-law & rulings",
    body: "Search judgments alongside the statute, with the same grounded, cited retrieval pipeline." },
];

const STEPS = [
  { n: "1", t: "Ask in plain language", d: "“What is the time limit to issue a notice under section 148?”" },
  { n: "2", t: "Hybrid retrieval + rerank", d: "Dense + keyword search over primary law, reranked to the most on-point passages." },
  { n: "3", t: "Grounded, cited answer", d: "A written answer with [n] citations linking to the exact source — or an honest “not found.”" },
];

const AUDIENCE = [
  "Income-Tax officers & assessing officers",
  "GST & Customs officers",
  "Chartered Accountants & tax consultants",
  "Bank & corporate compliance teams",
];

function Logo() {
  return (
    <span className="inline-flex items-center gap-2 font-bold text-lg">
      <span className="grid place-items-center size-7 rounded-md bg-primary text-primary-foreground">
        <Scale className="size-4" />
      </span>
      BharathTax
    </span>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* nav */}
      <header className="border-b border-border bg-card/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <Logo />
          <nav className="flex items-center gap-6 text-sm text-muted-foreground">
            <a href="#features" className="hover:text-foreground hidden sm:inline">Features</a>
            <a href="#how" className="hover:text-foreground hidden sm:inline">How it works</a>
            <a href="#who" className="hover:text-foreground hidden sm:inline">Who it's for</a>
            <Link to="/login"><Button size="sm">Sign in <ArrowRight className="size-4" /></Button></Link>
          </nav>
        </div>
      </header>

      {/* hero */}
      <section className="max-w-6xl mx-auto px-5 pt-16 pb-12 text-center">
        <div className="inline-flex items-center gap-2 text-xs font-medium text-accent-foreground bg-accent rounded-full px-3 py-1 mb-5">
          <Lock className="size-3.5" /> Self-hosted · grounded only in primary Indian tax law
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight max-w-3xl mx-auto leading-tight">
          Citation-backed tax research that <span className="text-primary">never makes things up</span>.
        </h1>
        <p className="mt-5 text-lg text-muted-foreground max-w-2xl mx-auto">
          Ask any question on the Income-Tax Act, Rules and CBDT circulars and get an answer
          backed by the exact section — or an honest “not found.” Runs entirely on your
          infrastructure; your queries and documents never leave your servers.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link to="/login"><Button size="lg">Sign in to your workspace <ArrowRight className="size-4" /></Button></Link>
          <a href="#features"><Button size="lg" variant="outline">See what it does</Button></a>
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          {["No external AI calls", "Every query audit-logged", "Department seat licensing"].map((t) => (
            <span key={t} className="inline-flex items-center gap-1.5"><CheckCircle2 className="size-4 text-success" /> {t}</span>
          ))}
        </div>
      </section>

      {/* value props */}
      <section className="max-w-6xl mx-auto px-5 py-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {VALUE_PROPS.map((v) => (
          <div key={v.title} className="rounded-xl border border-border bg-card p-5">
            <span className="grid place-items-center size-10 rounded-lg bg-accent text-accent-foreground mb-3">
              <v.icon className="size-5" />
            </span>
            <h3 className="font-semibold">{v.title}</h3>
            <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{v.body}</p>
          </div>
        ))}
      </section>

      {/* features */}
      <section id="features" className="bg-secondary/60 border-y border-border">
        <div className="max-w-6xl mx-auto px-5 py-16">
          <h2 className="text-2xl font-bold text-center">One assistant, the whole research workflow</h2>
          <p className="text-muted-foreground text-center mt-2 max-w-2xl mx-auto">
            The capabilities of a modern tax-research platform — but private, on-prem, and
            grounded strictly in the law itself.
          </p>
          <div className="grid sm:grid-cols-2 gap-5 mt-10">
            {FEATURES.map((f) => (
              <div key={f.title} className="flex gap-4 rounded-xl border border-border bg-card p-5">
                <span className="grid place-items-center size-11 shrink-0 rounded-lg bg-primary/10 text-primary">
                  <f.icon className="size-5" />
                </span>
                <div>
                  <h3 className="font-semibold">{f.title}</h3>
                  <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{f.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* how it works */}
      <section id="how" className="max-w-6xl mx-auto px-5 py-16">
        <h2 className="text-2xl font-bold text-center">How it works</h2>
        <div className="grid sm:grid-cols-3 gap-5 mt-10">
          {STEPS.map((s) => (
            <div key={s.n} className="rounded-xl border border-border bg-card p-6">
              <span className="grid place-items-center size-9 rounded-full bg-primary text-primary-foreground font-semibold">{s.n}</span>
              <h3 className="font-semibold mt-4">{s.t}</h3>
              <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* differentiator */}
      <section className="bg-sidebar text-sidebar-foreground">
        <div className="max-w-4xl mx-auto px-5 py-16 text-center">
          <Quote className="size-8 mx-auto opacity-60" />
          <p className="text-xl sm:text-2xl font-medium mt-4 leading-snug">
            Commentary-based tools answer from someone's opinion. BharathTax answers from the
            statute — and shows you exactly where it came from.
          </p>
          <p className="mt-4 text-sm opacity-70">
            Grounded only in primary law · No proprietary commentary · No data leaves your premises
          </p>
        </div>
      </section>

      {/* who it's for */}
      <section id="who" className="max-w-6xl mx-auto px-5 py-16">
        <div className="grid md:grid-cols-2 gap-10 items-center">
          <div>
            <h2 className="text-2xl font-bold">Built for the people who answer to the law</h2>
            <p className="text-muted-foreground mt-3 leading-relaxed">
              Whether you assess, litigate, advise or comply, BharathTax gives you a fast,
              defensible answer with the citation already attached — so every position you take
              is traceable to the source.
            </p>
            <ul className="mt-5 space-y-2.5">
              {AUDIENCE.map((a) => (
                <li key={a} className="flex items-center gap-2.5 text-sm">
                  <CheckCircle2 className="size-4 text-success shrink-0" /> {a}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-border bg-card p-8 text-center">
            <Building2 className="size-8 mx-auto text-primary" />
            <h3 className="font-semibold mt-3 text-lg">Deploy for your department</h3>
            <p className="text-sm text-muted-foreground mt-2">
              Per-wing seat licensing, role-based access, and a full audit trail — ready for a
              government or enterprise on-prem rollout.
            </p>
            <Link to="/login" className="block mt-5">
              <Button className="w-full">Sign in <ArrowRight className="size-4" /></Button>
            </Link>
          </div>
        </div>
      </section>

      {/* footer */}
      <footer className="border-t border-border bg-card">
        <div className="max-w-6xl mx-auto px-5 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-muted-foreground">
          <Logo />
          <p className="text-center">Grounded only in primary Indian tax law. Citation-backed; verify before reliance.</p>
          <Link to="/login" className="hover:text-foreground">Sign in</Link>
        </div>
      </footer>
    </div>
  );
}
