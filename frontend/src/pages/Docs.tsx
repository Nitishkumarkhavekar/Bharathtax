import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Download, UserPlus, LogIn, FolderPlus, UploadCloud,
  PlayCircle, FileCheck2, Sparkles, FileEdit, Info,
  ChevronRight, ArrowLeft, Search, ExternalLink, HelpCircle,
} from "lucide-react";
import { MarketingHeader, MarketingFooter } from "@/components/marketing/MarketingShell";

// End-to-end user manual for the BharathTax desktop application.
// Each chapter has an anchored heading, an intro, ordered steps, and a
// screenshot (loaded from /manual/*.png — see /opt/bharathtax/frontend/public/manual/).

type Step = {
  n?: number;
  title?: string;
  text?: string;
  img?: string;              // filename in /manual
  alt?: string;
  callout?: {
    tone: "info" | "warn";
    text: string;
  };
};
type Chapter = {
  id: string;
  n: number;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  intro?: string;
  steps: Step[];
};

const CHAPTERS: Chapter[] = [
  {
    id: "install",
    n: 1,
    title: "Install the desktop app",
    subtitle: "Download the Windows installer from the releases page and set it up.",
    icon: <Download className="size-4" />,
    intro:
      "The BharathTax Appeal Order desktop app is a signed Windows installer. It is the fastest way to draft appellate orders because the drafts save straight to your machine and can be edited in Microsoft Word.",
    steps: [
      {
        n: 1,
        title: "Open the releases page",
        text: "In your browser, go to bharattax.wenvia.global/releases and click Download for the latest Windows version.",
        img: "for-downloading-desktop-application-release-page.png",
        alt: "BharathTax releases page with a Download button",
      },
      {
        n: 2,
        title: "Run the installer",
        text: "Double-click the .exe you just downloaded. If Windows SmartScreen asks, click More info → Run anyway — the installer is signed and comes only from the releases page.",
        img: "after-click-on-installer.png",
        alt: "BharathTax installer wizard running",
      },
      {
        n: 3,
        title: "Open the app for the first time",
        text: "When the installer finishes, BharathTax Appeal Order launches automatically. You'll see the sign-in screen.",
        img: "after-install-opening-app-interface.png",
        alt: "Desktop app first-launch sign-in screen",
        callout: {
          tone: "info",
          text: "The app auto-updates in the background. When a new version is downloaded, a small toast appears — click Restart & install when you're ready.",
        },
      },
    ],
  },

  {
    id: "signup",
    n: 2,
    title: "Create your account",
    subtitle: "Sign up on the web first — the same login works on the desktop app.",
    icon: <UserPlus className="size-4" />,
    intro:
      "You register once from any browser. Your admin approves the seat and your licence is issued automatically. Use the same email + password to sign in on the desktop app.",
    steps: [
      {
        n: 1,
        title: "Go to the sign-up page",
        text: "Open bharattax.wenvia.global/register in your browser.",
        img: "signup.png",
        alt: "Public sign-up page in a web browser",
      },
      {
        n: 2,
        title: "Fill in your details",
        text: "Enter your full name, official email and a strong password (minimum six characters). Confirm the password to continue.",
        img: "signup-with-deatils.png",
        alt: "Sign-up form filled in with officer details",
      },
      {
        n: 3,
        title: "Account created",
        text: "You'll see a confirmation screen once your account is created. Your trial licence is assigned automatically — you can sign in right away.",
        img: "after-singup.png",
        alt: "Post-signup confirmation with trial licence details",
        callout: {
          tone: "info",
          text: "New users get a 30-day free trial with 100,000 tokens. Your administrator can extend or upgrade the licence later without changing your sign-in details.",
        },
      },
    ],
  },

  {
    id: "signin",
    n: 3,
    title: "Sign in to the desktop app",
    subtitle: "Use the same credentials on the desktop app.",
    icon: <LogIn className="size-4" />,
    steps: [
      {
        n: 1,
        title: "Enter your login",
        text: "Open BharathTax Appeal Order and enter the email and password you used at signup. Click Sign in.",
        img: "put-same-login-credentials-as-signup-in-web.png",
        alt: "Desktop sign-in screen with credentials filled in",
      },
      {
        n: 2,
        title: "Signing you in",
        text: "The app contacts the server, validates your licence and prepares your workspace. This takes a couple of seconds.",
        img: "after-click-signin.png",
        alt: "Desktop app during sign-in",
      },
      {
        n: 3,
        title: "You're in",
        text: "After sign-in, the Dashboard opens. You'll see recent cases, quick action tiles and the sidebar with Dashboard, New Appeal, Appeals, Report Issue and Settings.",
        img: "after-signin.png",
        alt: "Desktop dashboard after sign-in",
      },
      {
        n: 4,
        title: "The main interface",
        text: "The left sidebar is the primary nav; the main pane is the active screen; the header shows your name and licence expiry.",
        img: "after-sign-in-interface.png",
        alt: "Annotated main interface after sign-in",
      },
    ],
  },

  {
    id: "new-case",
    n: 4,
    title: "Create a new appeal case",
    subtitle: "Start a case by giving it a title, PAN and section.",
    icon: <FolderPlus className="size-4" />,
    steps: [
      {
        n: 1,
        title: "Open the New Appeal dialog",
        text: "Click New Appeal in the sidebar, or the + icon at the top of the Appeals list. The New Case dialog opens.",
        img: "create-new-case.png",
        alt: "New Case dialog with the fields visible",
      },
      {
        n: 2,
        title: "Fill in the case details",
        text: "Enter a short case title (e.g. \"ITA 214 / 2024-25 — Sharma vs. ITO\"), the assessment year, the PAN and the section under which the appeal falls. Click Create.",
        img: "After-click-on-+icon-create-new-appeal-case.png",
        alt: "Filled-in New Case dialog",
        callout: {
          tone: "info",
          text: "You can edit any of these details later from the case header — the case is identified by an internal slug, not the title.",
        },
      },
      {
        n: 3,
        title: "Case workspace",
        text: "You land on the case workspace with tabs for Documents, Pipeline, Preview and Edit. This is where every step below happens.",
        img: "opening-case-interface.png",
        alt: "Newly created case, empty workspace",
      },
    ],
  },

  {
    id: "upload",
    n: 5,
    title: "Upload the case documents",
    subtitle: "Add the appeal file — order, grounds, evidence and correspondence.",
    icon: <UploadCloud className="size-4" />,
    intro:
      "The AI drafts from the documents you upload — nothing more. Add every relevant PDF: the order under challenge, the grounds of appeal, evidence and correspondence.",
    steps: [
      {
        n: 1,
        title: "Click Upload",
        text: "Open the Documents tab of the case and click the Upload button.",
        img: "click-upload-button-to-upload-case-file.png",
        alt: "Documents tab with Upload button highlighted",
      },
      {
        n: 2,
        title: "Pick the files",
        text: "Browse to your case folder and select one or more PDFs, DOCX or plain-text files. Multi-select is supported.",
        img: "browse-location-to-store.png",
        alt: "File picker with case documents selected",
      },
      {
        n: 3,
        title: "Documents ready",
        text: "Each file appears in the list with its filename, page count and category. Wait for the indexing dots to disappear before running the pipeline.",
        img: "case-document-uploaded.png",
        alt: "Documents list showing uploaded files",
        callout: {
          tone: "warn",
          text: "Files larger than 100 MB may take a minute to index. Do not close the case tab while an upload is in progress.",
        },
      },
    ],
  },

  {
    id: "pipeline",
    n: 6,
    title: "Run the drafting pipeline",
    subtitle: "Generate the appellate order in six auditable modules.",
    icon: <PlayCircle className="size-4" />,
    intro:
      "The pipeline runs six modules in sequence — deficiency, scope, compliance, issue metrics, issue-wise findings and the final appellate order. Each module is cited and editable before you move to the next.",
    steps: [
      {
        n: 1,
        title: "Scroll to Run Pipeline",
        text: "On the case page, scroll down past the Documents list. You'll see the Run Pipeline panel.",
        img: "scroll-just-down-and-get-run-pipeline.png",
        alt: "Run pipeline panel below the documents list",
      },
      {
        n: 2,
        title: "Module 1 — Deficiency",
        text: "The pipeline first checks the appeal for procedural deficiencies (limitation, verification, fees, etc.) and reports what — if anything — needs curing.",
        img: "after-pipeline-run-deficiency-report.png",
        alt: "Deficiency report output",
      },
      {
        n: 3,
        title: "Module 2 — Scope validation",
        text: "It then confirms the appellate scope: which grounds are admitted, which are barred and any that need re-framing.",
        img: "scope-validation.png",
        alt: "Scope validation output",
      },
      {
        n: 4,
        title: "Module 3 — Document compliance",
        text: "Each uploaded document is scored for the sections it addresses so nothing is missed in the order.",
        img: "document-compliance.png",
        alt: "Document compliance matrix",
      },
      {
        n: 5,
        title: "Module 4 — Issue metrics",
        text: "The tool extracts each issue in the appeal, tags the section and reports the amount in dispute.",
        img: "issue-metrics.png",
        alt: "Issue metrics table",
      },
      {
        n: 6,
        title: "Module 5 — Issue-wise findings",
        text: "For every issue, the AI drafts the finding — grounds relied on, the analysis, and the conclusion — with citations to the Act, Rules and rulings.",
        img: "issue-wise-findings.png",
        alt: "Issue-wise findings pane",
      },
      {
        n: 7,
        title: "Module 6 — Draft appellate order",
        text: "The final module stitches the findings into a signable appellate order. It's ready to preview, edit and export.",
        img: "draft-appelate-order.png",
        alt: "Complete draft appellate order",
        callout: {
          tone: "info",
          text: "You can re-run any single module without losing the work in the others. The Regenerate button on each module keeps the rest intact.",
        },
      },
    ],
  },

  {
    id: "edit-ai",
    n: 7,
    title: "Edit with AI",
    subtitle: "Ask the AI to change a specific paragraph without redrafting the whole order.",
    icon: <Sparkles className="size-4" />,
    intro:
      "The Edit with AI button on each module lets you fix or expand a single paragraph. Describe the change you want in plain English and the AI rewrites just that section — the rest is untouched.",
    steps: [
      {
        n: 1,
        title: "Click Edit with AI",
        text: "Open the module you want to change and click Edit with AI at the top of that module's card.",
        img: "edit-with-ai.png",
        alt: "Edit with AI button on a module",
      },
      {
        n: 2,
        title: "Describe the change",
        text: "In the prompt box, describe the edit — e.g. \"Tighten the analysis on limitation and add the Supreme Court ruling in Suo Motu Writ (Civil) No 3 of 2020.\"",
        img: "prompt-to-edit-with-ai.png",
        alt: "AI edit prompt with instructions",
      },
      {
        n: 3,
        title: "Apply the change",
        text: "The AI shows a preview of the rewritten paragraph. If it looks right, click Apply change. If not, refine the prompt and try again.",
        img: "click-on-apply-change.png",
        alt: "Preview of the AI edit with Apply change button",
      },
      {
        n: 4,
        title: "Changes done",
        text: "The updated paragraph replaces the original in the module. The rest of the draft — findings, order, other paragraphs — is unchanged and every prior citation is preserved.",
        img: "changes-done.png",
        alt: "Module after the AI edit is applied",
      },
    ],
  },

  {
    id: "edit-manual",
    n: 8,
    title: "Manual edit in Microsoft Word",
    subtitle: "Open the draft in Word, edit as you normally would, and the app picks up your changes.",
    icon: <FileEdit className="size-4" />,
    intro:
      "For deeper edits you can open the draft in Microsoft Word (or any .docx editor). BharathTax watches the file — every save you make in Word is picked up and shows up as a new version in the app.",
    steps: [
      {
        n: 1,
        title: "Click Manual edit",
        text: "Open the module you want to edit and click Manual edit. The app saves a .docx into your Appeal Drafts folder.",
        img: "manual-edit-click.png",
        alt: "Manual edit button on a module",
      },
      {
        n: 2,
        title: "Word opens with the draft",
        text: "The system launches your default .docx handler — usually Microsoft Word. Edit the paragraphs, add annotations, insert tables, whatever you need.",
        img: "open-in-word-manual-edit.png",
        alt: "The draft open in Microsoft Word",
        callout: {
          tone: "info",
          text: "You can keep Word open while you sign other cases in the app. Every time you press Ctrl+S in Word, BharathTax reads the file back and saves it as a new version. Close Word when you're done.",
        },
      },
    ],
  },
];

export default function Docs() {
  const { hash } = useLocation();
  const [q, setQ] = useState("");
  const [activeId, setActiveId] = useState<string>(CHAPTERS[0].id);

  // Deep-link to a chapter via the URL hash.
  useEffect(() => {
    if (!hash) return;
    const id = hash.replace(/^#/, "");
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveId(id || CHAPTERS[0].id);
  }, [hash]);

  // Highlight the active chapter in the TOC as the reader scrolls.
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActiveId(visible.target.id);
      },
      { rootMargin: "-30% 0px -60% 0px", threshold: 0.01 },
    );
    for (const c of CHAPTERS) {
      const el = document.getElementById(c.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return CHAPTERS;
    return CHAPTERS.filter((c) =>
      c.title.toLowerCase().includes(s) ||
      c.subtitle.toLowerCase().includes(s) ||
      (c.intro || "").toLowerCase().includes(s) ||
      c.steps.some((st) => ((st.title || "") + " " + (st.text || "")).toLowerCase().includes(s)),
    );
  }, [q]);

  return (
    <div className="min-h-screen bg-[#FBFCFD] text-slate-900 antialiased flex flex-col">
      <MarketingHeader />

      {/* Hero */}
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10 sm:py-14">
          <Link to="/" className="inline-flex items-center gap-1 text-[13px] text-slate-500 hover:text-slate-800 mb-4">
            <ArrowLeft className="size-3.5" /> Back to home
          </Link>
          <div className="text-[12px] uppercase tracking-[0.18em] text-primary font-semibold">Documentation</div>
          <h1 className="mt-2 font-serif text-[34px] sm:text-[46px] font-semibold tracking-[-0.02em] leading-[1.05] text-slate-900 max-w-3xl">
            The BharathTax Appeal Order desktop manual
          </h1>
          <p className="mt-4 max-w-2xl text-[16px] text-slate-600 leading-relaxed">
            An end-to-end walkthrough with screenshots — install the app, create an
            account, draft an appellate order in six modules, and export a
            signable Word document. Follow the chapters in order the first time;
            jump straight to any step later from the sidebar.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3 text-[13px] text-slate-600">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary font-semibold">
              <Info className="size-3.5" /> Reads in ~10 minutes
            </span>
            <a href="/releases" className="inline-flex items-center gap-1 hover:text-slate-900">
              <Download className="size-3.5" /> Download the desktop app
              <ExternalLink className="size-3" />
            </a>
            <a href="mailto:support@wenvia.global" className="inline-flex items-center gap-1 hover:text-slate-900">
              <HelpCircle className="size-3.5" /> Contact support
            </a>
          </div>
        </div>
      </section>

      {/* Body: TOC + chapters */}
      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10 grid lg:grid-cols-[240px_1fr] gap-10">
          {/* TOC */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400 pointer-events-none" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search chapters…"
                className="w-full h-10 pl-10 pr-3 rounded-lg bg-white border border-slate-200 text-[13.5px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
              />
            </div>
            <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400 font-semibold mb-2 px-1">
              Chapters
            </div>
            <nav className="space-y-0.5">
              {filtered.map((c) => (
                <a
                  key={c.id}
                  href={`#${c.id}`}
                  onClick={() => setActiveId(c.id)}
                  className={
                    "flex items-start gap-2 px-2.5 py-2 rounded-md text-[13.5px] transition-colors " +
                    (activeId === c.id
                      ? "bg-primary/10 text-primary font-semibold"
                      : "text-slate-700 hover:text-slate-900 hover:bg-slate-100")
                  }
                >
                  <span className={
                    "shrink-0 size-6 rounded-md grid place-items-center text-[11px] font-semibold tabular-nums " +
                    (activeId === c.id ? "bg-primary text-white" : "bg-slate-100 text-slate-500")
                  }>
                    {c.n}
                  </span>
                  <span className="min-w-0 flex-1 leading-tight py-0.5">
                    {c.title}
                  </span>
                </a>
              ))}
              {filtered.length === 0 && (
                <div className="px-2 py-6 text-center text-[12.5px] text-slate-500">
                  No chapters match "{q}"
                </div>
              )}
            </nav>
            <div className="mt-6 rounded-lg bg-white ring-1 ring-slate-200 p-3">
              <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1.5">Need help?</div>
              <p className="text-[12.5px] text-slate-600 leading-snug">
                Stuck on a step? Open a support ticket from inside the desktop app
                (sidebar → Report Issue) or email{" "}
                <a href="mailto:support@wenvia.global" className="text-primary hover:underline">
                  support@wenvia.global
                </a>.
              </p>
            </div>
          </aside>

          {/* Chapters */}
          <div className="space-y-14 min-w-0">
            {CHAPTERS.map((c, idx) => (
              <ChapterView key={c.id} c={c} nextId={CHAPTERS[idx + 1]?.id ?? null} />
            ))}

            {/* End of manual */}
            <div className="rounded-2xl bg-white ring-1 ring-slate-200 p-6 sm:p-8">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[11.5px] font-semibold ring-1 ring-emerald-200 mb-3">
                <FileCheck2 className="size-3.5" /> You're done
              </div>
              <h3 className="font-serif text-[22px] font-semibold text-slate-900">
                That's the end-to-end workflow.
              </h3>
              <p className="mt-2 text-[14px] text-slate-600 leading-relaxed">
                From here you can export the draft to Word, open the manual editor,
                or start another case. Any questions? Open a ticket from the app or
                write to us.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <a href="/releases" className="inline-flex items-center gap-1.5 h-10 px-4 rounded-md bg-primary text-white text-[13.5px] font-semibold hover:bg-primary/90">
                  <Download className="size-4" /> Download the app
                </a>
                <Link to="/contact" className="inline-flex items-center gap-1.5 h-10 px-4 rounded-md bg-white ring-1 ring-slate-200 text-slate-800 text-[13.5px] font-semibold hover:bg-slate-50">
                  <HelpCircle className="size-4" /> Contact support
                </Link>
              </div>
            </div>
          </div>
        </div>
      </main>

      <MarketingFooter />
    </div>
  );
}

// One chapter block — anchored heading, ordered steps with screenshot cards.
function ChapterView({ c, nextId }: { c: Chapter; nextId: string | null }) {
  return (
    <section id={c.id} className="scroll-mt-24">
      <div className="flex items-start gap-3">
        <div className="shrink-0 size-10 rounded-lg bg-primary/10 text-primary grid place-items-center">
          {c.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11.5px] uppercase tracking-[0.16em] text-primary font-semibold">
            Chapter {c.n}
          </div>
          <h2 className="mt-1 font-serif text-[26px] sm:text-[30px] font-semibold tracking-tight text-slate-900 leading-tight">
            {c.title}
          </h2>
          <p className="mt-1.5 text-[15px] text-slate-600">{c.subtitle}</p>
        </div>
      </div>

      {c.intro && (
        <p className="mt-5 text-[15px] text-slate-700 leading-relaxed">{c.intro}</p>
      )}

      <ol className="mt-7 space-y-8">
        {c.steps.map((s, i) => (
          <li key={i} className="grid sm:grid-cols-[40px_1fr] gap-x-3 gap-y-2">
            <div className="shrink-0">
              <div className="size-8 rounded-full bg-slate-900 text-white grid place-items-center text-[13px] font-semibold tabular-nums">
                {s.n ?? i + 1}
              </div>
            </div>
            <div className="min-w-0">
              {s.title && (
                <h3 className="font-serif text-[18px] font-semibold text-slate-900 tracking-tight leading-snug">
                  {s.title}
                </h3>
              )}
              {s.text && (
                <p className="mt-1.5 text-[14.5px] text-slate-700 leading-relaxed">
                  {s.text}
                </p>
              )}
              {s.img && (
                <figure className="mt-4 rounded-xl overflow-hidden ring-1 ring-slate-200 bg-white shadow-sm">
                  <img
                    src={`/manual/${s.img}`}
                    alt={s.alt || s.title || "Screenshot"}
                    loading="lazy"
                    className="w-full h-auto block"
                  />
                  {s.alt && (
                    <figcaption className="px-3 py-2 text-[11.5px] text-slate-500 border-t border-slate-100 italic">
                      {s.alt}
                    </figcaption>
                  )}
                </figure>
              )}
              {s.callout && (
                <div className={
                  "mt-3 rounded-lg px-3.5 py-2.5 text-[13px] leading-relaxed border " +
                  (s.callout.tone === "warn"
                    ? "bg-amber-50 border-amber-200 text-amber-900"
                    : "bg-primary/5 border-primary/20 text-slate-700")
                }>
                  <div className="flex items-start gap-2">
                    <Info className="size-4 shrink-0 mt-0.5 text-primary" />
                    <div><strong className="text-slate-900 font-semibold">Tip. </strong>{s.callout.text}</div>
                  </div>
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>

      {nextId && (
        <div className="mt-8 pt-6 border-t border-slate-200">
          <a
            href={`#${nextId}`}
            className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-primary hover:underline"
          >
            Next chapter <ChevronRight className="size-4" />
          </a>
        </div>
      )}
    </section>
  );
}
