import { useEffect, useState } from "react";
import { LifeBuoy, Send } from "lucide-react";
import { AdminSupportTicket, SupportMessage, api } from "@/api";
import { Empty, ErrorBanner, Header, Loading } from "./Dashboard";
import { Section } from "@/components/admin/charts";

export default function SupportTicketsPage() {
  const [tickets, setTickets] = useState<AdminSupportTicket[] | null>(null);
  const [status, setStatus] = useState<"open" | "closed" | "all">("open");
  const [err, setErr] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [msgs, setMsgs] = useState<SupportMessage[]>([]);
  const [activeTicket, setActiveTicket] = useState<AdminSupportTicket | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try { setTickets(await api.adminSupportListTickets(status === "all" ? undefined : status)); }
    catch (e: any) { setErr(e?.message ?? "load failed"); }
  }
  async function open(id: number) {
    setActiveId(id);
    try { const t = await api.adminSupportGetTicket(id); setActiveTicket(t); setMsgs(t.messages); }
    catch (e: any) { setErr(e?.message ?? "load failed"); }
  }
  useEffect(() => { refresh(); }, [status]);
  useEffect(() => {
    const iv = window.setInterval(() => {
      refresh();
      if (activeId) api.adminSupportGetTicket(activeId).then((t) => setMsgs(t.messages)).catch(() => {});
    }, 15000);
    return () => window.clearInterval(iv);
  }, [activeId, status]);

  async function send() {
    if (!activeId) return;
    const body = reply.trim();
    if (!body) return;
    setBusy(true);
    try {
      const m = await api.adminSupportAddMessage(activeId, body);
      setMsgs((prev) => [...prev, m]);
      setReply("");
      refresh();
    } catch (e: any) { setErr(e?.message ?? "send failed"); }
    finally { setBusy(false); }
  }

  async function close(id: number) {
    try {
      await api.adminSupportPatchTicket(id, "closed");
      refresh();
      if (activeId === id) open(id);
    } catch (e: any) { setErr(e?.message ?? "close failed"); }
  }
  async function reopen(id: number) {
    try {
      await api.adminSupportPatchTicket(id, "open");
      refresh();
      if (activeId === id) open(id);
    } catch (e: any) { setErr(e?.message ?? "reopen failed"); }
  }

  if (err) return <ErrorBanner msg={err} />;
  if (!tickets) return <Loading label="Loading tickets…" />;

  return (
    <div className="space-y-4">
      <Header
        title="Support tickets"
        subtitle="Officer-reported issues from the desktop app. Reply here — officers see your message in their Report Issue screen."
      />

      <div className="flex items-center gap-2">
        {(["open", "closed", "all"] as const).map((s) => (
          <button key={s} onClick={() => setStatus(s)}
            className={"h-8 px-3 rounded-md text-xs font-medium capitalize " +
              (status === s ? "bg-primary text-primary-foreground" : "text-slate-600 bg-white ring-1 ring-slate-200 hover:bg-slate-100")}>
            {s}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-[380px_1fr] gap-4 min-h-[560px]">
        <Section title="Tickets" icon={<LifeBuoy className="size-4" />}>
          {tickets.length === 0 ? (
            <Empty label="No tickets in this state." />
          ) : (
            <ul className="divide-y divide-slate-100 -mx-3">
              {tickets.map((t) => (
                <li key={t.id}>
                  <button onClick={() => open(t.id)}
                    className={"w-full text-left px-3 py-3 hover:bg-slate-50 " +
                               (activeId === t.id ? "bg-primary/5 border-l-4 border-l-primary" : "")}>
                    <div className="flex items-center gap-2">
                      <div className="font-medium text-slate-900 flex-1 truncate">{t.subject}</div>
                      {t.unread > 0 && (
                        <span className="inline-flex min-w-[20px] h-[20px] px-1.5 rounded-full bg-rose-600 text-white text-[11px] font-semibold items-center justify-center">
                          {t.unread}
                        </span>
                      )}
                    </div>
                    <div className="text-[12px] text-slate-500 mt-0.5 flex items-center gap-2">
                      <span>{t.officer?.full_name || t.officer?.username || "unknown"}</span>
                      <span>·</span>
                      <span className={"capitalize " + (t.status === "open" ? "text-emerald-700" : "text-slate-500")}>{t.status}</span>
                      {t.last_message_at && (
                        <>
                          <span>·</span>
                          <span>{new Date(t.last_message_at).toLocaleDateString()}</span>
                        </>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={activeTicket ? `Ticket #${activeTicket.id}` : "Conversation"}
          icon={<Send className="size-4" />}
          action={activeTicket && (
            <div className="flex items-center gap-2">
              {activeTicket.status === "open" ? (
                <button onClick={() => close(activeTicket.id)} className="text-[12px] font-medium text-rose-700 hover:text-rose-900">
                  Close ticket
                </button>
              ) : (
                <button onClick={() => reopen(activeTicket.id)} className="text-[12px] font-medium text-emerald-700 hover:text-emerald-900">
                  Reopen
                </button>
              )}
            </div>
          )}>
          {!activeTicket ? (
            <Empty label="Select a ticket on the left." />
          ) : (
            <div className="flex flex-col h-full min-h-[480px]">
              <div className="text-[13px] text-slate-600 mb-3">
                <b>{activeTicket.subject}</b>
                <div className="text-[11.5px] text-slate-500 mt-0.5">
                  {activeTicket.officer?.full_name || activeTicket.officer?.username} · {activeTicket.officer?.email}
                  {activeTicket.client_version && <> · desktop v{activeTicket.client_version}</>}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto space-y-3 rounded-md bg-slate-50 p-3 ring-1 ring-slate-200 mb-3">
                {msgs.map((m) => {
                  const isAdmin = m.sender_role === "admin";
                  return (
                    <div key={m.id} className={"flex " + (isAdmin ? "justify-end" : "justify-start")}>
                      <div className={"max-w-[80%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed shadow-sm " +
                                     (isAdmin
                                       ? "bg-primary text-primary-foreground rounded-tr-md"
                                       : "bg-white ring-1 ring-slate-200 text-slate-800 rounded-tl-md")}>
                        <div className="whitespace-pre-wrap">{m.body}</div>
                        <div className={"mt-1 text-[10.5px] " + (isAdmin ? "text-white/70" : "text-slate-400")}>
                          {isAdmin ? "You (admin)" : "Officer"} · {m.created_at ? new Date(m.created_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : ""}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {activeTicket.status === "open" ? (
                <div className="flex items-end gap-2">
                  <textarea value={reply} onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send(); }}
                    rows={2} placeholder="Reply — Ctrl/⌘+Enter to send." disabled={busy}
                    className="flex-1 rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 resize-y" />
                  <button onClick={send} disabled={busy || !reply.trim()}
                    className="h-10 px-4 rounded-md bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-60">
                    {busy ? "Sending…" : "Send"}
                  </button>
                </div>
              ) : (
                <div className="text-[12.5px] text-slate-500 text-center py-2">Ticket is closed. Reopen to reply.</div>
              )}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
