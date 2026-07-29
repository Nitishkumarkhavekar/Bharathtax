import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, type SupportAttachment, type SupportMessage, type SupportTicket } from "../api";

// Two-panel Report-Issue workspace: ticket list on the left, active
// conversation on the right.  Officers open a new ticket, admins reply via
// the web admin panel, and the desktop polls for updates every 15 s while
// the screen is visible.
//
// Attachments: officers can drop / pick / paste screenshots (PNG/JPEG/GIF/
// WEBP/HEIC/BMP up to 10 MB each) and short screen recordings (MP4/WEBM/MOV/
// MKV up to 100 MB each). Up to 6 files per message. Renders inline in the
// message bubble with a click-to-open lightbox / player.
export default function ReportIssue() {
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [activeTicket, setActiveTicket] = useState<SupportTicket | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [lightbox, setLightbox] = useState<SupportAttachment | null>(null);

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
            <ConversationView
              ticket={activeTicket}
              messages={messages}
              onReplied={(m) => { setMessages((prev) => [...prev, m]); refreshList(true); }}
              onOpenAttachment={setLightbox}
            />
          ) : (
            <div className="flex-1 grid place-items-center text-slate-500 text-[13.5px] p-8 text-center">
              Select a ticket on the left to see the conversation.
              <br />Or click <b>New ticket</b> at the top-right to start a new one.
            </div>
          )}
        </section>
      </div>

      {lightbox && <AttachmentLightbox att={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conversation view — messages list + reply composer (with attachments).
// ---------------------------------------------------------------------------
function ConversationView({
  ticket, messages, onReplied, onOpenAttachment,
}: {
  ticket: SupportTicket;
  messages: SupportMessage[];
  onReplied: (m: SupportMessage) => void;
  onOpenAttachment: (a: SupportAttachment) => void;
}) {
  const [reply, setReply] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send() {
    const body = reply.trim();
    if (!body && files.length === 0) return;
    setBusy(true); setErr(null);
    try {
      const m = await api.supportAddMessage(ticket.id, body, files);
      onReplied(m);
      setReply(""); setFiles([]);
    } catch (e: any) { setErr(e instanceof ApiError ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <>
      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-semibold text-slate-900 truncate">{ticket.subject}</div>
          <div className="text-[12px] text-slate-500 mt-0.5">
            Ticket #{ticket.id} · {ticket.status}
            {ticket.client_version && <> · v{ticket.client_version}</>}
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3 bg-slate-50/40">
        {messages.map((m) => (
          <MessageBubble key={m.id} m={m} onOpenAttachment={onOpenAttachment} />
        ))}
      </div>
      {ticket.status === "open" ? (
        <AttachmentComposer
          value={reply}
          onChangeValue={setReply}
          files={files}
          onFilesChange={setFiles}
          onSubmit={send}
          submitLabel={busy ? "Sending…" : "Send"}
          submitDisabled={busy || (!reply.trim() && files.length === 0)}
          placeholder="Type your reply — Ctrl/⌘+Enter to send. Attach a screenshot or paste one directly with Ctrl/⌘+V."
          errorText={err}
          onError={setErr}
          minTextRows={3}
          compact
        />
      ) : (
        <div className="border-t border-slate-100 px-4 py-3 text-[12.5px] text-slate-500 text-center bg-slate-50">
          This ticket has been closed. Open a new ticket to continue.
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Message bubble — renders body + attachment strip. Images and videos are
// rendered inline; the officer can click to open the lightbox / player.
// ---------------------------------------------------------------------------
function MessageBubble({ m, onOpenAttachment }: {
  m: SupportMessage;
  onOpenAttachment: (a: SupportAttachment) => void;
}) {
  const isOfficer = m.sender_role === "officer";
  const atts = m.attachments || [];
  return (
    <div className={"flex " + (isOfficer ? "justify-end" : "justify-start")}>
      <div className={"max-w-[80%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed shadow-sm " +
                     (isOfficer
                       ? "bg-navy-800 text-white rounded-tr-md"
                       : "bg-white ring-1 ring-slate-200 text-slate-800 rounded-tl-md")}>
        {m.body && <div className="whitespace-pre-wrap">{m.body}</div>}
        {atts.length > 0 && (
          <div className={"mt-2 grid gap-2 " + (atts.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
            {atts.map((a) => (
              <AttachmentTile key={a.id} att={a} onOpen={() => onOpenAttachment(a)} onDarkBg={isOfficer} />
            ))}
          </div>
        )}
        <div className={"mt-1 text-[10.5px] " + (isOfficer ? "text-white/60" : "text-slate-400")}>
          {isOfficer ? "You" : "Support"} · {m.created_at ? new Date(m.created_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : ""}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attachment tile — thumbnail for images, poster + play glyph for videos,
// generic file card for anything else. Streams via the auth-protected
// /support/attachments/:id endpoint using a Blob URL.
// ---------------------------------------------------------------------------
function AttachmentTile({ att, onOpen, onDarkBg }: {
  att: SupportAttachment; onOpen: () => void; onDarkBg: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const isImage = att.mime_type.startsWith("image/");
  const isVideo = att.mime_type.startsWith("video/");

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    if (isImage || isVideo) {
      api.supportAttachmentBlobUrl(att.id, att.mime_type)
        .then((u) => { if (!cancelled) { objectUrl = u; setUrl(u); } })
        .catch(() => { if (!cancelled) setErr(true); });
    }
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [att.id, att.mime_type, isImage, isVideo]);

  const borderCls = onDarkBg ? "ring-1 ring-white/25" : "ring-1 ring-slate-200";
  const kb = att.size_bytes < 1024 * 1024
    ? `${(att.size_bytes / 1024).toFixed(0)} KB`
    : `${(att.size_bytes / (1024 * 1024)).toFixed(1)} MB`;

  if (isImage) {
    return (
      <button onClick={onOpen}
        className={"group relative overflow-hidden rounded-lg bg-slate-100 aspect-[4/3] " + borderCls}>
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
  if (isVideo) {
    return (
      <button onClick={onOpen}
        className={"group relative overflow-hidden rounded-lg bg-black aspect-video " + borderCls}>
        {url ? (
          <video src={url} preload="metadata" muted className="w-full h-full object-contain" />
        ) : (
          <div className="w-full h-full grid place-items-center text-[11px] text-white/70">Loading video…</div>
        )}
        <div className="absolute inset-0 grid place-items-center">
          <div className="w-11 h-11 rounded-full bg-white/85 grid place-items-center shadow-md group-hover:scale-110 transition-transform">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-slate-900 ml-0.5"><path d="M8 5v14l11-7z" /></svg>
          </div>
        </div>
        <div className="absolute bottom-0 inset-x-0 px-2 py-1 text-[11px] text-white bg-gradient-to-t from-black/70 to-transparent truncate">
          {att.filename} · {kb}
        </div>
      </button>
    );
  }
  return (
    <div className={"rounded-lg px-3 py-2 text-[12px] " + (onDarkBg ? "bg-white/10 text-white" : "bg-slate-100 text-slate-700") + " " + borderCls}>
      {att.filename} · {kb}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lightbox — full-screen preview for images / videos.
// ---------------------------------------------------------------------------
function AttachmentLightbox({ att, onClose }: {
  att: SupportAttachment; onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let obj: string | null = null;
    let cancelled = false;
    api.supportAttachmentBlobUrl(att.id, att.mime_type).then((u) => {
      if (cancelled) { URL.revokeObjectURL(u); return; }
      obj = u; setUrl(u);
    }).catch(() => {});
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKey);
      if (obj) URL.revokeObjectURL(obj);
    };
  }, [att.id, att.mime_type, onClose]);

  const isVideo = att.mime_type.startsWith("video/");
  return (
    <div onClick={onClose} className="fixed inset-0 z-50 bg-black/85 grid place-items-center p-6 cursor-zoom-out">
      <div className="max-w-[92vw] max-h-[92vh] flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
        {url ? (
          isVideo ? (
            <video src={url} controls autoPlay className="max-w-[92vw] max-h-[80vh] rounded-lg shadow-2xl" />
          ) : (
            <img src={url} alt={att.filename} className="max-w-[92vw] max-h-[80vh] rounded-lg shadow-2xl" />
          )
        ) : (
          <div className="text-white text-sm animate-pulse">Loading…</div>
        )}
        <div className="text-white/80 text-[13px] flex items-center gap-3">
          <span className="truncate max-w-[70vw]">{att.filename}</span>
          {url && (
            <a href={url} download={att.filename} className="text-white underline text-[12.5px]">Download</a>
          )}
          <button onClick={onClose} className="text-white/70 hover:text-white text-[12.5px]">Close (Esc)</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attachment composer — a reusable textarea + attach button + paste + drag.
// Used by both NewTicketPanel and ConversationView. Keeps the pending-file
// list local to the caller so submit resets it on success.
// ---------------------------------------------------------------------------
const ACCEPTED = "image/png,image/jpeg,image/gif,image/webp,image/heic,image/bmp,video/mp4,video/webm,video/quicktime,video/x-matroska";
const MAX_FILES = 6;
const MAX_IMG = 10 * 1024 * 1024;
const MAX_VID = 100 * 1024 * 1024;

function isImage(f: File) { return f.type.startsWith("image/"); }
function isVideo(f: File) { return f.type.startsWith("video/"); }

function AttachmentComposer({
  value, onChangeValue, files, onFilesChange, onSubmit,
  submitLabel, submitDisabled, placeholder, errorText, onError,
  minTextRows = 4, compact = false,
}: {
  value: string;
  onChangeValue: (v: string) => void;
  files: File[];
  onFilesChange: (files: File[]) => void;
  onSubmit: () => void;
  submitLabel: string;
  submitDisabled: boolean;
  placeholder: string;
  errorText: string | null;
  onError: (msg: string | null) => void;
  minTextRows?: number;
  compact?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const addFiles = useCallback((incoming: File[]) => {
    onError(null);
    const combined = [...files];
    for (const f of incoming) {
      if (!f) continue;
      if (!(isImage(f) || isVideo(f))) {
        onError(`"${f.name || "file"}" isn't a supported type. Attach screenshots (PNG/JPEG/GIF/WEBP/HEIC/BMP) or short recordings (MP4/WEBM/MOV/MKV).`);
        continue;
      }
      const cap = isVideo(f) ? MAX_VID : MAX_IMG;
      if (f.size > cap) {
        onError(`"${f.name}" is larger than ${cap === MAX_VID ? "100 MB" : "10 MB"}. Please trim it and try again.`);
        continue;
      }
      if (combined.length >= MAX_FILES) {
        onError(`You can attach at most ${MAX_FILES} files per message.`);
        break;
      }
      combined.push(f);
    }
    onFilesChange(combined);
  }, [files, onFilesChange, onError]);

  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fl = e.target.files ? Array.from(e.target.files) : [];
    if (fl.length) addFiles(fl);
    e.target.value = "";
  };

  // Paste screenshots directly from the clipboard.
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items || [];
    const pasted: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (f) {
          // Clipboard PNGs come back with generic names like "image.png"; keep
          // them but stamp a timestamp so multiple pastes don't collide.
          const stamped = f.name && f.name !== "image.png"
            ? f
            : new File([f], `screenshot-${Date.now()}.${(f.type.split("/")[1] || "png")}`, { type: f.type });
          pasted.push(stamped);
        }
      }
    }
    if (pasted.length) { e.preventDefault(); addFiles(pasted); }
  };

  // Native drag & drop across the whole composer.
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const fl = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
    if (fl.length) addFiles(fl);
  };

  return (
    <div
      onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => {
        // Only clear when we leave the composer entirely, not when moving over children.
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
      className={"relative " + (compact
        ? "border-t border-slate-100 bg-white p-3"
        : "bg-white") + (dragging ? " ring-2 ring-navy-500/40 ring-inset" : "")}
    >
      {/* Pending file chips */}
      {files.length > 0 && (
        <div className={"flex flex-wrap gap-2 " + (compact ? "mb-2" : "mb-3 px-1")}>
          {files.map((f, i) => (
            <PendingChip key={i} file={f} onRemove={() => onFilesChange(files.filter((_, j) => j !== i))} />
          ))}
        </div>
      )}

      <div className="flex items-stretch gap-2">
        <textarea
          value={value}
          onChange={(e) => onChangeValue(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") onSubmit(); }}
          onPaste={onPaste}
          rows={minTextRows}
          placeholder={placeholder}
          className={"flex-1 min-h-[80px] rounded-md border border-slate-200 px-3 py-2 text-[14px] leading-relaxed focus:outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-500/20 " + (compact ? "resize-y" : "resize-none")}
        />
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="h-10 px-3 rounded-md border border-slate-200 text-slate-700 text-[13px] font-semibold hover:bg-slate-50 inline-flex items-center gap-1.5"
            title="Attach screenshots or a short recording"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.49"/></svg>
            Attach
          </button>
          <button
            onClick={onSubmit} disabled={submitDisabled}
            className="flex-1 min-h-[40px] px-5 rounded-md bg-navy-800 text-white font-semibold text-[14px] hover:bg-navy-700 disabled:opacity-60"
          >
            {submitLabel}
          </button>
        </div>
      </div>

      <input
        ref={inputRef} type="file" accept={ACCEPTED} multiple
        onChange={onPickFiles} className="hidden"
      />

      <div className={"mt-1 text-[11.5px] text-slate-400 flex items-center gap-3 " + (compact ? "" : "px-1")}>
        <span>Attach up to {MAX_FILES} files — images (≤10 MB) or videos (≤100 MB).</span>
        <span className="text-slate-300">·</span>
        <span>Drop them here, or paste a screenshot with Ctrl/⌘+V.</span>
      </div>

      {errorText && (
        <div className={"mt-2 text-[13px] text-ashoka-700 bg-ashoka-50 border border-ashoka-200 rounded px-3 py-2 " + (compact ? "" : "mx-1")}>
          {errorText}
        </div>
      )}

      {dragging && (
        <div className="absolute inset-0 rounded-md grid place-items-center bg-white/90 border-2 border-dashed border-navy-400 text-navy-700 font-semibold text-[13.5px] pointer-events-none">
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
    if (isVideo(file)) {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.src = u;
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
    <div className="relative pl-1 pr-2 py-1 pr-8 rounded-lg border border-slate-200 bg-slate-50 flex items-center gap-2 max-w-[220px]">
      <div className="relative shrink-0 w-10 h-10 rounded-md overflow-hidden bg-slate-200">
        {thumb && isImage(file) && <img src={thumb} className="w-full h-full object-cover" alt="" />}
        {thumb && isVideo(file) && (
          <>
            <video src={thumb} className="w-full h-full object-cover" muted preload="metadata" />
            <div className="absolute inset-0 grid place-items-center bg-black/25">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-white"><path d="M8 5v14l11-7z"/></svg>
            </div>
          </>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-slate-800 truncate">{file.name}</div>
        <div className="text-[10.5px] text-slate-500">{sizeLabel}{duration ? ` · ${duration}` : ""}</div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-slate-200 text-slate-600 grid place-items-center hover:bg-slate-300"
        aria-label="Remove"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New-ticket panel — subject + description + attachments.
// ---------------------------------------------------------------------------
function NewTicketPanel({ onCancel, onCreated, clientVersion }: {
  onCancel: () => void; onCreated: (t: SupportTicket) => void; clientVersion: string;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canSubmit = useMemo(
    () => subject.trim().length >= 3 && (body.trim().length > 0 || files.length > 0),
    [subject, body, files],
  );

  async function submit() {
    if (!canSubmit) return;
    setBusy(true); setErr(null);
    try {
      const t = await api.supportCreateTicket({
        subject: subject.trim(), body: body.trim(),
        client_version: clientVersion || undefined,
        files,
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
          + attachment composer grow to fill the remaining vertical pixels. */}
      <div className="flex-1 min-h-0 flex flex-col p-5 gap-4">
        <div>
          <label className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-slate-500">Subject</label>
          <input value={subject} onChange={(e) => setSubject(e.target.value)}
            placeholder="One-line summary — e.g. Draft download failing"
            className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2.5 text-[14px] focus:outline-none focus:border-navy-500 focus:ring-2 focus:ring-navy-500/20"
            autoFocus />
        </div>
        <div className="flex-1 min-h-0 flex flex-col">
          <label className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-slate-500 mb-1">
            Describe the issue
          </label>
          <div className="flex-1 min-h-0">
            <AttachmentComposer
              value={body}
              onChangeValue={setBody}
              files={files}
              onFilesChange={setFiles}
              onSubmit={submit}
              submitLabel={busy ? "Sending…" : "Send to support"}
              submitDisabled={busy || !canSubmit}
              placeholder="What happened? What did you expect? Steps to reproduce, error messages. Drop screenshots here or paste with Ctrl/⌘+V — you can also attach a short screen recording."
              errorText={err}
              onError={setErr}
              minTextRows={8}
            />
          </div>
        </div>
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
