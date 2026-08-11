import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Download, UserPlus, Globe, PackagePlus, LogIn, FolderPlus,
  PlayCircle, FileCheck2, Sparkles, FileEdit, Info,
  ChevronRight, ArrowLeft, Search, ExternalLink, HelpCircle,
} from "lucide-react";
import { MarketingHeader, MarketingFooter } from "@/components/marketing/MarketingShell";

// End-to-end user manual for the BharatTax Appeal Order desktop app.
// The 26 screenshots in /public/manual (named 1.png … 26.png in the order
// a first-time user encounters them) are used exactly once each:
//
//   1        Web releases page — Download installer
//   2, 3, 4  Web signup — empty form → filled → "You're all set"
//   5        Web /ask after signin
//   6, 7     Installer — Choose options → Choose location
//   8, 9     Desktop app — first launch → Appeal cases dashboard
//   10–13    New case dialog empty → filled → file picker → 15 files uploaded
//   14–19    Pipeline complete → Modules 1-5 outputs
//   20       Module 6 — Draft appellate order
//   21, 22   Manual edit tab → Draft open in Word
//   23–26    Modify with AI — popover → prompt → Applying → result

type Step = {
  n?: number;
  title?: string;
  text?: string;
  img?: string;              // filename in /manual (e.g. "6.png")
  alt?: string;
  callout?: { tone: "info" | "warn"; text: string };
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
    id: "download",
    n: 1,
    title: "Download the installer",
    subtitle: "Grab the Windows installer from the public releases page.",
    icon: <Download className="size-4" />,
    intro:
      "The desktop app is a signed Windows installer. It's the fastest way to draft appellate orders because drafts save straight to your machine and open in Microsoft Word for review.",
    steps: [
      {
        n: 1,
        title: "Open the releases page in your browser",
        text: "Visit bharattax.wenvia.global/releases and click Download installer for the latest version. Portable (.exe) is also available if you'd rather not install.",
        img: "1.png",
        alt: "BharatTax releases page with Download installer and Portable buttons",
        callout: {
          tone: "info",
          text: "Save the .exe somewhere you'll find easily (Downloads is fine). You'll come back to it in Chapter 4 once your account is ready.",
        },
      },
    ],
  },

  {
    id: "signup",
    n: 2,
    title: "Sign up on the website",
    subtitle: "One signup — the same login works on the web app and the desktop app.",
    icon: <UserPlus className="size-4" />,
    intro:
      "You register once from any browser. Your trial licence is auto-issued so you can start immediately. The same email and password work on both the web app and the desktop app.",
    steps: [
      {
        n: 1,
        title: "Open the signup page",
        text: "Go to bharattax.wenvia.global/register. You'll see the Create your account form with the marketing pitch on the left.",
        img: "2.png",
        alt: "Public sign-up page with empty form fields",
      },
      {
        n: 2,
        title: "Fill in your details",
        text: "Enter your full name, official email and a strong password (minimum six characters). The strength meter fills up green when the password is Strong. Confirm the password and click Create account.",
        img: "3.png",
        alt: "Sign-up form filled in with a Strong strength meter and Passwords match indicator",
      },
      {
        n: 3,
        title: "Free trial active",
        text: "You'll see a You're all set confirmation. Your 100,000-token free trial is active and your licence has been auto-assigned. Click Sign in now to continue.",
        img: "4.png",
        alt: "Signup confirmation with Free trial active badge and Sign in now button",
        callout: {
          tone: "info",
          text: "Your admin can extend or upgrade the licence later without changing your sign-in details.",
        },
      },
    ],
  },

  {
    id: "web-signin",
    n: 3,
    title: "Sign in on the website",
    subtitle: "Confirm your account works and (optionally) try the web app.",
    icon: <Globe className="size-4" />,
    intro:
      "The web app runs at bharattax.wenvia.global and gives you the Ask / Rulings / Documents workspace. Signing in here is a quick way to confirm your credentials work before you install the desktop app.",
    steps: [
      {
        n: 1,
        title: "You're inside the web app",
        text: "After Sign in now, you land on the Ask page — a Government-of-India-branded chat that answers your tax-law questions with inline citations to the Act, Rules and CBDT circulars.",
        img: "5.png",
        alt: "Web Ask page with Hello, Tapash greeting and suggested starter cards",
        callout: {
          tone: "info",
          text: "The web app is great for research. Drafting a full appellate order runs in the desktop app — continue to Chapter 4 to install it.",
        },
      },
    ],
  },

  {
    id: "installer",
    n: 4,
    title: "Run the installer",
    subtitle: "Open the .exe you downloaded and set up the app.",
    icon: <PackagePlus className="size-4" />,
    intro:
      "Now that your account exists, run the installer you saved in Chapter 1. If Windows SmartScreen shows a warning, click More info → Run anyway — the installer is signed and only ever comes from the releases page.",
    steps: [
      {
        n: 1,
        title: "Choose the installation type",
        text: "Double-click the .exe. The installer asks whether to install for Anyone who uses this computer (all users) or Only for me. Pick your preference and click Next.",
        img: "6.png",
        alt: "BharatTax Appeal Order Setup — Choose Installation Options",
      },
      {
        n: 2,
        title: "Pick the install location — default or browse",
        text: "The installer proposes a default folder (you only need about 200 MB free). Click Browse… if you want a different location, otherwise leave it as-is and click Install. Files are copied in a few seconds.",
        img: "7.png",
        alt: "Installer — Choose Install Location with destination folder and Browse button",
        callout: {
          tone: "info",
          text: "Installing under D:\\Formonex\\BharatTax Appeal Order (or similar) keeps your Appeal Drafts folder outside C: so drafts survive even if you reinstall Windows.",
        },
      },
    ],
  },

  {
    id: "open-signin",
    n: 5,
    title: "Open the app and sign in",
    subtitle: "Use the same email and password from your web signup.",
    icon: <LogIn className="size-4" />,
    steps: [
      {
        n: 1,
        title: "The app opens on the Sign-in screen",
        text: "When the installer finishes, BharatTax Appeal Order launches automatically. You'll see the Government of India / Income Tax Department branded sign-in screen. Type the email and password you registered with in Chapter 2 and click Sign in.",
        img: "8.png",
        alt: "Desktop app first-launch Sign in screen",
        callout: {
          tone: "info",
          text: "You can also relaunch the app any time from the Start Menu or Desktop shortcut.",
        },
      },
      {
        n: 2,
        title: "Appeal cases dashboard",
        text: "The app opens on the Appeal cases dashboard. The banner shows your licence validity, four status tiles (Total / Running / Ready / Errors), and buttons to start a new appeal or open the case list.",
        img: "9.png",
        alt: "Desktop Appeal cases dashboard with the Income-Tax Department seal",
      },
    ],
  },

  {
    id: "case-upload",
    n: 6,
    title: "Create a case and upload the files",
    subtitle: "Give the case a title, then add the appeal file — order, grounds, evidence and correspondence.",
    icon: <FolderPlus className="size-4" />,
    intro:
      "Each appeal lives in its own case. Create the case first, then upload every relevant document — the AI drafts from the documents you provide and nothing else.",
    steps: [
      {
        n: 1,
        title: "Open the New appeal case dialog",
        text: "Click New Appeal in the sidebar (or the + icon at the top of the Appeals list). The New appeal case dialog opens with placeholder text for each field.",
        img: "10.png",
        alt: "New appeal case dialog with empty fields and placeholder examples",
      },
      {
        n: 2,
        title: "Fill in the case details and create",
        text: "Enter a short Case title (mandatory) and optionally the Assessment year, PAN and Section. Click Create & open — the case opens in its own workspace.",
        img: "11.png",
        alt: "New appeal case dialog filled with case name, AY, PAN and section",
      },
      {
        n: 3,
        title: "Browse and select the files",
        text: "In the case workspace, click + Upload case files (top-right of the Documents panel). The Select case documents picker opens — browse to your case folder and pick one or more PDFs, DOCX or plain-text files. Multi-select is supported. Click Open.",
        img: "12.png",
        alt: "Windows file picker titled Select case documents",
      },
      {
        n: 4,
        title: "Documents indexed and ready",
        text: "Each file appears in the list with its filename, page count and an editable category (Written_submission / Assessment_order / Form_35 / Unclassified). Wait for indexing dots to disappear before running the pipeline.",
        img: "13.png",
        alt: "Documents panel showing 15 uploaded files with categories and view / download / delete controls",
        callout: {
          tone: "warn",
          text: "Files over 100 MB may take a minute to index. Don't close the case tab during upload.",
        },
      },
    ],
  },

  {
    id: "pipeline",
    n: 7,
    title: "Click Run pipeline",
    subtitle: "Six modules run in sequence — deficiency, scope, compliance, issues, findings.",
    icon: <PlayCircle className="size-4" />,
    intro:
      "Once the documents are indexed, run the pipeline. It executes six modules in sequence and stops if any module errors so you can fix it before the next one starts.",
    steps: [
      {
        n: 1,
        title: "Scroll to the Pipeline panel and click Run pipeline",
        text: "Scroll down past the Documents list. You'll see the Pipeline progress panel with six steps. Click Run pipeline. When every step finishes it's green-ticked and the header reads 6/6 · 100%.",
        img: "14.png",
        alt: "Pipeline progress panel with all six modules complete and Re-run pipeline / Reassemble draft buttons",
      },
      {
        n: 2,
        title: "Module 1 — Deficiency Report",
        text: "Expand Module 1 to see the procedural-deficiency check: Form 35, appeal fee, tax on returned income, limitation. Each item lists what's on record and what (if anything) needs curing.",
        img: "15.png",
        alt: "Deficiency Report output with Form 35, Appeal Fee, Tax on Returned Income and Limitation sections",
      },
      {
        n: 3,
        title: "Module 2 — Scope Validation",
        text: "Module 2 confirms appealability under Section 246A, checks for excluded / sensitive categories and lists the grounds of appeal actually raised.",
        img: "16.png",
        alt: "Scope Validation report with appeal details and validation conclusion",
      },
      {
        n: 4,
        title: "Module 3 — Document Compliance",
        text: "Every uploaded document is re-listed with the number of characters extracted and its assigned category — so you can confirm nothing was misread by OCR.",
        img: "17.png",
        alt: "Document Compliance panel with each appeal document, category and extracted chars",
      },
      {
        n: 5,
        title: "Module 4 — Issue Matrix",
        text: "The tool extracts each ground of appeal, numbers them (#1, #2, #3…), and shows a short Facts summary explaining what the AO did and how the appellant responded.",
        img: "18.png",
        alt: "Issue Matrix listing numbered grounds of appeal and a Facts summary",
      },
      {
        n: 6,
        title: "Module 5 — Issue-wise Findings",
        text: "For every issue, the AI drafts the Facts, Submissions, AO's view and Legal position with citations to the Act, Rules and case law.",
        img: "19.png",
        alt: "Module 5 output — Issue-wise Findings for Ground No. 1",
        callout: {
          tone: "info",
          text: "You can Re-run any single module without losing the work in the others — the Regenerate button on each module keeps the rest intact.",
        },
      },
    ],
  },

  {
    id: "draft",
    n: 8,
    title: "Your draft appellate order",
    subtitle: "Module 6 stitches every finding into a signable appellate order.",
    icon: <FileCheck2 className="size-4" />,
    steps: [
      {
        n: 1,
        title: "Preview, download or edit",
        text: "Module 6 assembles the full appellate order — grounds, facts, submissions, AO's view, findings and the operative order — into a preview pane. From here you can Preview the PDF, Download .docx, Open in Word, Modify with AI (Chapter 10) or Manual edit (Chapter 9).",
        img: "20.png",
        alt: "Draft appellate order screen with Preview, Modify with AI, Manual edit and Download buttons",
        callout: {
          tone: "info",
          text: "The draft is stored in your Appeal Drafts folder on disk. Even if you close the app, the .docx is still there — the app doesn't delete drafts.",
        },
      },
    ],
  },

  {
    id: "manual-edit",
    n: 9,
    title: "Modify manually",
    subtitle: "Open the draft in Microsoft Word and edit as you normally would.",
    icon: <FileEdit className="size-4" />,
    intro:
      "For deeper edits, open the draft in Microsoft Word (or any .docx editor). BharatTax watches the file — every save in Word syncs back as a new draft version in the app.",
    steps: [
      {
        n: 1,
        title: "Switch to the Manual edit tab",
        text: "From the draft appellate order, click the Manual edit tab. You'll see a large Open in Word button along with Download .docx and Preview options.",
        img: "21.png",
        alt: "Manual edit tab with Edit the draft in Microsoft Word placeholder and Open in Word button",
      },
      {
        n: 2,
        title: "Edit in Word",
        text: "Click Open in Word. The .docx opens in your default handler — usually Microsoft Word. Edit the paragraphs, insert tables, add annotations — everything you'd do in a normal Word document.",
        img: "22.png",
        alt: "The draft open in Microsoft Word with formatted paragraphs and standard Word toolbar",
        callout: {
          tone: "info",
          text: "Every time you press Ctrl+S in Word, BharatTax reads the file back and saves it as a new draft version. Close Word when you're done.",
        },
      },
    ],
  },

  {
    id: "ai-edit",
    n: 10,
    title: "Modify with AI",
    subtitle: "Rewrite a specific passage without redrafting the whole order.",
    icon: <Sparkles className="size-4" />,
    intro:
      "The Modify with AI popover lets you fix or expand a single passage. Select the phrase you want changed, describe the edit in plain English, and the AI rewrites just that section — the rest of the draft is untouched.",
    steps: [
      {
        n: 1,
        title: "Open the Modify with AI popover",
        text: "Select the phrase you want to change (e.g. \"higher demand\"). The Modify with AI popover appears with that phrase pre-filled and an empty instruction box.",
        img: "23.png",
        alt: "Modify with AI popover with the selected phrase pre-filled",
      },
      {
        n: 2,
        title: "Describe the change",
        text: "Type your instruction — e.g. \"make it bold\", \"tighten this paragraph\", or \"add the Supreme Court ruling in Suo Motu Writ (Civil) No 3 of 2020\". Short imperatives work best.",
        img: "24.png",
        alt: "Modify with AI popover with an instruction typed into the box",
      },
      {
        n: 3,
        title: "Apply the change",
        text: "Click Apply change. The Applying… state appears while the AI rewrites the passage. Cancel is still available if you change your mind.",
        img: "25.png",
        alt: "Modify with AI popover showing the Applying state during processing",
      },
      {
        n: 4,
        title: "Changes done",
        text: "The updated text replaces the original in the draft. The rest of the paragraph is unchanged and every prior citation is preserved.",
        img: "26.png",
        alt: "Draft paragraph after the AI edit — the selected phrase now formatted as requested",
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
            The BharatTax Appeal Order desktop manual
          </h1>
          <p className="mt-4 max-w-2xl text-[16px] text-slate-600 leading-relaxed">
            An end-to-end walkthrough with screenshots — download the installer,
            sign up on the web, install the desktop app, upload the appeal file,
            draft an appellate order in six modules and modify it manually or
            with AI. Follow the chapters in order the first time; jump straight
            to any step later from the sidebar.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3 text-[13px] text-slate-600">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary font-semibold">
              <Info className="size-3.5" /> {CHAPTERS.length} chapters · reads in ~10 minutes
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
                or start another case. Questions? Open a ticket from the app or
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
