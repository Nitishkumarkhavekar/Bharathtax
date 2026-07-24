import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, type SupportMessage, type SupportTicket } from "../api";

// Two-panel Report-Issue workspace: ticket list on the left, active
// conversation on the right.  Officers open a new ticket, admins reply via
// the web admin panel, and the desktop polls for updates every 15 s while
// the screen is visible.
export default function ReportIssue() {
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [activeTicket, setActiveTicket] = useState<SupportTicket | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const version = useRef<string>("");
  useEffect(() => { window.bharat.app.version().then((v) => (version.current = v)); }, []);

  async function refreshList(quiet = false) {
    try { setTickets(await api.supportListTickets()); }
    catch (e: any) { if (!quiet) setErr(e instanceof ApiError ? e.message : String(e)); }
  }
  async function openTicket(id: number) {
    setActiveId(id);
    try {
      const t = await api.supportGetTicket(id);
      setActiveTicket(t);
      setMessages(t.messages);
    } catch (e: any) { setErr(e instanceof ApiError ? e.message : String(e)); }
  }

  useEffect(() => { refreshList(); }, []);
  useEffect(() => {
    const id = window.setInterval(() => {
      refreshList(true);
      if (activeId) api.supportGetTicket(activeId).then((t) => setMessages(t.messages)).catch(() => {/*silent*/});
    }, 15000);
    return () => window.clearInterval(id);
  }, [activeId]);

  async function sendReply() {
    if (!activeId) return;
    const body = reply.trim();
    if (!body) return;
    setBusy(true); setErr(null);
    try {
      const m = await api.supportAddMessage(activeId, body);
      setMessages((prev) => [...prev, m]);
      setReply("");
      refreshList(true);
    } catch (e: any) { setErr(e instanceof ApiError ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="w-full h-full flex flex-col px-8 py-6 gap-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Report an issue</h1>
          <p className="text-[13.5px] text-slate-500 mt-0.5">
            Chat directly with an administrator. They'll reply from the web admin panel.
          </p>
        </div>
        <button
          onClick={() => { setComposing(true); setActiveId(null); }}
          className="inline-flex items-center gap-1.5 h-10 px-4 rounded-md bg-ashoka-600 text-white font-semibold text-[14px] hover:bg-ashoka-500"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
          New ticket
        </button>
      </header>

      {err && (
        <div className="text-[13.5px] text-ashoka-700 bg-ashoka-50 border border-ashoka-200 rounded-lg px-3 py-2">{err}</div>
      )}

      <div className="flex-1 min-h-0 grid grid-cols-[320px_1fr] gap-4">
        {/* Ticket list */}
        <aside className="min-h-0 rounded-xl bg-white ring-1 ring-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-slate-100 text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Your tickets
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {!tickets ? (
              <div className="text-[13.5px] text-slate-500 px-4 py-6 text-center">Loading…</div>
            ) : tickets.length === 0 ? (
              <div className="text-[13.5px] text-slate-500 px-4 py-6 text-center">
                No tickets yet — click <b>New ticket</b> to report an issue.
              </div>
            ) : tickets.map((t) => (
              <button key={t.id} onClick={() => openTicket(t.id)}
                className={"w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50/60 " +
                           (activeId === t.id ? "bg-navy-50/60 border-l-4 border-l-navy-700" : "")}>
                <div className="flex items-center gap-2">
                  <div className="text-[14px] font-medium text-slate-900 flex-1 truncate">{t.subject}</div>
                  {t.unread > 0 && (
                    <span className="inline-flex min-w-[20px] h-[20px] px-1.5 rounded-full bg-ashoka-600 text-white text-[11px] font-semibold items-center justify-center">
                      {t.unread}
                    </span>
                  )}
                </div>
                <div className="text-[12px] text-slate-500 mt-0.5 flex items-center gap-2">
                  <span className={"inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10.5px] font-semibold capitalize " +
                                   (t.status === "open" ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600")}>
                    <span className="size-1.5 rounded-full bg-current" /> {t.status}
                  </span>
                  {t.last_message_at && (
                    <span>{new Date(t.last_message_at).toLocaleDateString()} {new Date(t.last_message_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </aside>

        {/* Right side */}
        <section className="min-h-0 rounded-xl bg-white ring-1 ring-slate-200 shadow-sm overflow-hidden flex flex-col">
          {composing ? (
            <NewTicketPanel
              onCancel={() => setComposing(false)}
              onCreated={(t) => { setComposing(false); refreshList(true); openTicket(t.id); }}
              clientVersion={version.current}
            />
          ) : activeTicket ? (
            <>
              <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-semibold text-slate-900 truncate">{activeTicket.subject}</div>
                  <div className="text-[12px] text-slate-500 mt-0.5">
                    Ticket #{activeTicket.id} · {activeTicket.status}
                    {activeTicket.client_version && <> · v{activeTicket.client_version}</>}
                  </div>
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3 bg-slate-50/40">
                {messages.map((m) => (
                  <MessageBubble key={m.id} m={m} />
                ))}
              </div>
              {activeTicket.status === "open" ? (
                <div className="border-t border-slate-100 p-3 flex items-stretch gap-2 bg-white">
                  <textarea
                    value={reply} onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") sendReply(); }}
                    rows={3}
                    placeholder="Type your reply — Ctrl/⌘+Enter to send."
                    disabled={busy}
                    className="flex-1 min-h-[80px] rounded-md border border-slate-200 px-3 py-2 text-[14px] leading-relaxed focus:outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-500/20 resize-y"
                  />
                  <button onClick={sendReply} disabled={busy || !reply.trim()}
                    className="self-stretch px-5 rounded-md bg-navy-800 text-white font-semibold text-[14px] hover:bg-navy-700 disabled:opacity-60">
                    {busy ? "Sending…" : "Send"}
                  </button>
                </div>
              ) : (
                <div className="border-t border-slate-100 px-4 py-3 text-[12.5px] text-slate-500 text-center bg-slate-50">
                  This ticket has been closed. Open a new ticket to continue.
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 grid place-items-center text-slate-500 text-[13.5px] p-8 text-center">
              Select a ticket on the left to see the conversation.
              <br />Or click <b>New ticket</b> at the top-right to start a new one.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function MessageBubble({ m }: { m: SupportMessage }) {
  const isOfficer = m.sender_role === "officer";
  return (
    <div className={"flex " + (isOfficer ? "justify-end" : "justify-start")}>
      <div className={"max-w-[80%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed shadow-sm " +
                     (isOfficer
                       ? "bg-navy-800 text-white rounded-tr-md"
                       : "bg-white ring-1 ring-slate-200 text-slate-800 rounded-tl-md")}>
        <div className="whitespace-pre-wrap">{m.body}</div>
        <div className={"mt-1 text-[10.5px] " + (isOfficer ? "text-white/60" : "text-slate-400")}>
          {isOfficer ? "You" : "Support"} · {m.created_at ? new Date(m.created_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : ""}
        </div>
      </div>
    </div>
  );
}

function NewTicketPanel({ onCancel, onCreated, clientVersion }: {
  onCancel: () => void; onCreated: (t: SupportTicket) => void; clientVersion: string;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canSubmit = useMemo(() => subject.trim().length >= 3 && body.trim().length > 0, [subject, body]);
  async function submit() {
    if (!canSubmit) return;
    setBusy(true); setErr(null);
    try {
      const t = await api.supportCreateTicket({
        subject: subject.trim(), body: body.trim(), client_version: clientVersion || undefined,
      });
      onCreated(t);
    } catch (e: any) { setErr(e instanceof ApiError ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <>
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
        <div className="text-[15px] font-semibold text-slate-900">Open a new ticket</div>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-700" aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      {/* Two-part flex column: subject stays fixed at the top, the description
          textarea grows to fill every remaining vertical pixel.  No more
          empty white space between the textarea and the footer. */}
      <div className="flex-1 min-h-0 flex flex-col p-5 gap-4">
        <div>
          <label className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-slate-500">Subject</label>
          <input value={subject} onChange={(e) => setSubject(e.target.value)}
            placeholder="One-line summary — e.g. Draft download failing"
            className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2.5 text-[14px] focus:outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-500/20"
            autoFocus />
        </div>
        <div className="flex-1 min-h-0 flex flex-col">
          <label className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-slate-500">Describe the issue</label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)}
            placeholder="What happened? What did you expect? Steps to reproduce, error messages, screenshots you have on hand."
            className="mt-1 flex-1 min-h-[240px] w-full rounded-md border border-slate-200 px-3 py-2.5 text-[14px] leading-relaxed focus:outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-500/20 resize-none" />
        </div>
        {err && <div className="text-[13.5px] text-ashoka-700 bg-ashoka-50 border border-ashoka-200 rounded px-3 py-2">{err}</div>}
      </div>
      <div className="border-t border-slate-100 p-3 flex items-center justify-end gap-2">
        <button onClick={onCancel} className="h-10 px-4 rounded-md text-slate-600 hover:bg-slate-100 font-medium text-[14px]">Cancel</button>
        <button onClick={submit} disabled={busy || !canSubmit}
          className="h-10 px-5 rounded-md bg-navy-800 text-white font-semibold text-[14px] hover:bg-navy-700 disabled:opacity-60">
          {busy ? "Sending…" : "Send to support"}
        </button>
      </div>
    </>
  );
}
