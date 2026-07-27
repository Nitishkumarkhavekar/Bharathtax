import { Link } from "react-router-dom";
import { MessageSquareText, Gavel, ScrollText, FileText, BookOpen, ShieldCheck, ArrowRight } from "lucide-react";
import { MarketingShell } from "@/components/marketing/MarketingShell";

const START = [
  { n: 1, t: "Get your account", d: "Your wing or firm administrator approves your seat and issues a licence. You'll receive sign-in details — no card required for the trial." },
  { n: 2, t: "Sign in", d: "Open the app and sign in. Admins land on the console; officers land on the chat workspace with the tools rail alongside." },
  { n: 3, t: "Ask or upload", d: "Ask a research question, upload a notice for document Q&A, or start an appeal draft. Every answer is cited to primary law." },
  { n: 4, t: "Review, edit, export", d: "Check the citations, edit freely, then export drafts to signable Word (.docx). Everything is audit-logged." },
];

const GUIDES = [
  { icon: <MessageSquareText className="size-5" />, t: "Ask (chat)", d: "Ask questions on the Income-tax Act, Rules and CBDT circulars. Answers stream in with inline citations and clickable sources. Use the module filter to scope a query, translate an answer into any of the 22 Indian languages, read it aloud, or pin, rename and share a conversation." },
  { icon: <Gavel className="size-5" />, t: "Appeals", d: "Upload the appeal file and BharathTax drafts the order across six modules — facts, deficiencies, scope, compliance, findings and order — each cited and editable, exported to a signable .docx. (The appeals workflow runs in the secure desktop application.)" },
  { icon: <ScrollText className="size-5" />, t: "Drafting", d: "Generate notices and orders — 142(1), 143(2), show-cause, 154 and more — from a few facts, grounded in the governing law and written from the department's standpoint. Export to ITBA-ready Word." },
  { icon: <FileText className="size-5" />, t: "Documents", d: "Upload a notice, order or agreement and ask questions scoped to that file. Retrieval stays within the document so answers are precise and traceable." },
  { icon: <BookOpen className="size-5" />, t: "Rulings", d: "Search the case-law corpus (Supreme Court, High Courts and — live via Indian Kanoon — ITAT) by issue, and pull the exact judgment behind a point." },
  { icon: <ShieldCheck className="size-5" />, t: "Admin & audit", d: "Administrators manage seats, licences, users and support from the console. Every query and document access is audit-logged; token usage is visible per user." },
];

export default function Docs() {
  return (
    <MarketingShell
      eyebrow="Documentation"
      title="Getting started with BharathTax."
      intro="A quick tour of how the platform works and what each tool does. Most people are productive within their first session."
    >
      {/* Quick start */}
      <h2 className="font-serif text-[22px] font-semibold text-slate-900 tracking-tight">Quick start</h2>
      <div className="mt-4 grid sm:grid-cols-2 gap-3">
        {START.map((s) => (
          <div key={s.n} className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-5">
            <div className="size-8 rounded-lg bg-primary text-white grid place-items-center font-semibold">{s.n}</div>
            <div className="text-[15px] font-semibold text-slate-900 mt-3">{s.t}</div>
            <div className="text-[13.5px] text-slate-600 mt-1.5 leading-relaxed">{s.d}</div>
          </div>
        ))}
      </div>

      {/* Tool guides */}
      <h2 className="font-serif text-[22px] font-semibold text-slate-900 tracking-tight mt-12">The tools</h2>
      <div className="mt-4 space-y-3">
        {GUIDES.map((g) => (
          <div key={g.t} className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-5 flex gap-4">
            <div className="size-10 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0">{g.icon}</div>
            <div>
              <div className="text-[15px] font-semibold text-slate-900">{g.t}</div>
              <div className="text-[13.5px] text-slate-600 mt-1 leading-relaxed">{g.d}</div>
            </div>
          </div>
        ))}
      </div>

      {/* The guarantee */}
      <div className="mt-12 rounded-2xl bg-slate-900 text-white p-6 sm:p-8">
        <h2 className="font-serif text-[20px] font-semibold">The one rule to remember</h2>
        <p className="mt-2 text-[14.5px] text-white/85 leading-relaxed max-w-2xl">
          BharathTax answers only from primary sources and cites everything — and it refuses
          rather than invent when the corpus can't support a claim. It's a fast, defensible
          first draft; you remain the officer of record. Always verify against the current Act
          and CBDT circulars before you act.
        </p>
      </div>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link to="/register" className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-primary text-white font-semibold text-[14px] hover:bg-primary/90 transition-colors">
          Start free trial <ArrowRight className="size-4" />
        </Link>
        <Link to="/contact" className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-white ring-1 ring-slate-200 text-slate-800 font-semibold text-[14px] hover:bg-slate-50 transition-colors">
          Talk to us
        </Link>
      </div>
    </MarketingShell>
  );
}
