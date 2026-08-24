import { useEffect, useState } from "react";
import { FileText, Plus, Trash2, Copy } from "lucide-react";
import { api, WsTemplate } from "../api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

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

  const load = async () => setItems(await api.wsTemplates());
  useEffect(() => {
    (async () => {
      try { await load(); } catch (e: any) { toast.error(e?.message || "Could not load templates."); }
      finally { setLoading(false); }
    })();
  }, []);

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
        <Button className="ml-auto" onClick={startNew}><Plus className="size-4 mr-1" /> New</Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5 items-start">
        <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-2">
          {loading && <div className="text-[13px] text-slate-400 py-6 text-center">Loading…</div>}
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
      {dialog}
    </div>
  );
}
