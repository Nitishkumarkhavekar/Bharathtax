import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bookmark, Plus, Trash2, Search, X } from "lucide-react";
import { api, WsWatchlist } from "../api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const KINDS = [
  { v: "section", l: "Section" }, { v: "topic", l: "Topic" }, { v: "assessee", l: "Assessee" },
];
const KIND_TONE: Record<string, string> = {
  section: "bg-blue-50 text-blue-700 ring-blue-200",
  topic: "bg-amber-50 text-amber-700 ring-amber-200",
  assessee: "bg-emerald-50 text-emerald-700 ring-emerald-200",
};

export default function Watchlists() {
  const nav = useNavigate();
  const { confirm, dialog } = useConfirm();
  const [items, setItems] = useState<WsWatchlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [nw, setNw] = useState({ label: "", query: "", kind: "topic" });

  const load = async () => setItems(await api.wsWatchlists());
  useEffect(() => {
    (async () => {
      try { await load(); } catch (e: any) { toast.error(e?.message || "Could not load watchlists."); }
      finally { setLoading(false); }
    })();
  }, []);

  const add = async () => {
    if (!nw.label.trim() || !nw.query.trim()) { toast.error("Label and search terms are required."); return; }
    try {
      await api.wsCreateWatchlist({ label: nw.label.trim(), query: nw.query.trim(), kind: nw.kind });
      setNw({ label: "", query: "", kind: "topic" });
      setShowNew(false);
      await load();
      toast.success("Watchlist added.");
    } catch (e: any) { toast.error(e?.message || "Could not add."); }
  };
  const del = async (w: WsWatchlist) => {
    if (!(await confirm({ title: "Remove watchlist?", description: <span>“{w.label}” will be removed.</span>, tone: "danger", confirmLabel: "Remove" }))) return;
    try { await api.wsDeleteWatchlist(w.id); await load(); } catch (e: any) { toast.error(e?.message || "Could not remove."); }
  };
  const find = (w: WsWatchlist) => nav(`/rulings?q=${encodeURIComponent(w.query)}`);

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center gap-3">
        <div className="size-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Bookmark className="size-6" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-slate-900 leading-tight">Watchlists</h1>
          <p className="text-[13px] text-slate-500">Track a section, topic or assessee — jump to fresh rulings in one click.</p>
        </div>
        <Button className="ml-auto" onClick={() => setShowNew((s) => !s)}>
          {showNew ? <X className="size-4 mr-1" /> : <Plus className="size-4 mr-1" />}{showNew ? "Close" : "New"}
        </Button>
      </div>

      {showNew && (
        <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-4 flex flex-col sm:flex-row gap-2">
          <Input placeholder="Label (e.g. Sec 68 cash credits)" value={nw.label} onChange={(e) => setNw({ ...nw, label: e.target.value })} />
          <Input placeholder="Search terms" value={nw.query} onChange={(e) => setNw({ ...nw, query: e.target.value })} />
          <select value={nw.kind} onChange={(e) => setNw({ ...nw, kind: e.target.value })}
            className="h-9 rounded-md border border-slate-200 bg-white px-2 text-[13px] text-slate-700 shrink-0">
            {KINDS.map((k) => <option key={k.v} value={k.v}>{k.l}</option>)}
          </select>
          <Button className="shrink-0" onClick={add}>Add</Button>
        </div>
      )}

      <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm divide-y divide-slate-100">
        {loading && <SkeletonRows rows={5} />}
        {!loading && items.length === 0 && (
          <div className="text-[13px] text-slate-400 py-10 text-center">No watchlists yet. Add one to track it.</div>
        )}
        {items.map((w) => (
          <div key={w.id} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-semibold text-slate-800 truncate">{w.label}</span>
                <span className={cn("shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ring-1 uppercase", KIND_TONE[w.kind] || KIND_TONE.topic)}>{w.kind}</span>
              </div>
              <div className="text-[12px] text-slate-500 truncate">{w.query}</div>
            </div>
            <Button variant="outline" size="sm" onClick={() => find(w)}><Search className="size-3.5 mr-1" /> Find rulings</Button>
            <button onClick={() => del(w)} title="Remove" className="p-1.5 rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600">
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
      </div>
      {dialog}
    </div>
  );
}
