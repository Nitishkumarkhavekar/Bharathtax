import { useEffect, useMemo, useState } from "react";
import { Library as LibraryIcon, Trash2, ExternalLink, ChevronDown, Scale, MessageSquareText, FileText, BookMarked } from "lucide-react";
import { api, LibraryItem, SavedKind } from "../api";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const TABS: { v: SavedKind | "all"; l: string }[] = [
  { v: "all", l: "All" },
  { v: "answer", l: "Answers" },
  { v: "ruling", l: "Rulings" },
  { v: "draft", l: "Drafts" },
];

const KIND_META: Record<string, { l: string; tone: string; Icon: typeof Scale }> = {
  answer: { l: "Answer", tone: "bg-indigo-50 text-indigo-700 ring-indigo-200", Icon: MessageSquareText },
  ruling: { l: "Ruling", tone: "bg-violet-50 text-violet-700 ring-violet-200", Icon: Scale },
  draft: { l: "Draft", tone: "bg-amber-50 text-amber-700 ring-amber-200", Icon: FileText },
  note: { l: "Note", tone: "bg-slate-100 text-slate-600 ring-slate-200", Icon: BookMarked },
};

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default function Library() {
  const { confirm, dialog } = useConfirm();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<SavedKind | "all">("all");
  const [open, setOpen] = useState<Record<number, boolean>>({});

  const load = async () => setItems(await api.libraryList());
  useEffect(() => {
    (async () => {
      try { await load(); } catch (e: any) { toast.error(e?.message || "Could not load your library."); }
      finally { setLoading(false); }
    })();
  }, []);

  const shown = useMemo(() => (tab === "all" ? items : items.filter((i) => i.kind === tab)), [items, tab]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const i of items) c[i.kind] = (c[i.kind] || 0) + 1;
    return c;
  }, [items]);

  const del = async (it: LibraryItem) => {
    if (!(await confirm({ title: "Remove from library?", description: <span>“{it.title || "This item"}” will be removed.</span>, tone: "danger", confirmLabel: "Remove" }))) return;
    try { await api.libraryDelete(it.id); setItems((xs) => xs.filter((x) => x.id !== it.id)); }
    catch (e: any) { toast.error(e?.message || "Could not remove."); }
  };

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center gap-3">
        <div className="size-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <LibraryIcon className="size-6" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-slate-900 leading-tight">My Library</h1>
          <p className="text-[13px] text-slate-500">Your kept work — save an answer or a ruling and it lives here.</p>
        </div>
      </div>

      {/* filter tabs */}
      <div className="flex items-center gap-1.5">
        {TABS.map((t) => (
          <button key={t.v} onClick={() => setTab(t.v)}
            className={cn("px-3 py-1.5 rounded-lg text-[12.5px] font-semibold transition-colors",
              tab === t.v ? "bg-primary text-white" : "text-slate-600 hover:bg-slate-100")}>
            {t.l}{counts[t.v] ? <span className={cn("ml-1.5", tab === t.v ? "text-white/70" : "text-slate-400")}>{counts[t.v]}</span> : null}
          </button>
        ))}
      </div>

      <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm divide-y divide-slate-100">
        {loading && <SkeletonRows rows={5} />}
        {!loading && shown.length === 0 && (
          <div className="text-[13px] text-slate-400 py-12 text-center">
            Nothing saved yet. Use the <span className="font-medium text-slate-500">Save</span> button on an answer, or the bookmark on a ruling.
          </div>
        )}
        {shown.map((it) => {
          const meta = KIND_META[it.kind] || KIND_META.note;
          const isOpen = !!open[it.id];
          const long = (it.content || "").length > 220;
          return (
            <div key={it.id} className="px-4 py-3">
              <div className="flex items-start gap-3">
                <div className={cn("mt-0.5 size-8 rounded-lg grid place-items-center shrink-0 ring-1", meta.tone)}>
                  <meta.Icon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13.5px] font-semibold text-slate-800">{it.title || meta.l}</span>
                    {it.sections?.slice(0, 4).map((s) => (
                      <span key={s} className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">§{s}</span>
                    ))}
                    <span className="ml-auto text-[11px] text-slate-400 tabular-nums shrink-0">{fmtDate(it.created_at)}</span>
                  </div>
                  {it.content && (
                    <p className={cn("mt-1 text-[12.5px] text-slate-600 whitespace-pre-wrap leading-snug", !isOpen && "line-clamp-3")}
                      style={!isOpen ? { display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" } : undefined}>
                      {it.content}
                    </p>
                  )}
                  <div className="mt-1.5 flex items-center gap-3">
                    {long && (
                      <button onClick={() => setOpen((o) => ({ ...o, [it.id]: !isOpen }))}
                        className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline">
                        {isOpen ? "Show less" : "Show more"}
                        <ChevronDown className={cn("size-3.5 transition-transform", isOpen && "rotate-180")} />
                      </button>
                    )}
                    {it.source_url && (
                      <a href={it.source_url} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline">
                        Open <ExternalLink className="size-3.5" />
                      </a>
                    )}
                  </div>
                </div>
                <button onClick={() => del(it)} title="Remove" aria-label="Remove from library"
                  className="shrink-0 p-1.5 rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {dialog}
    </div>
  );
}
