import { useCallback, useEffect, useRef, useState } from "react";
import { LifeBuoy, Paperclip, Play, Send, X } from "lucide-react";
import { AdminSupportTicket, SupportAttachment, SupportMessage, api } from "@/api";
import { Empty, ErrorBanner, Header, Loading } from "./Dashboard";
import { Section } from "@/components/admin/charts";

// Admin-side Support Tickets page. Renders per-officer conversations with
// inline image/video attachments (thumbnails in bubbles + lightbox).
// Composer accepts attach button, drag-drop, and clipboard paste.

const ACCEPTED = "image/png,image/jpeg,image/gif,image/webp,image/heic,image/bmp,video/mp4,video/webm,video/quicktime,video/x-matroska";
const MAX_FILES = 6;
const MAX_IMG = 10 * 1024 * 1024;
const MAX_VID = 100 * 1024 * 1024;
const isImg = (m: string) => m.startsWith("image/");
const isVid = (m: string) => m.startsWith("video/");

export default function SupportTicketsPage() {
  const [tickets, setTickets] = useState<AdminSupportTicket[] | null>(null);
  const [status, setStatus] = useState<"open" | "closed" | "all">("open");
  const [err, setErr] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [msgs, setMsgs] = useState<SupportMessage[]>([]);
  const [activeTicket, setActiveTicket] = useState<AdminSupportTicket | null>(null);
  const [reply, setReply] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [attachErr, setAttachErr] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<SupportAttachment | null>(null);

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
    if (!body && files.length === 0) return;
    setBusy(true);
    try {
      const m = await api.adminSupportAddMessage(activeId, body, files);
      setMsgs((prev) => [...prev, m]);
      setReply(""); setFiles([]);
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

      <div className="grid grid-cols-1 md:grid-cols-[380px_1fr] gap-4 md:min-h-[560px]">
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
                {msgs.map((m) => (
                  <MessageBubble key={m.id} m={m} onOpen={setLightbox} />
                ))}
              </div>
              {activeTicket.status === "open" ? (
                <ReplyComposer
                  value={reply} onValueChange={setReply}
                  files={files} onFilesChange={setFiles}
                  onSubmit={send} busy={busy}
                  error={attachErr} onError={setAttachErr}
                />
              ) : (
                <div className="text-[12.5px] text-slate-500 text-center py-2">Ticket is closed. Reopen to reply.</div>
              )}
            </div>
          )}
        </Section>
      </div>

      {lightbox && <Lightbox att={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

// ---------- message bubble with attachments -----------------------------
function MessageBubble({ m, onOpen }: {
  m: SupportMessage; onOpen: (a: SupportAttachment) => void;
}) {
  const isAdmin = m.sender_role === "admin";
  const atts = m.attachments || [];
  return (
    <div className={"flex " + (isAdmin ? "justify-end" : "justify-start")}>
      <div className={"max-w-[80%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed shadow-sm " +
                     (isAdmin
                       ? "bg-primary text-primary-foreground rounded-tr-md"
                       : "bg-white ring-1 ring-slate-200 text-slate-800 rounded-tl-md")}>
        {m.body && <div className="whitespace-pre-wrap">{m.body}</div>}
        {atts.length > 0 && (
          <div className={"mt-2 grid gap-2 " + (atts.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
            {atts.map((a) => (
              <AttachmentTile key={a.id} att={a} onOpen={() => onOpen(a)} dark={isAdmin} />
            ))}
          </div>
        )}
        <div className={"mt-1 text-[10.5px] " + (isAdmin ? "text-white/70" : "text-slate-400")}>
          {isAdmin ? "You (admin)" : "Officer"} · {m.created_at ? new Date(m.created_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : ""}
        </div>
      </div>
    </div>
  );
}

function AttachmentTile({ att, onOpen, dark }: {
  att: SupportAttachment; onOpen: () => void; dark: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const image = isImg(att.mime_type), video = isVid(att.mime_type);

  useEffect(() => {
    let cancelled = false;
    let obj: string | null = null;
    if (image || video) {
      api.adminSupportAttachmentBlobUrl(att.id, att.mime_type)
        .then((u) => { if (cancelled) { URL.revokeObjectURL(u); return; } obj = u; setUrl(u); })
        .catch(() => { if (!cancelled) setErr(true); });
    }
    return () => { cancelled = true; if (obj) URL.revokeObjectURL(obj); };
  }, [att.id, att.mime_type, image, video]);

  const ring = dark ? "ring-1 ring-white/25" : "ring-1 ring-slate-200";
  const kb = att.size_bytes < 1024 * 1024
    ? `${(att.size_bytes / 1024).toFixed(0)} KB`
    : `${(att.size_bytes / (1024 * 1024)).toFixed(1)} MB`;

  if (image) {
    return (
      <button onClick={onOpen} className={"group relative overflow-hidden rounded-lg bg-slate-100 aspect-[4/3] " + ring}>
        {url ? (
          <img src={url} alt={att.filename} className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform" />
        ) : err ? (
          <div className="w-full h-full grid place-items-center text-[11px] text-slate-500">Failed to load</div>
        ) : (
          <div className="w-full h-full grid place-items-center text-[11px] text-slate-500 animate-pulse">Loading…</div>
        )}
        <div className="absolute bottom-0 inset-x-0 px-2 py-1 text-[11px] text-white bg-gradient-to-t from-black/70 to-transparent truncate">
          {att.filename} · {kb}
        </div>
      </button>
    );
  }
  if (video) {
    return (
      <button onClick={onOpen} className={"group relative overflow-hidden rounded-lg bg-black aspect-video " + ring}>
        {url ? (
          <video src={url} preload="metadata" muted className="w-full h-full object-contain" />
        ) : (
          <div className="w-full h-full grid place-items-center text-[11px] text-white/70">Loading video…</div>
        )}
        <div className="absolute inset-0 grid place-items-center">
          <div className="w-11 h-11 rounded-full bg-white/85 grid place-items-center shadow-md group-hover:scale-110 transition-transform">
            <Play className="size-5 text-slate-900 ml-0.5" />
          </div>
        </div>
        <div className="absolute bottom-0 inset-x-0 px-2 py-1 text-[11px] text-white bg-gradient-to-t from-black/70 to-transparent truncate">
          {att.filename} · {kb}
        </div>
      </button>
    );
  }
  return (
    <div className={"rounded-lg px-3 py-2 text-[12px] " + (dark ? "bg-white/10 text-white" : "bg-slate-100 text-slate-700") + " " + ring}>
      {att.filename} · {kb}
    </div>
  );
}

// ---------- lightbox --------------------------------------------------
function Lightbox({ att, onClose }: { att: SupportAttachment; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let obj: string | null = null;
    let cancelled = false;
    api.adminSupportAttachmentBlobUrl(att.id, att.mime_type).then((u) => {
      if (cancelled) { URL.revokeObjectURL(u); return; }
      obj = u; setUrl(u);
    }).catch(() => {});
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { cancelled = true; window.removeEventListener("keydown", onKey); if (obj) URL.revokeObjectURL(obj); };
  }, [att.id, att.mime_type, onClose]);
  const video = isVid(att.mime_type);
  return (
    <div onClick={onClose} className="fixed inset-0 z-50 bg-black/85 grid place-items-center p-6 cursor-zoom-out">
      <div className="max-w-[92vw] max-h-[92vh] flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
        {url ? (
          video
            ? <video src={url} controls autoPlay className="max-w-[92vw] max-h-[80vh] rounded-lg shadow-2xl" />
            : <img src={url} alt={att.filename} className="max-w-[92vw] max-h-[80vh] rounded-lg shadow-2xl" />
        ) : (
          <div className="text-white text-sm animate-pulse">Loading…</div>
        )}
        <div className="text-white/80 text-[13px] flex items-center gap-3">
          <span className="truncate max-w-[70vw]">{att.filename}</span>
          {url && <a href={url} download={att.filename} className="text-white underline text-[12.5px]">Download</a>}
          <button onClick={onClose} className="text-white/70 hover:text-white text-[12.5px]">Close (Esc)</button>
        </div>
      </div>
    </div>
  );
}

// ---------- reply composer with attachments ---------------------------
function ReplyComposer({
  value, onValueChange, files, onFilesChange, onSubmit, busy, error, onError,
}: {
  value: string;
  onValueChange: (v: string) => void;
  files: File[];
  onFilesChange: (f: File[]) => void;
  onSubmit: () => void;
  busy: boolean;
  error: string | null;
  onError: (m: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const addFiles = useCallback((incoming: File[]) => {
    onError(null);
    const merged = [...files];
    for (const f of incoming) {
      if (!f) continue;
      if (!(isImg(f.type) || isVid(f.type))) {
        onError(`"${f.name || "file"}" isn't supported. Attach an image or a short recording.`);
        continue;
      }
      const cap = isVid(f.type) ? MAX_VID : MAX_IMG;
      if (f.size > cap) {
        onError(`"${f.name}" exceeds the ${cap === MAX_VID ? "100 MB" : "10 MB"} limit.`);
        continue;
      }
      if (merged.length >= MAX_FILES) { onError(`At most ${MAX_FILES} files per message.`); break; }
      merged.push(f);
    }
    onFilesChange(merged);
  }, [files, onFilesChange, onError]);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fl = e.target.files ? Array.from(e.target.files) : [];
    if (fl.length) addFiles(fl);
    e.target.value = "";
  };
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items || [];
    const pasted: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (f) {
          const stamped = f.name && f.name !== "image.png"
            ? f
            : new File([f], `screenshot-${Date.now()}.${(f.type.split("/")[1] || "png")}`, { type: f.type });
          pasted.push(stamped);
        }
      }
    }
    if (pasted.length) { e.preventDefault(); addFiles(pasted); }
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const fl = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
    if (fl.length) addFiles(fl);
  };

  return (
    <div
      onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={onDrop}
      className={"relative " + (dragging ? "ring-2 ring-primary/40 ring-inset rounded-md" : "")}
    >
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {files.map((f, i) => (
            <PendingChip key={i} file={f} onRemove={() => onFilesChange(files.filter((_, j) => j !== i))} />
          ))}
        </div>
      )}
      <div className="flex items-stretch gap-2">
        <textarea value={value} onChange={(e) => onValueChange(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") onSubmit(); }}
          onPaste={onPaste}
          rows={3} placeholder="Reply — Ctrl/⌘+Enter to send. Attach a screenshot, or paste one with Ctrl/⌘+V." disabled={busy}
          className="flex-1 min-h-[80px] rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 resize-y" />
        <div className="flex flex-col gap-2">
          <button
            type="button" onClick={() => inputRef.current?.click()}
            className="h-10 px-3 rounded-md border border-slate-200 text-slate-700 text-[13px] font-semibold hover:bg-slate-50 inline-flex items-center gap-1.5"
            title="Attach screenshots or a short recording"
          >
            <Paperclip className="size-3.5" /> Attach
          </button>
          <button onClick={onSubmit} disabled={busy || (!value.trim() && files.length === 0)}
            className="flex-1 min-h-[40px] px-4 rounded-md bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-60">
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
      <input ref={inputRef} type="file" multiple accept={ACCEPTED} onChange={onPick} className="hidden" />
      <div className="mt-1 text-[11.5px] text-slate-400">
        Up to {MAX_FILES} files — images (≤10 MB) or videos (≤100 MB). Drop or paste anywhere in this box.
      </div>
      {error && (
        <div className="mt-2 text-[13px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{error}</div>
      )}
      {dragging && (
        <div className="absolute inset-0 rounded-md grid place-items-center bg-white/90 border-2 border-dashed border-primary/60 text-primary font-semibold text-[13.5px] pointer-events-none">
          Drop your screenshot or recording here
        </div>
      )}
    </div>
  );
}

function PendingChip({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [thumb, setThumb] = useState<string | null>(null);
  const [duration, setDuration] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setThumb(u);
    if (isVid(file.type)) {
      const v = document.createElement("video");
      v.preload = "metadata"; v.src = u;
      v.onloadedmetadata = () => {
        const s = Math.round(v.duration);
        setDuration(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
      };
    }
    return () => URL.revokeObjectURL(u);
  }, [file]);
  const sizeLabel = file.size < 1024 * 1024
    ? `${(file.size / 1024).toFixed(0)} KB`
    : `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
  return (
    <div className="relative pl-1 py-1 pr-8 rounded-lg border border-slate-200 bg-slate-50 flex items-center gap-2 max-w-[220px]">
      <div className="relative shrink-0 w-10 h-10 rounded-md overflow-hidden bg-slate-200">
        {thumb && isImg(file.type) && <img src={thumb} className="w-full h-full object-cover" alt="" />}
        {thumb && isVid(file.type) && (
          <>
            <video src={thumb} muted preload="metadata" className="w-full h-full object-cover" />
            <div className="absolute inset-0 grid place-items-center bg-black/25">
              <Play className="size-3 text-white" />
            </div>
          </>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-slate-800 truncate">{file.name}</div>
        <div className="text-[10.5px] text-slate-500">{sizeLabel}{duration ? ` · ${duration}` : ""}</div>
      </div>
      <button type="button" onClick={onRemove}
        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-slate-200 text-slate-600 grid place-items-center hover:bg-slate-300"
        aria-label="Remove"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
