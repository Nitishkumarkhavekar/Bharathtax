// Contextual "How to use this" content, keyed by page. Rendered by the
// <PageHelp id="…" /> button that sits in each page header. One place to write
// and maintain every feature's what / when / how, so officers (and testers)
// can always find out what a page does without leaving it.

export interface HelpContent {
  title: string;
  what: string;              // one plain sentence: what it is
  when: string;              // the officer's scenario: when to use it
  how: string[];             // 2–4 numbered steps
  example?: string;          // optional concrete example
  note?: string;             // optional caveat
}

export const PAGE_HELP: Record<string, HelpContent> = {
  dashboard: {
    title: "Your Desk",
    what: "Your caseload at a glance — the matters you hold, what's due next, overdue items, and (for Recovery/AO) the outstanding demand — tailored to your function.",
    when: "Your daily starting point: open it to see what needs attention today, sorted by what's due next.",
    how: [
      "The tiles summarise your caseload — matters, open deadlines, overdue, and demand outstanding.",
      "Use the chips to filter to your function (Mine) or view All.",
      "Click any matter to open it in the Calendar.",
      "Sort by most-urgent, overdue, or recently updated.",
    ],
  },
  chat: {
    title: "Chat",
    what: "Citation-grounded AI chat for Indian income-tax. Ask any question or upload a notice/order; every answer links to the exact section, rule, circular or judgment — and refuses to guess when the law is silent.",
    when: "For research, a quick legal position, or to understand a document — with sources you can verify before you rely on them.",
    how: [
      "Type your question in plain English, or attach a PDF (a notice, order or reply).",
      "Read the answer with its inline citations; click a citation to see the source.",
      "Ask a follow-up — it remembers the conversation.",
      "It adapts to your role, jurisdiction and instructions set in your Profile.",
    ],
  },
  calendar: {
    title: "Calendar & matters",
    what: "Your matters and their statutory deadlines. Enter one trigger date and BharatTax computes every limitation date — time-barring u/s 153, appeal windows, the DRP clock, 220(2) — each section-cited, with reminders.",
    when: "To track every case you hold by PAN and AY, and never let anything go time-barred.",
    how: [
      "Add a matter with the assessee's PAN and assessment year.",
      "Enter the trigger date (e.g. the order date or notice date).",
      "The statutory deadlines compute automatically — add reminders on any of them.",
      "The notification bell surfaces reminders the moment they fall due.",
    ],
    example: "Enter a 143(3) order date and it lays out the 263 revision window, the appeal window, and the 220(2) interest clock.",
  },
  drafting: {
    title: "Drafting",
    what: "Generates the officer's actual paperwork — assessment orders, CIT(A)/NFAC appellate orders, and notices (142(1), 143(2), show-cause, 226(3), 92CA, 131, 133(6) and more) — cited to primary law and exported to editable Word.",
    when: "When you need a grounded first draft of an order or notice to review and finalise, rather than writing from a blank page.",
    how: [
      "Pick the tab: Assessment orders, Appeal orders, or Notices & orders.",
      "For orders: create a case, upload the documents (return, notices, replies), and Run — it drafts issue-wise with a computation.",
      "For notices: pick the template, fill the fields, and Generate.",
      "Review every citation and figure, edit as needed, then export to Word.",
    ],
    note: "It produces a DRAFT — you apply independent mind and sign.",
  },
  reconcile: {
    title: "Reconcile & SFT scan",
    what: "Matches the assessee's AIS (Annual Information Statement) against Form 26AS to flag genuine mismatches — income or TDS that appears in one but not the other — and scans a transaction list for Rule 114E high-value (SFT) reporting.",
    when: "During scrutiny or verification, to spot unreported receipts or TDS-credit gaps before framing a query, and to catch reportable high-value transactions.",
    how: [
      "Paste or upload the AIS rows in the first box.",
      "Paste or upload the Form 26AS rows in the second box.",
      "Click Reconcile — mismatches are listed with the amount and category.",
      "Use the SFT tab to scan a transaction list against the Rule 114E thresholds.",
    ],
    example: "Interest income of ₹2,10,000 in AIS but absent from 26AS → flagged as an under-reporting mismatch.",
  },
  calculators: {
    title: "Statutory calculators",
    what: "Calculators for the figures an officer computes by hand — interest u/s 234A/B/C and 220(2), tax u/s 115BBE, slab tax, capital gains, TDS, the ALP/TP range, peak credit and more — each showing the workings.",
    when: "Whenever you need a defensible number for an order, a demand or a reply, with the computation shown so it's auditable.",
    how: [
      "Pick the calculator tab (e.g. Interest, 115BBE, ALP/TP, Peak credit).",
      "Enter the figures and dates in the inputs.",
      "The result and the step-by-step working appear alongside.",
      "Use Clear to reset and run another.",
    ],
  },
  rulings: {
    title: "Rulings",
    what: "Searches decided case law — Supreme Court, High Courts and ITAT — with paragraph-level citations, and lets you browse fresh judgments by section or bench.",
    when: "To find precedent for or against a position before you frame an addition or decide a ground of appeal.",
    how: [
      "Type the issue, party or a section in the search box.",
      "Open a result to read the held portion with its citation.",
      "Browse recent judgments on a section from the hub.",
      "Watchlist a section to be alerted to new rulings on it.",
    ],
  },
  watchlists: {
    title: "Watchlists",
    what: "Tracks the sections and assessees you care about, so fresh rulings and updates on them are one click away.",
    when: "When you want to follow developments on a recurring issue or a specific taxpayer.",
    how: [
      "Add a section (e.g. 68) or an assessee's name to your watchlist.",
      "Open a watchlist entry to jump to fresh rulings on it.",
      "Remove entries you no longer need.",
    ],
  },
};
