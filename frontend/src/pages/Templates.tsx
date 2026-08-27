import { useEffect, useMemo, useState } from "react";
import { FileText, Plus, Trash2, Copy, LayoutTemplate, X, Search } from "lucide-react";
import { api, WsTemplate, WsLibraryTemplate } from "../api";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useAuth } from "../auth";
import { resolveWorkspace } from "@/lib/workspaceProfiles";

const CATS = [
  { v: "notice", l: "Notice" }, { v: "order", l: "Order" },
  { v: "appeal", l: "Appeal" }, { v: "other", l: "Other" },
];

export default function Templates() {
  const { confirm, dialog } = useConfirm();
  const [items, setItems] = useState<WsTemplate[]>([]);
  const [selId, setSelId] = useState<number | null>(null);
  const [draft, setDraft] = useState({ name: "", category: "notice", body: "" });
  const [loading, setLoading] = useState(true);
  const [library, setLibrary] = useState<WsLibraryTemplate[]>([]);
  const [showLib, setShowLib] = useState(false);
  const [libSide, setLibSide] = useState("");
  const [libQuery, setLibQuery] = useState("");
  // Open the library on the user's own wing group (they can clear to see all).
  const { session } = useAuth();
  const myGroup = resolveWorkspace(session?.workspaceProfile, session?.workspaceWings).templateGroup;
  const [libGroup, setLibGroup] = useState<string>("");

  const openLibrary = () => { setLibGroup(myGroup ?? ""); setShowLib(true); };

  const libGroups = useMemo(() => {
    const q = libQuery.trim().toLowerCase();
    const filtered = library.filter((t) => {
      if (libSide && t.side !== libSide) return false;
      if (libGroup && (t.group || "Other") !== libGroup) return false;
      if (!q) return true;
      return `${t.name} ${t.group ?? ""} ${t.category} ${t.body}`.toLowerCase().includes(q);
    });
    const map = new Map<string, WsLibraryTemplate[]>();
    for (const t of filtered) {
      const g = t.group || "Other";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(t);
    }
    return Array.from(map.entries());
  }, [library, libSide, libQuery, libGroup]);

  const load = async () => setItems(await api.wsTemplates());
  useEffect(() => {
    (async () => {
      try { await Promise.all([load(), api.wsTemplateLibrary().then(setLibrary).catch(() => {})]); }
      catch (e: any) { toast.error(e?.message || "Could not load templates."); }
      finally { setLoading(false); }
    })();
  }, []);

  const useLibraryItem = (t: WsLibraryTemplate) => {
    setSelId(null);
    setDraft({ name: t.name, category: t.category, body: t.body });
    setShowLib(false);
    toast("Loaded from library — edit and save it as your own.", { icon: "📄" });
  };

  const startNew = () => { setSelId(null); setDraft({ name: "", category: "notice", body: "" }); };
  const edit = (t: WsTemplate) => { setSelId(t.id); setDraft({ name: t.name, category: t.category, body: t.body }); };

  const save = async () => {
    if (!draft.name.trim() || !draft.body.trim()) { toast.error("Name and body are required."); return; }
    try {
      if (selId) await api.wsUpdateTemplate(selId, draft);
      else { const c = await api.wsCreateTemplate(draft); setSelId(c.id); }
      await load();
      toast.success("Template saved.");
    } catch (e: any) { toast.error(e?.message || "Could not save."); }
  };
  const del = async (t: WsTemplate) => {
    if (!(await confirm({ title: "Delete template?", description: <span>“{t.name}” will be removed.</span>, tone: "danger", confirmLabel: "Delete" }))) return;
    try { await api.wsDeleteTemplate(t.id); if (selId === t.id) startNew(); await load(); }
    catch (e: any) { toast.error(e?.message || "Could not delete."); }
  };
  const copy = async (body: string) => {
    try { await navigator.clipboard.writeText(body); toast.success("Copied to clipboard."); }
    catch { toast.error("Copy failed."); }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="size-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <FileText className="size-6" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-slate-900 leading-tight">Templates</h1>
          <p className="text-[13px] text-slate-500">Reusable notice, order and appeal boilerplate — save once, reuse anywhere.</p>
        </div>
        <Button variant="outline" className="ml-auto" onClick={openLibrary}>
          <LayoutTemplate className="size-4 mr-1" /> Library
        </Button>
        <Button onClick={startNew}><Plus className="size-4 mr-1" /> New</Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5 items-start">
        <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-2">
          {loading && <SkeletonRows rows={5} />}
          {!loading && items.length === 0 && (
            <div className="text-[12.5px] text-slate-400 py-6 px-2 text-center">No templates yet. Create one on the right.</div>
          )}
          <div className="space-y-1 max-h-[65vh] overflow-y-auto chat-scrollbar">
            {items.map((t) => (
              <button key={t.id} onClick={() => edit(t)}
                className={cn("group w-full text-left px-2.5 py-2 rounded-lg transition-colors",
                  selId === t.id ? "bg-primary/10 ring-1 ring-primary/20" : "hover:bg-slate-100")}>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-slate-800">{t.name}</span>
                  <span className="shrink-0 text-[10px] font-semibold uppercase text-slate-400">{t.category}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-4 sm:p-5 space-y-3">
          <div className="flex gap-2">
            <Input placeholder="Template name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              className="h-9 rounded-md border border-slate-200 bg-white px-2 text-[13px] text-slate-700 shrink-0">
              {CATS.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
            </select>
          </div>
          <textarea
            value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            placeholder="Template text… use {{PAN}}, {{AY}}, {{ASSESSEE}}, {{APPEAL_NO}} as placeholders." rows={14}
            className="w-full resize-y rounded-lg border border-slate-200 bg-white p-3 text-[13px] text-slate-800 outline-none focus:ring-2 focus:ring-primary/20"
          />
          <div className="flex items-center gap-2">
            <p className="text-[11px] text-slate-400">Placeholders: {"{{PAN}}"} · {"{{AY}}"} · {"{{ASSESSEE}}"} · {"{{APPEAL_NO}}"}</p>
            <div className="ml-auto flex items-center gap-2">
              {draft.body.trim() && (
                <Button variant="outline" className="h-9" onClick={() => copy(draft.body)}>
                  <Copy className="size-4 mr-1" /> Copy
                </Button>
              )}
              {selId && (
                <Button variant="outline" className="h-9 text-rose-600" onClick={() => { const t = items.find((x) => x.id === selId); if (t) del(t); }}>
                  <Trash2 className="size-4" />
                </Button>
              )}
              <Button className="h-9" onClick={save}>{selId ? "Save" : "Create"}</Button>
            </div>
          </div>
        </div>
      </div>
      {showLib && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" onClick={() => setShowLib(false)}>
          <div className="w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200 flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
              <div className="flex items-center gap-2 text-[14px] font-bold text-slate-900"><LayoutTemplate className="size-4 text-primary" /> Starter library</div>
              <button onClick={() => setShowLib(false)} aria-label="Close" className="p-1.5 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="size-4" /></button>
            </div>
            <div className="p-4 overflow-y-auto space-y-3">
              <p className="text-[12px] text-slate-500">Ready-made notices, orders and replies across every wing. Load one, fill the placeholders, and save it as your own.</p>
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-lg bg-slate-100 p-1">
                  {([["", "All"], ["officer", "Officer"], ["assessee", "Assessee"]] as const).map(([v, l]) => (
                    <button key={v} onClick={() => setLibSide(v)}
                      className={cn("px-3 py-1 rounded-md text-[12px] font-semibold transition-colors",
                        libSide === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}>
                      {l}
                    </button>
                  ))}
                </div>
                <div className="relative flex-1 min-w-[160px]">
                  <Search className="absolute left-2.5 top-2 size-3.5 text-slate-400" />
                  <input value={libQuery} onChange={(e) => setLibQuery(e.target.value)} placeholder="Search templates…"
                    className="w-full pl-8 pr-2 h-8 rounded-lg border border-slate-200 bg-white text-[12.5px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20" />
                </div>
              </div>
              {libGroup && (
                <div className="flex items-center gap-2 text-[12px]">
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary ring-1 ring-primary/20 px-2.5 py-1 font-semibold">
                    {libGroup}
                    <button onClick={() => setLibGroup("")} aria-label="Clear group filter" className="ml-0.5 hover:text-primary/70"><X className="size-3" /></button>
                  </span>
                  <button onClick={() => setLibGroup("")} className="text-slate-500 hover:text-slate-800 font-medium">Show all groups</button>
                </div>
              )}
              {libGroups.length === 0 && <div className="text-[12.5px] text-slate-400 text-center py-6">No templates match.</div>}
              {libGroups.map(([group, items]) => (
                <div key={group} className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 px-0.5">{group} <span className="text-slate-300">· {items.length}</span></div>
                  {items.map((t) => (
                    <div key={t.id} className="rounded-xl ring-1 ring-slate-200 p-3">
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 text-[13.5px] font-semibold text-slate-800 truncate">{t.name}</span>
                        <span className={cn("shrink-0 text-[9.5px] font-semibold uppercase rounded px-1.5 py-0.5", t.side === "officer" ? "bg-primary/10 text-primary" : "bg-brand-green/15 text-brand-green")}>{t.side}</span>
                        <span className="shrink-0 text-[10px] font-semibold uppercase text-slate-400">{t.category}</span>
                      </div>
                      <p className="mt-1 text-[11.5px] text-slate-500 truncate">{t.body.replace(/\s+/g, " ").trim().slice(0, 160)}</p>
                      <div className="mt-2 flex items-center gap-2">
                        <Button size="sm" onClick={() => useLibraryItem(t)}>Use</Button>
                        <Button size="sm" variant="outline" onClick={() => copy(t.body)}><Copy className="size-3.5 mr-1" /> Copy</Button>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {dialog}
    </div>
  );
}
