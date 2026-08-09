import { useEffect, useMemo, useState } from "react";
import { Mail, Loader2, Check, Trash2, Building2, ExternalLink, Inbox } from "lucide-react";
import { api, ContactMessage } from "../../api";
import { toast } from "@/lib/toast";

export default function ContactMessagesPage() {
  const [rows, setRows] = useState<ContactMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<"open" | "all">("open");

  function load() {
    setLoading(true);
    api.adminContactList()
      .then(setRows)
      .catch((e: any) => setErr(e?.message ?? "Failed to load"))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function setHandled(m: ContactMessage, handled: boolean) {
    setRows((r) => r.map((x) => (x.id === m.id ? { ...x, handled } : x)));
    try {
      await api.adminContactSetHandled(m.id, handled);
      toast.success(handled ? "Marked handled" : "Reopened");
    } catch { toast.error("Couldn't update the enquiry"); load(); }
  }
  async function remove(m: ContactMessage) {
    if (!confirm(`Delete the enquiry from ${m.name}?`)) return;
    setRows((r) => r.filter((x) => x.id !== m.id));
    api.adminContactDelete(m.id)
      .then(() => toast.success("Enquiry deleted"))
      .catch(() => { toast.error("Couldn't delete the enquiry"); load(); });
  }

  const shown = useMemo(
    () => (filter === "open" ? rows.filter((r) => !r.handled) : rows),
    [rows, filter],
  );
  const openCount = rows.filter((r) => !r.handled).length;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-5">
        <div>
          <h1 className="font-serif text-2xl font-semibold tracking-tight text-slate-900 flex items-center gap-2">
            <Mail className="size-5 text-primary" /> Contact enquiries
          </h1>
          <p className="text-[13px] text-slate-500 mt-0.5">
            Messages submitted through the website contact form.
          </p>
        </div>
        <div className="inline-flex rounded-lg ring-1 ring-slate-200 bg-white p-0.5 text-[13px]">
          {(["open", "all"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={
                "px-3 py-1.5 rounded-md font-medium capitalize transition-colors " +
                (filter === f ? "bg-primary text-white" : "text-slate-600 hover:bg-slate-100")
              }
            >
              {f}{f === "open" && openCount > 0 ? ` (${openCount})` : ""}
            </button>
          ))}
        </div>
      </div>

      {err && <div className="rounded-lg bg-rose-50 text-rose-800 text-sm px-4 py-2.5 mb-4">{err}</div>}

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm py-12 justify-center">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : shown.length === 0 ? (
        <div className="text-center py-16">
          <div className="mx-auto size-12 rounded-xl bg-slate-100 grid place-items-center text-slate-400 mb-3">
            <Inbox className="size-6" />
          </div>
          <div className="text-[14px] text-slate-600 font-medium">
            {filter === "open" ? "No open enquiries." : "No enquiries yet."}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {shown.map((m) => (
            <div
              key={m.id}
              className={
                "rounded-xl bg-white ring-1 shadow-sm p-4 " +
                (m.handled ? "ring-slate-200 opacity-75" : "ring-slate-200")
              }
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[15px] font-semibold text-slate-900">{m.name}</span>
                    {m.topic && (
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                        {m.topic}
                      </span>
                    )}
                    {m.handled && (
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 inline-flex items-center gap-1">
                        <Check className="size-3" /> Handled
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-3 text-[12.5px] text-slate-500 flex-wrap">
                    <a href={`mailto:${m.email}`} className="text-primary hover:underline inline-flex items-center gap-1">
                      {m.email} <ExternalLink className="size-3" />
                    </a>
                    {m.organisation && (
                      <span className="inline-flex items-center gap-1"><Building2 className="size-3.5" /> {m.organisation}</span>
                    )}
                    {m.created_at && <span>{new Date(m.created_at).toLocaleString()}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setHandled(m, !m.handled)}
                    title={m.handled ? "Mark as open" : "Mark as handled"}
                    className={
                      "inline-flex items-center gap-1 text-[12.5px] font-medium px-2.5 py-1.5 rounded-lg ring-1 transition-colors " +
                      (m.handled
                        ? "ring-slate-200 text-slate-600 hover:bg-slate-100"
                        : "ring-emerald-200 text-emerald-700 hover:bg-emerald-50")
                    }
                  >
                    <Check className="size-3.5" /> {m.handled ? "Reopen" : "Handled"}
                  </button>
                  <button
                    onClick={() => remove(m)}
                    title="Delete"
                    className="p-2 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
              <p className="mt-3 text-[14px] text-slate-700 leading-relaxed whitespace-pre-wrap border-t border-slate-100 pt-3">
                {m.message}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
