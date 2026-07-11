import { FormEvent, useState } from "react";
import {
  BookOpen, Loader2, ArrowUpRight, AlertTriangle, Search, Hash, Scale, FileText, Gavel,
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

function CaseCard({ title, digest, snippet, sourceUrl, sections, onPick }: {
  title: string; digest?: string | null; snippet?: string | null;
  sourceUrl?: string | null; sections?: string[] | null; onPick: (s: string) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-primary/40 transition-colors">
      <div className="font-medium text-[13px] text-slate-900 flex items-start gap-1.5">
        <Gavel className="size-3.5 text-slate-400 shrink-0 mt-0.5" /> <span className="min-w-0">{title}</span>
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
  const [mode, setMode] = useState<"search" | "section">("search");

  const [q, setQ] = useState("");
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const [sec, setSec] = useState("");
  const [hub, setHub] = useState<any>(null);
  const [hubBusy, setHubBusy] = useState(false);
  const [hubErr, setHubErr] = useState("");

  async function search(e?: FormEvent) {
    e?.preventDefault();
    if (!q.trim()) return;
    setBusy(true); setErr(""); setRes(null);
    try { setRes(await api.rulings(q)); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function loadSection(s: string) {
    const clean = s.trim().toUpperCase();
    if (!clean) return;
    setMode("section"); setSec(clean); setHubBusy(true); setHubErr(""); setHub(null);
    try { setHub(await api.crossref(clean)); } catch (e: any) { setHubErr(e.message); } finally { setHubBusy(false); }
  }

  const tab = (id: "search" | "section", icon: JSX.Element, text: string) => (
    <button
      type="button"
      onClick={() => setMode(id)}
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
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <BookOpen className="size-5 text-primary" /> Case Law
        </h2>
        <p className="text-sm text-muted-foreground">
          Search income-tax judgments (HC / SC) with AI headnotes, or browse everything on a section.
        </p>
      </div>

      <div className="inline-flex rounded-lg border border-input bg-background p-0.5 text-sm">
        {tab("search", <Search className="size-4" />, "Search")}
        {tab("section", <Hash className="size-4" />, "By Section")}
      </div>

      {mode === "search" ? (
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
          {err && <ErrBox msg={err} />}
          {res && !res.results.length && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 text-amber-800 text-sm px-4 py-3 flex items-start gap-2">
              <AlertTriangle className="size-4 mt-0.5 shrink-0" /> No matching judgments. Try different wording, or browse By Section.
            </div>
          )}
          <div className="space-y-3">
            {res?.results?.map((r: any, i: number) => (
              <CaseCard key={i} title={r.breadcrumb} digest={r.digest} snippet={r.snippet}
                sourceUrl={r.source_url} sections={r.sections_cited} onPick={loadSection} />
            ))}
          </div>
        </>
      ) : (
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
    </div>
  );
}
