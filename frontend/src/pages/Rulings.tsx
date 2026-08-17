import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen, Loader2, ArrowUpRight, AlertTriangle, Search, Hash, Scale, FileText, Gavel,
  Filter, ChevronLeft, ChevronRight, Calendar as CalendarIcon, MapPin, User, Inbox,
} from "lucide-react";
import { api } from "../api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const POPULAR = ["68", "14A", "37", "40", "271", "148", "147", "69A", "54", "10", "80IB", "263"];

function ErrBox({ msg }: { msg: string }) {
  return <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{msg}</div>;
}

// Clickable chips of the sections a judgment cites -> jump to that Section hub.
function SectionChips({ sections, onPick }: { sections?: string[] | null; onPick: (s: string) => void }) {
  if (!sections?.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {sections.slice(0, 10).map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onPick(s)}
          title={`See everything on section ${s}`}
          className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-medium px-2 py-0.5 hover:bg-primary/20 transition-colors"
        >
          <Hash className="size-2.5" />{s}
        </button>
      ))}
    </div>
  );
}

// Map an eCourts caseStatus code (or any free-text status) to a coloured
// badge tone. Tones are hand-picked so a glance at the strip tells you
// whether the case ended in the assessee's favour (green), the revenue's
// favour (rose), is still open (amber), or was procedurally closed (slate).
type StatusTone = "emerald" | "rose" | "amber" | "slate" | "primary";
function _statusTone(status: string): StatusTone {
  const s = status.toUpperCase();
  if (s === "ALLOWED" || s === "PARTLY_ALLOWED" || s === "ACCEPTED") return "emerald";
  if (s === "DISMISSED" || s === "DISMISSED_IN_DEFAULT" || s === "REJECTED") return "rose";
  if (
    s === "PENDING" || s === "FILED" || s === "HEARING" ||
    s === "PART_HEARD" || s === "RESERVED" || s === "ADJOURNED" ||
    s === "REGISTERED" || s === "LISTED" || s === "FIRST_HEARING"
  ) return "amber";
  if (s === "DISPOSED" || s === "DISMISSED_AS_WITHDRAWN" || s === "TRANSFERRED") return "slate";
  return "primary";
}
const _TONE_CLASSES: Record<StatusTone, string> = {
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  rose: "bg-rose-50 text-rose-700 ring-rose-200",
  amber: "bg-amber-50 text-amber-700 ring-amber-200",
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  primary: "bg-primary/10 text-primary ring-primary/25",
};
function StatusBadge({ status }: { status: string }) {
  if (!status) return null;
  const tone = _statusTone(status);
  // Prettify: "DISMISSED_IN_DEFAULT" → "Dismissed in default"
  const label = status
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
  return (
    <span className={cn(
      "inline-flex items-center text-[10.5px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ring-1 whitespace-nowrap shrink-0",
      _TONE_CLASSES[tone],
    )}>
      {label}
    </span>
  );
}

function CaseCard({ title, digest, snippet, sourceUrl, sections, status, onPick }: {
  title: string; digest?: string | null; snippet?: string | null;
  sourceUrl?: string | null; sections?: string[] | null;
  /** Case status (e.g. "DISPOSED", "DISMISSED", "ALLOWED") — rendered as
   *  a coloured badge next to the title. Optional. */
  status?: string | null;
  onPick: (s: string) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-primary/40 transition-colors">
      <div className="font-medium text-[13px] text-slate-900 flex items-start gap-1.5">
        <Gavel className="size-3.5 text-slate-400 shrink-0 mt-0.5" />
        <span className="min-w-0 flex-1">{title}</span>
        {status && <StatusBadge status={status} />}
      </div>
      {digest && (
        <div className="mt-2 rounded-lg border-l-2 border-emerald-400 bg-emerald-50/70 px-3 py-1.5 text-[12.5px] text-slate-800">
          <span className="font-semibold text-emerald-700">Held: </span>{digest}
        </div>
      )}
      {snippet && <p className="text-[12px] text-slate-500 mt-2 line-clamp-2">{snippet}</p>}
      <div className="mt-2 flex items-center justify-between gap-2">
        <SectionChips sections={sections} onPick={onPick} />
        {sourceUrl && (
          <a href={sourceUrl} target="_blank" rel="noreferrer"
            className="shrink-0 inline-flex items-center gap-0.5 text-[11.5px] text-primary hover:underline">
            open source <ArrowUpRight className="size-3" />
          </a>
        )}
      </div>
    </div>
  );
}

function SectionHubView({ hub, onPick }: { hub: any; onPick: (s: string) => void }) {
  if (hub.error) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 text-amber-800 text-sm px-4 py-3 flex items-start gap-2">
        <AlertTriangle className="size-4 mt-0.5 shrink-0" /> Unrecognised section "{hub.section}". Try a number like 68, 14A, or 271.
      </div>
    );
  }
  const c = hub.counts || {};
  return (
    <div className="space-y-4">
      <div className="text-[13px] text-slate-500">
        Section <span className="font-semibold text-slate-900">{hub.section}</span>
        {" · "}{c.cases_total ?? 0} judgment{c.cases_total === 1 ? "" : "s"}
        {" · "}{c.circulars ?? 0} circular/notification{c.circulars === 1 ? "" : "s"}
      </div>

      {hub.statute?.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-1.5">
            <Scale className="size-4 text-primary" /> The provision
          </div>
          {hub.statute.map((s: any, i: number) => (
            <div key={i} className={i ? "mt-3 pt-3 border-t border-slate-100" : ""}>
              <div className="text-[12px] font-medium text-slate-500">{s.breadcrumb}</div>
              <p className="text-[13px] text-slate-700 mt-1 whitespace-pre-wrap line-clamp-[10]">{s.text}</p>
            </div>
          ))}
        </div>
      )}

      {hub.circulars?.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-1.5">
            <FileText className="size-4 text-primary" /> CBDT circulars &amp; notifications ({hub.circulars.length})
          </div>
          <ul className="space-y-1.5">
            {hub.circulars.map((cir: any) => (
              <li key={cir.doc_id} className="flex items-start gap-2 text-[13px]">
                <span className="mt-1.5 size-1.5 rounded-full bg-primary/50 shrink-0" />
                <div className="min-w-0">
                  <span className="text-slate-800">{cir.title}</span>
                  {cir.date && <span className="text-slate-400 text-[11.5px]"> · {cir.date}</span>}
                  {cir.source_url && (
                    <a href={cir.source_url} target="_blank" rel="noreferrer" className="ml-1.5 text-primary hover:underline text-[11.5px]">open</a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {hub.cases?.length > 0 ? (
        <div>
          <div className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-1.5">
            <Gavel className="size-4 text-primary" /> Leading judgments
            {c.cases_total > c.cases_shown && (
              <span className="text-slate-400 font-normal text-[12px]">(showing {c.cases_shown} of {c.cases_total})</span>
            )}
          </div>
          <div className="space-y-3">
            {hub.cases.map((cs: any) => (
              <CaseCard key={cs.doc_id} title={cs.title} digest={cs.digest}
                sourceUrl={cs.source_url} sections={cs.sections_cited} onPick={onPick} />
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white text-slate-500 text-sm px-4 py-3">
          No judgments citing section {hub.section} are in the corpus yet.
        </div>
      )}
    </div>
  );
}

export default function Rulings() {
  const [mode, setMode] = useState<"search" | "section" | "browse" | "bydate">("search");

  // Preset date passed to ByDateView / BrowseView on mount. Used when the
  // user clicks a "Recently pronounced" chip on the Search tab — because
  // ByDateView isn't mounted at the moment of the click, a CustomEvent
  // wouldn't be caught. A prop survives the mount cycle. `preset.key` is a
  // monotonic counter so re-clicking the SAME date still re-triggers the
  // child's effect (which depends on the key changing).
  const [preset, setPreset] = useState<{ date: string; key: number }>({ date: "", key: 0 });
  const jumpToDate = (iso: string) => {
    setPreset((p) => ({ date: iso, key: p.key + 1 }));
    setMode("bydate");
  };

  const [q, setQ] = useState("");
  const [res, setRes] = useState<Awaited<ReturnType<typeof api.rulings>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const [sec, setSec] = useState("");
  const [hub, setHub] = useState<any>(null);
  const [hubBusy, setHubBusy] = useState(false);
  const [hubErr, setHubErr] = useState("");

  async function search(e?: FormEvent) {
    e?.preventDefault();
    await runSearch(q);
  }
  // Fire a search against a specific query — bypasses the state round-trip
  // so callers (Popular Topics chip click, etc.) can trigger the search
  // immediately without waiting for React to flush the setQ() update.
  async function runSearch(text: string) {
    const t = (text || "").trim();
    if (!t) return;
    setBusy(true); setErr(""); setRes(null);
    try { setRes(await api.rulings(t)); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function loadSection(s: string) {
    const clean = s.trim().toUpperCase();
    if (!clean) return;
    setMode("section"); setSec(clean); setHubBusy(true); setHubErr(""); setHub(null);
    try { setHub(await api.crossref(clean)); } catch (e: any) { setHubErr(e.message); } finally { setHubBusy(false); }
  }

  const tab = (id: "search" | "section" | "browse" | "bydate", icon: JSX.Element, text: string) => (
    <button
      type="button"
      onClick={() => {
        // Clicking a tab directly = "start fresh in this tab". Clear any
        // preset date left over from a prior chip click, so ByDateView /
        // BrowseView don't auto-load a stale date. (Chip clicks bump
        // preset.key to trigger the auto-load — direct tab clicks skip it.)
        if (id !== mode) setPreset({ date: "", key: 0 });
        setMode(id);
      }}
      className={cn(
        "inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded font-medium transition-colors",
        mode === id ? "bg-primary text-primary-foreground shadow-sm" : "text-slate-600 hover:text-slate-900",
      )}
    >
      {icon} {text}
    </button>
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-serif text-xl font-semibold flex items-center gap-2">
          <BookOpen className="size-5 text-primary" /> Case Law
        </h2>
        <p className="text-sm text-muted-foreground">
          Search income-tax judgments (HC / SC) with AI headnotes, or browse everything on a section.
        </p>
      </div>

      <div className="inline-flex rounded-lg border border-input bg-background p-0.5 text-sm">
        {tab("search", <Search className="size-4" />, "Search")}
        {tab("section", <Hash className="size-4" />, "By Section")}
        {tab("bydate", <CalendarIcon className="size-4" />, "By Date")}
        {tab("browse", <Filter className="size-4" />, "Browse")}
      </div>

      {mode === "search" && (
        <>
          <form onSubmit={search} className="flex gap-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="e.g. unexplained share application money, section 68 creditworthiness"
            />
            <Button type="submit" disabled={busy}>
              {busy ? <><Loader2 className="size-4 animate-spin" /> Searching…</> : "Search"}
            </Button>
          </form>

          <StatsRow />

          {err && <ErrBox msg={err} />}
          {res && !res.results.length && !res.ecourts?.items?.length && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 text-amber-800 text-sm px-4 py-3 flex items-start gap-2">
              <AlertTriangle className="size-4 mt-0.5 shrink-0" /> No matching judgments. Try different wording, or browse By Section.
            </div>
          )}
          {res && res.results.length > 0 && (
            <div className="space-y-3">
              <div className="text-[11.5px] uppercase tracking-wider font-semibold text-slate-500 mt-1">
                From your indexed corpus ({res.results.length})
              </div>
              {res.results.map((r, i) => (
                <CaseCard key={i} title={r.breadcrumb} digest={r.digest ?? undefined} snippet={r.snippet}
                  sourceUrl={r.source_url} sections={r.sections_cited ?? null} onPick={loadSection} />
              ))}
            </div>
          )}
          {/* eCourts India live results — parallel-fetched, cached 5 min. */}
          {res && res.ecourts?.items?.length > 0 && (
            <div className="space-y-3 mt-6">
              <div className="text-[11.5px] uppercase tracking-wider font-semibold text-slate-500 flex items-center gap-2">
                <span>Also in eCourts India</span>
                {res.ecourts.total > 0 && (
                  <span className="text-slate-400 normal-case text-[11px]">
                    · {res.ecourts.total.toLocaleString("en-IN")} total match{res.ecourts.total === 1 ? "" : "es"}
                  </span>
                )}
              </div>
              {res.ecourts.items.map((it) => (
                <CaseCard
                  key={it.cnr || it.title}
                  title={it.title}
                  digest={it.digest ?? undefined}
                  sourceUrl={it.source_url}
                  sections={it.sections_cited}
                  status={it.status}
                  onPick={loadSection}
                />
              ))}
            </div>
          )}

          {/* Landing widgets — hidden while the user is looking at search
              results so the results stay above the fold. */}
          {!res && !err && (
            <>
              <RecentJudgments
                onPick={loadSection}
                onViewAll={() => {
                  // Switch to Browse — unfiltered full list, paginated.
                  setPreset((p) => ({ date: "", key: p.key + 1 }));
                  setMode("browse");
                }}
              />
              <PopularTopics
                onPickQuery={(text) => {
                  // Reflect the chip's query in the search box AND fire the
                  // search immediately so results appear without a second click.
                  setQ(text);
                  runSearch(text);
                }}
              />
              <RecentDates
                onPickDate={(iso) => {
                  // Jump to By-Date tab. jumpToDate bumps the preset key so
                  // ByDateView's effect fires — even when the user re-clicks
                  // the same date, they get a fresh fetch.
                  jumpToDate(iso);
                }}
              />
            </>
          )}
        </>
      )}
      {mode === "section" && (
        <>
          <form onSubmit={(e) => { e.preventDefault(); loadSection(sec); }} className="flex gap-2">
            <Input value={sec} onChange={(e) => setSec(e.target.value)}
              placeholder="Section number — e.g. 68, 14A, 271" className="max-w-xs" />
            <Button type="submit" disabled={hubBusy}>
              {hubBusy ? <><Loader2 className="size-4 animate-spin" /> Loading…</> : "Show hub"}
            </Button>
          </form>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-400 mr-0.5">Popular:</span>
            {POPULAR.map((s) => (
              <button key={s} type="button" onClick={() => loadSection(s)}
                className="rounded-full bg-slate-100 text-slate-600 text-[11.5px] px-2.5 py-0.5 hover:bg-primary/10 hover:text-primary transition-colors">
                s. {s}
              </button>
            ))}
          </div>
          {hubErr && <ErrBox msg={hubErr} />}
          {hubBusy && (
            <div className="text-sm text-slate-500 inline-flex items-center gap-2 py-4">
              <Loader2 className="size-4 animate-spin" /> Building the section hub…
            </div>
          )}
          {hub && !hubBusy && <SectionHubView hub={hub} onPick={loadSection} />}
        </>
      )}
      {mode === "browse" && <BrowseView onPick={loadSection} preset={preset} />}
      {mode === "bydate" && <ByDateView onPick={loadSection} preset={preset} />}
    </div>
  );
}

// ─── Browse tab ──────────────────────────────────────────────────────────
// Filter cases by bench, date range, and judge name. When ECOURTS_API_KEY
// is set, queries live eCourts India (~28 Cr cases). Otherwise falls back
// to our small local corpus.
//
// Bench → state mapping: ITAT bench cities map to a home state code. Since
// eCourts filters by state, picking "Ahmedabad" filters to Gujarat cases,
// courtLevel=TRIBUNAL for ITAT-only results.
// ITAT city benches → home state code (eCourts uses stateCodes filter).
const BENCH_TO_STATE: Record<string, string> = {
  Agra: "UP", Ahmedabad: "GJ", Allahabad: "UP", Amritsar: "PB",
  Bangalore: "KA", Chandigarh: "CH", Chennai: "TN", Cochin: "KL",
  Cuttack: "OR", Delhi: "DL", Guwahati: "AS", Hyderabad: "TS",
  Indore: "MP", Jabalpur: "MP", Jaipur: "RJ", Jodhpur: "RJ",
  Kolkata: "WB", Lucknow: "UP", Mumbai: "MH", Nagpur: "MH",
  Panaji: "GA", Patna: "BR", Pune: "MH", Raipur: "CG",
  Rajkot: "GJ", Ranchi: "JH", Surat: "GJ", Visakhapatnam: "AP",
};

// High Courts → state code. Uses the state where the HC is headquartered.
// Some HCs cover multiple states (Bombay HC covers MH + GA + DD + DN;
// P&H covers PB + HR + CH) — we pick the primary state.
const HC_TO_STATE: Record<string, string> = {
  "Allahabad HC": "UP",
  "Andhra Pradesh HC": "AP",
  "Bombay HC": "MH",
  "Calcutta HC": "WB",
  "Chhattisgarh HC": "CG",
  "Delhi HC": "DL",
  "Gauhati HC": "AS",
  "Gujarat HC": "GJ",
  "Himachal Pradesh HC": "HP",
  "Jammu & Kashmir HC": "JK",
  "Jharkhand HC": "JH",
  "Karnataka HC": "KA",
  "Kerala HC": "KL",
  "Madhya Pradesh HC": "MP",
  "Madras HC": "TN",
  "Manipur HC": "MN",
  "Meghalaya HC": "ML",
  "Orissa HC": "OR",
  "Patna HC": "BR",
  "Punjab & Haryana HC": "PB",
  "Rajasthan HC": "RJ",
  "Sikkim HC": "SK",
  "Telangana HC": "TS",
  "Tripura HC": "TR",
  "Uttarakhand HC": "UT",
};

const HC_BENCHES = Object.keys(HC_TO_STATE);
const ITAT_BENCHES = Object.keys(BENCH_TO_STATE);

type CourtLevel = "All" | "SC" | "HC" | "ITAT";
const COURT_LEVELS: { value: CourtLevel; label: string }[] = [
  { value: "All", label: "All courts" },
  { value: "SC", label: "Supreme Court" },
  { value: "HC", label: "High Courts" },
  { value: "ITAT", label: "ITAT" },
];

type EcourtsBrowseData = Awaited<ReturnType<typeof api.ecourtsSearch>>;

// ─── By-Date tab ─────────────────────────────────────────────────────────
// Single-date filter — pick a date from the calendar (or click a chip on the
// Search-tab "Recently pronounced" strip) and see every judgment eCourts
// has for that date, paginated. Simpler UX than Browse for the "give me
// everything from 13 Aug" flow.
function ByDateView({
  onPick,
  preset,
}: {
  onPick: (s: string) => void;
  preset: { date: string; key: number };
}) {
  const [date, setDate] = useState<string>("");   // YYYY-MM-DD
  const [page, setPage] = useState(1);
  const [data, setData] = useState<EcourtsBrowseData | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [applied, setApplied] = useState<string>("");

  const run = useCallback((iso: string, p: number) => {
    if (!iso) {
      setData(null); setApplied("");
      return;
    }
    setBusy(true); setErr("");
    api.ecourtsSearch({
      date_from: iso,
      date_to: iso,
      has_judgments: true,
      sort: "decisionDate",
      order: "desc",
      page: p,
      limit: 20,
    })
      .then((d) => { setData(d); setPage(d.page); setApplied(iso); })
      .catch((e: any) => setErr(e?.message ?? "Failed to load"))
      .finally(() => setBusy(false));
  }, []);

  // Preset date passed from the parent when a Search-tab chip was clicked.
  // Depends on `preset.key` — a monotonic counter — so re-selecting the
  // same date re-triggers the effect. Fires on mount too, which is why
  // this replaces the earlier CustomEvent-based flow (event fired before
  // ByDateView had mounted, so its listener missed it).
  useEffect(() => {
    if (preset.key === 0) return;   // initial parent-state, ignore
    setDate(preset.date);
    run(preset.date, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset.key]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    run(date, 1);
  }

  const total = data?.total ?? 0;
  const totalPages = data?.total_pages ?? Math.max(1, Math.ceil(total / (data?.limit ?? 20)));

  return (
    <div className="space-y-4">
      {/* Date picker */}
      <form
        onSubmit={onSubmit}
        className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex flex-wrap items-end gap-3"
      >
        <label className="block flex-1 min-w-[220px]">
          <span className="text-[11.5px] font-semibold text-slate-700 uppercase tracking-wider inline-flex items-center gap-1">
            <CalendarIcon className="size-3" /> Pick a date
          </span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 w-full h-10 rounded-md border border-slate-200 bg-white px-2 text-[14px] text-slate-800 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </label>
        <div className="flex items-center gap-2">
          {applied && (
            <button
              type="button"
              onClick={() => { setDate(""); setData(null); setApplied(""); }}
              className="text-[13px] text-slate-500 hover:text-slate-800 px-2"
            >
              Clear
            </button>
          )}
          <Button type="submit" disabled={busy || !date}>
            {busy ? <><Loader2 className="size-4 animate-spin" /> Loading…</> : <><CalendarIcon className="size-4" /> Show judgments</>}
          </Button>
        </div>
      </form>

      {err && <ErrBox msg={err} />}

      {/* Empty helper before first pick */}
      {!data && !busy && !err && (
        <div className="text-center py-10 text-slate-500">
          <div className="mx-auto size-10 rounded-lg bg-slate-100 grid place-items-center text-slate-400 mb-2">
            <CalendarIcon className="size-5" />
          </div>
          <div className="text-[13.5px] font-medium text-slate-600">
            Pick a date to see every judgment pronounced that day.
          </div>
          <div className="text-[12px] text-slate-500 mt-1">
            Or tap a chip on the Search tab's <span className="font-medium">Recently pronounced</span> strip.
          </div>
        </div>
      )}

      {/* Results */}
      {data && (
        <>
          <div className="text-[12.5px] text-slate-500">
            {total === 0 ? `No judgments pronounced on ${applied}.` : (
              <>
                Showing <span className="font-medium text-slate-800">{(data.page - 1) * data.limit + 1}</span>
                –<span className="font-medium text-slate-800">{Math.min(data.page * data.limit, total)}</span>
                {" "}of <span className="font-medium text-slate-800">{total.toLocaleString("en-IN")}</span>
                {" judgments on "}<span className="font-medium text-slate-800">{applied}</span>
                <span className="ml-1 text-slate-400">· live eCourts</span>
              </>
            )}
          </div>

          {total === 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
              <div className="mx-auto size-10 rounded-lg bg-slate-100 grid place-items-center text-slate-400 mb-2">
                <Inbox className="size-5" />
              </div>
              <div className="text-[13.5px] text-slate-600 font-medium">Try a nearby date.</div>
            </div>
          )}

          <div className="space-y-3">
            {data.items.map((it) => (
              <CaseCard
                key={it.cnr}
                title={_formatEcourtsTitle(it)}
                digest={_formatEcourtsDigest(it)}
                sourceUrl={_ecourtsSourceUrl(it.cnr)}
                sections={[]}
                status={_ecourtsStatus(it)}
                onPick={onPick}
              />
            ))}
          </div>

          {total > 0 && (
            <div className="flex items-center justify-between gap-3 flex-wrap text-[13px]">
              <div className="text-slate-500">
                Page <span className="font-medium text-slate-800">{data.page}</span> of {totalPages.toLocaleString("en-IN")}
              </div>
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => run(applied, Math.max(1, page - 1))}
                  disabled={busy || page <= 1}
                  className="inline-flex items-center gap-1 px-2.5 h-8 rounded-md border border-slate-200 bg-white text-slate-700 font-medium hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="size-4" /> Prev
                </button>
                <button
                  type="button"
                  onClick={() => run(applied, Math.min(totalPages, page + 1))}
                  disabled={busy || page >= totalPages}
                  className="inline-flex items-center gap-1 px-2.5 h-8 rounded-md border border-slate-200 bg-white text-slate-700 font-medium hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next <ChevronRight className="size-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BrowseView({
  onPick,
  preset,
}: {
  onPick: (s: string) => void;
  preset: { date: string; key: number };
}) {
  const [ecourtsEnabled, setEcourtsEnabled] = useState(false);
  const [courtLevel, setCourtLevel] = useState<CourtLevel>("All");
  const [bench, setBench] = useState<string>("All");
  const [judge, setJudge] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  const [page, setPage] = useState(1);
  const [data, setData] = useState<EcourtsBrowseData | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [applied, setApplied] = useState<{
    court_level: CourtLevel; bench: string; judge: string; date_from: string; date_to: string;
  } | null>(null);

  useEffect(() => {
    api.ecourtsStatus().then((s) => setEcourtsEnabled(s.enabled)).catch(() => {});
  }, []);

  // Bench dropdown options depend on court level:
  //   SC   → no bench (single court) — the dropdown hides.
  //   HC   → list of High Courts (Allahabad HC, Bombay HC, …)
  //   ITAT → list of ITAT city benches (Ahmedabad, Bangalore, …)
  //   All  → union of both, or just ITAT (default browsing pattern)
  const benchOptions = useMemo<string[]>(() => {
    if (courtLevel === "SC") return [];
    if (courtLevel === "HC") return ["All", ...HC_BENCHES];
    if (courtLevel === "ITAT") return ["All", ...ITAT_BENCHES];
    return ["All", ...ITAT_BENCHES];
  }, [courtLevel]);

  // Reset bench when court level changes so a stale bench (e.g. "Bombay HC"
  // picked under HC, then switching to ITAT) doesn't get sent upstream.
  useEffect(() => {
    setBench("All");
  }, [courtLevel]);

  const runBrowse = useCallback((p: number, filt?: typeof applied) => {
    const f = filt ?? {
      court_level: courtLevel, bench, judge, date_from: dateFrom, date_to: dateTo,
    };
    setBusy(true); setErr("");
    const opts: Parameters<typeof api.ecourtsSearch>[0] = {
      page: p,
      limit: 20,
      sort: "decisionDate",
      order: "desc",
      has_judgments: true,   // Browse = judgments-only
    };
    // Court-level filter → maps to eCourts courtLevel enum.
    if (f.court_level === "SC") opts.court_level = "SC";
    else if (f.court_level === "HC") opts.court_level = "HC";
    else if (f.court_level === "ITAT") opts.court_level = "TRIBUNAL";
    // "All" → no court_level filter.

    // Bench → state code lookup. Different maps for HC vs ITAT (both use
    // stateCodes upstream, just derived from different labels).
    if (f.bench && f.bench !== "All") {
      const state = f.court_level === "HC" ? HC_TO_STATE[f.bench] : BENCH_TO_STATE[f.bench];
      if (state) opts.state = state;
    }
    if (f.judge) opts.judge_name = f.judge;
    if (f.date_from) opts.date_from = f.date_from;
    if (f.date_to) opts.date_to = f.date_to;

    api.ecourtsSearch(opts)
      .then((d) => { setData(d); setPage(d.page); setApplied(f); })
      .catch((e: any) => setErr(e?.message ?? "Failed to load"))
      .finally(() => setBusy(false));
  }, [courtLevel, bench, judge, dateFrom, dateTo]);

  // Preset from parent (View-all click on the Search tab) — auto-run an
  // unfiltered browse when the parent bumps preset.key.
  useEffect(() => {
    if (preset.key === 0) return;   // initial parent state, ignore
    const iso = preset.date;
    const f = iso
      ? { court_level: "All" as CourtLevel, bench: "All", judge: "", date_from: iso, date_to: iso }
      : { court_level: "All" as CourtLevel, bench: "All", judge: "", date_from: "", date_to: "" };
    setCourtLevel(f.court_level); setBench(f.bench); setJudge(f.judge);
    setDateFrom(f.date_from); setDateTo(f.date_to);
    runBrowse(1, f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset.key]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    runBrowse(1);
  }

  const total = data?.total ?? 0;
  const totalPages = data?.total_pages ?? Math.max(1, Math.ceil(total / (data?.limit ?? 20)));

  return (
    <div className="space-y-4">
      {/* Filter form */}
      <form
        onSubmit={onSubmit}
        className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm grid gap-3 sm:grid-cols-2 lg:grid-cols-6"
      >
        {/* Court level dropdown — All / SC / HC / ITAT */}
        <label className="block">
          <span className="text-[11.5px] font-semibold text-slate-700 uppercase tracking-wider inline-flex items-center gap-1">
            <Scale className="size-3" /> Court level
          </span>
          <select
            value={courtLevel}
            onChange={(e) => setCourtLevel(e.target.value as CourtLevel)}
            className="mt-1 w-full h-9 rounded-md border border-slate-200 bg-white px-2 text-[13.5px] text-slate-800 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            {COURT_LEVELS.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </label>
        {/* Bench dropdown — hidden for Supreme Court (single court).
            Options come from HC list when courtLevel=HC, ITAT list otherwise. */}
        {courtLevel !== "SC" && (
          <label className="block">
            <span className="text-[11.5px] font-semibold text-slate-700 uppercase tracking-wider inline-flex items-center gap-1">
              <MapPin className="size-3" /> {courtLevel === "HC" ? "High Court" : courtLevel === "ITAT" ? "ITAT Bench" : "Bench"}
            </span>
            <select
              value={bench}
              onChange={(e) => setBench(e.target.value)}
              className="mt-1 w-full h-9 rounded-md border border-slate-200 bg-white px-2 text-[13.5px] text-slate-800 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            >
              {benchOptions.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
        )}
        <label className="block">
          <span className="text-[11.5px] font-semibold text-slate-700 uppercase tracking-wider inline-flex items-center gap-1">
            <CalendarIcon className="size-3" /> Date from
          </span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="mt-1 w-full h-9 rounded-md border border-slate-200 bg-white px-2 text-[13.5px] text-slate-800 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </label>
        <label className="block">
          <span className="text-[11.5px] font-semibold text-slate-700 uppercase tracking-wider inline-flex items-center gap-1">
            <CalendarIcon className="size-3" /> Date to
          </span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="mt-1 w-full h-9 rounded-md border border-slate-200 bg-white px-2 text-[13.5px] text-slate-800 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </label>
        <label className={"block " + (courtLevel === "SC" ? "sm:col-span-2 lg:col-span-3" : "sm:col-span-2")}>
          <span className="text-[11.5px] font-semibold text-slate-700 uppercase tracking-wider inline-flex items-center gap-1">
            <User className="size-3" /> Judge name
          </span>
          <Input
            value={judge}
            onChange={(e) => setJudge(e.target.value)}
            placeholder="e.g. Anikesh Banerjee, Prashant Maharishi"
            className="mt-1"
          />
        </label>
        <div className="sm:col-span-2 lg:col-span-6 flex items-center justify-end gap-2">
          {applied && (
            <button
              type="button"
              onClick={() => {
                setCourtLevel("All"); setBench("All"); setJudge("");
                setDateFrom(""); setDateTo("");
                setData(null); setApplied(null);
              }}
              className="text-[13px] text-slate-500 hover:text-slate-800 px-2"
            >
              Clear
            </button>
          )}
          <Button type="submit" disabled={busy}>
            {busy ? <><Loader2 className="size-4 animate-spin" /> Loading…</> : <><Filter className="size-4" /> Browse</>}
          </Button>
        </div>
      </form>

      {err && <ErrBox msg={err} />}

      {/* Empty helper state before first browse */}
      {!data && !busy && !err && (
        <div className="text-center py-10 text-slate-500">
          <div className="mx-auto size-10 rounded-lg bg-slate-100 grid place-items-center text-slate-400 mb-2">
            <Filter className="size-5" />
          </div>
          <div className="text-[13.5px] font-medium text-slate-600">
            Pick a bench, a date range or a judge and click <span className="font-semibold">Browse</span>.
          </div>
          <div className="text-[12px] text-slate-500 mt-1">
            {ecourtsEnabled
              ? "Searching live eCourts India — over 28 Cr cases across every court."
              : "Leave all filters blank to see every judgment in the local corpus, newest first."}
          </div>
        </div>
      )}

      {/* Results */}
      {data && (
        <>
          <div className="text-[12.5px] text-slate-500">
            {total === 0 ? "No judgments match those filters." : (
              <>
                Showing <span className="font-medium text-slate-800">{(data.page - 1) * data.limit + 1}</span>
                –<span className="font-medium text-slate-800">{Math.min(data.page * data.limit, total)}</span>
                {" "}of <span className="font-medium text-slate-800">{total.toLocaleString("en-IN")}</span>
                {applied?.court_level && applied.court_level !== "All" && (
                  <> · {applied.court_level === "SC" ? "Supreme Court" : applied.court_level === "HC" ? "High Court" : "ITAT"}</>
                )}
                {applied?.bench && applied.bench !== "All" && <> · <span className="font-medium text-slate-800">{applied.bench}</span></>}
                {applied?.judge && <> · judge <span className="font-medium text-slate-800">{applied.judge}</span></>}
                {(applied?.date_from || applied?.date_to) && <> · dates <span className="font-medium text-slate-800">{applied.date_from || "…"} – {applied.date_to || "…"}</span></>}
                {ecourtsEnabled && <span className="ml-1 text-slate-400">· live eCourts</span>}
              </>
            )}
          </div>

          {total === 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
              <div className="mx-auto size-10 rounded-lg bg-slate-100 grid place-items-center text-slate-400 mb-2">
                <Inbox className="size-5" />
              </div>
              <div className="text-[13.5px] text-slate-600 font-medium">Try broadening the filters.</div>
            </div>
          )}

          <div className="space-y-3">
            {data.items.map((it) => (
              <CaseCard
                key={it.cnr}
                title={_formatEcourtsTitle(it)}
                digest={_formatEcourtsDigest(it)}
                sourceUrl={_ecourtsSourceUrl(it.cnr)}
                sections={[]}
                status={_ecourtsStatus(it)}
                onPick={onPick}
              />
            ))}
          </div>

          {/* Pagination */}
          {total > 0 && (
            <div className="flex items-center justify-between gap-3 flex-wrap text-[13px]">
              <div className="text-slate-500">Page <span className="font-medium text-slate-800">{data.page}</span> of {totalPages.toLocaleString("en-IN")}</div>
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => runBrowse(Math.max(1, page - 1), applied ?? undefined)}
                  disabled={busy || page <= 1}
                  className="inline-flex items-center gap-1 px-2.5 h-8 rounded-md border border-slate-200 bg-white text-slate-700 font-medium hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="size-4" /> Prev
                </button>
                <button
                  type="button"
                  onClick={() => runBrowse(Math.min(totalPages, page + 1), applied ?? undefined)}
                  disabled={busy || page >= totalPages}
                  className="inline-flex items-center gap-1 px-2.5 h-8 rounded-md border border-slate-200 bg-white text-slate-700 font-medium hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next <ChevronRight className="size-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── eCourts card formatting helpers ────────────────────────────────────
// Adapts the eCourts result shape to CaseCard's expected props without
// changing CaseCard (which is shared with the Search + Recent lists).
function _formatEcourtsTitle(it: EcourtsBrowseData["items"][number]): string {
  const petitioner = (it.petitioners || [])[0] || "";
  const respondent = (it.respondents || [])[0] || "";
  const parties = petitioner && respondent ? `${petitioner} vs ${respondent}` : (petitioner || respondent);
  const court = it.courtName || it.courtCode || "";
  const decision = it.decisionDate ? `  ·  ${it.decisionDate}` : "";
  return `${parties || "(unnamed parties)"} — ${court}${decision}`;
}
function _formatEcourtsDigest(it: EcourtsBrowseData["items"][number]): string | undefined {
  // caseStatus is now rendered as a coloured badge next to the title —
  // don't duplicate it inside the digest text.
  const bits: string[] = [];
  if (it.caseType && it.caseType !== "UNKNOWN") bits.push(it.caseType);
  if (it.judges && it.judges.length) bits.push(`Bench: ${it.judges.slice(0, 2).join(", ")}`);
  if (it.judgmentCount > 0) bits.push(`${it.judgmentCount} judgment${it.judgmentCount === 1 ? "" : "s"}`);
  return bits.length ? bits.join(" · ") : undefined;
}
// Helper for the raw status string used to feed the badge — kept separate
// from the digest so we can render it as its own visual element.
function _ecourtsStatus(it: EcourtsBrowseData["items"][number]): string {
  return it.caseStatus && it.caseStatus !== "UNKNOWN" ? it.caseStatus : "";
}
function _ecourtsSourceUrl(cnr: string): string {
  // Public case page on the eCourts India portal.
  return `https://ecourtsindia.com/case/${encodeURIComponent(cnr)}`;
}

// ─── Landing widgets (Search-tab only) ──────────────────────────────────

function StatsRow() {
  const [s, setS] = useState<Awaited<ReturnType<typeof api.rulingsStats>> | null>(null);
  useEffect(() => {
    api.rulingsStats().then(setS).catch(() => {});
  }, []);
  if (!s) return null;
  // With eCourts wired up, the headline numbers are into the hundreds of
  // millions — abbreviate as "118M", "284M" so the tiles don't wrap into
  // three lines on tablet-sized viewports.
  const items: [string, string][] = [
    [abbr(s.judgments), "Judgments"],
    [abbr(s.appeals), "Cases"],
    [nfmt(s.benches), "Courts / benches"],
    [s.coverage_label, "Coverage"],
  ];
  return (
    <div className="mt-2 space-y-1">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {items.map(([v, label]) => (
          <div
            key={label}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
          >
            <div className="text-[22px] sm:text-[26px] font-semibold text-slate-900 tabular-nums leading-none">
              {v}
            </div>
            <div className="text-[11.5px] text-slate-500 mt-1 uppercase tracking-wider">
              {label}
            </div>
          </div>
        ))}
      </div>
      {/* Attribution + fallback context — only shows when eCourts is live. */}
      {s.source === "ecourts" && (
        <div className="text-[11px] text-slate-400 pt-1">
          Live from eCourts India · {nfmt(s.corpus.judgments)} judgments indexed locally for semantic search
        </div>
      )}
    </div>
  );
}

function RecentJudgments({
  onPick,
  onViewAll,
}: {
  onPick: (s: string) => void;
  onViewAll: () => void;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.rulingsRecent>> | null>(null);
  useEffect(() => {
    api.rulingsRecent(6).then(setData).catch(() => {});
  }, []);
  if (!data || data.items.length === 0) return null;
  // eCourts titles already carry "— Court · YYYY-MM-DD" — don't append the
  // date a second time. Local-corpus titles have "on 13 August, 2026" in
  // the text already but no ISO date, so append that for consistency.
  const appendDate = data.source !== "ecourts";
  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-slate-900 inline-flex items-center gap-1.5">
          <Gavel className="size-4 text-primary" /> Recent judgments
          {data.source === "ecourts" && (
            <span className="text-[10.5px] font-normal text-slate-400 ml-1">· live from eCourts India</span>
          )}
        </h3>
        <button
          type="button"
          onClick={onViewAll}
          className="text-[12.5px] font-medium text-primary hover:underline inline-flex items-center gap-1"
        >
          View all <ChevronRight className="size-3" />
        </button>
      </div>
      <div className="space-y-3">
        {data.items.map((it) => (
          <CaseCard
            key={String(it.id)}
            title={
              (it.title || "(untitled)") +
              (appendDate && it.published_date ? `  ·  ${it.published_date}` : "")
            }
            digest={it.digest}
            sourceUrl={it.source_url}
            sections={it.sections_cited}
            status={it.status}
            onPick={onPick}
          />
        ))}
      </div>
    </div>
  );
}

function PopularTopics({ onPickQuery }: { onPickQuery: (q: string) => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.rulingsPopularTopics>> | null>(null);
  useEffect(() => {
    api.rulingsPopularTopics(12).then(setData).catch(() => {});
  }, []);
  if (!data || data.items.length === 0) return null;
  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold text-slate-900 mb-2">Popular topics</h3>
      <div className="flex flex-wrap gap-1.5">
        {data.items.map((t) => (
          <button
            key={t.topic}
            type="button"
            onClick={() => onPickQuery(t.q)}
            title={t.count ? `${t.count} judgment${t.count === 1 ? "" : "s"} cite this` : undefined}
            className="inline-flex items-center gap-1 rounded-full bg-white border border-slate-200 text-slate-700 text-[12.5px] px-3 py-1 hover:border-primary hover:text-primary transition-colors"
          >
            {t.topic}
            {typeof t.count === "number" && (
              <span className="text-slate-400 text-[11px]"> ({t.count})</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function RecentDates({ onPickDate }: { onPickDate: (iso: string) => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.rulingsRecentDates>> | null>(null);
  useEffect(() => {
    api.rulingsRecentDates(11).then(setData).catch(() => {});
  }, []);
  if (!data || data.items.length === 0) return null;
  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold text-slate-900 mb-2">
        Recently pronounced
        {data.source === "fetched_at" && (
          <span className="text-slate-400 text-[11px] font-normal ml-2">
            (by ingest date — published dates still backfilling)
          </span>
        )}
      </h3>
      <div className="flex flex-wrap gap-1.5">
        {data.items.map((r) =>
          r.date ? (
            <button
              key={r.date}
              type="button"
              onClick={() => onPickDate(r.date!)}
              className="inline-flex items-center gap-1 rounded-full bg-white border border-slate-200 text-slate-700 text-[12.5px] px-3 py-1 hover:border-primary hover:text-primary transition-colors"
            >
              {fmtDate(r.date)}
              <span className="text-slate-400 text-[11px]"> ({r.count})</span>
            </button>
          ) : null,
        )}
        <button
          type="button"
          onClick={() => onPickDate("")}
          className="inline-flex items-center gap-1 rounded-full bg-white border border-amber-300 text-amber-700 text-[12.5px] px-3 py-1 hover:bg-amber-50 transition-colors"
        >
          All dates <ChevronRight className="size-3" />
        </button>
      </div>
    </div>
  );
}

// ─── tiny formatting helpers ────────────────────────────────────────────
function nfmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-IN");
}
// Compact ("28.4 Cr" for 284,000,000) — used in the stats tiles where
// grouping ("28,44,43,151") would wrap. Falls back to nfmt for small values.
function abbr(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n < 1_00_000) return nfmt(n);           // < 1 lakh — show full
  if (n < 1_00_00_000) return (n / 1_00_000).toFixed(1).replace(/\.0$/, "") + " L";
  return (n / 1_00_00_000).toFixed(1).replace(/\.0$/, "") + " Cr";
}
function fmtDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
