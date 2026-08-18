import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ArrowUpRight, BookOpen, Brain, Check, ChevronLeft, ChevronRight, Copy, Download, Eye, FileText, Globe, Image as ImageIcon, Languages, Loader2, Pencil, RotateCcw, Scale, Square, Sparkles, ThumbsDown, ThumbsUp, User2, Volume2, X } from "lucide-react";
import { StarRating } from "../ui/StarRating";
import { Markdown, copyMarkdownRich } from "@/lib/markdown";
import { ChatMessage } from "@/lib/chatStore";
import { api } from "@/api";
import { useAuth } from "@/auth";
import { toast } from "@/lib/toast";
import { useSpeech, ttsSupported } from "@/lib/tts";
import { cn } from "@/lib/utils";

interface ChatMessagesProps {
  messages: ChatMessage[];
  busy: boolean;
  // Index of the assistant message being filled by a LIVE token stream, and the
  // current tool status shown before its first token arrives.
  liveIdx?: number | null;
  liveStatus?: string | null;
  // Topic follow-up suggestions for the latest answer (rendered under it).
  followups?: string[];
  onPickFollowup?: (q: string) => void;
  // Re-run the question that produced the assistant message at `idx`.
  onRegenerate?: (idx: number) => void;
  // Edit the user prompt at `idx` and re-run from there.
  onEditPrompt?: (idx: number, content: string) => void;
  // Answer an AI clarifying question (options / free text) — sent as the next turn.
  onClarify?: (text: string) => void;
}

export default function ChatMessages({
  messages,
  busy,
  liveIdx,
  liveStatus,
  followups,
  onPickFollowup,
  onRegenerate,
  onEditPrompt,
  onClarify,
}: ChatMessagesProps) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const speech = useSpeech();
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-8 space-y-6">
      {messages.map((m, idx) => (
        <Message
          key={idx}
          msg={m}
          question={idx > 0 && messages[idx - 1].role === "user" ? messages[idx - 1].content : undefined}
          live={idx === liveIdx}
          liveStatus={liveStatus ?? null}
          speaking={speech.speakingId === `m${idx}`}
          onToggleSpeak={(text: string) => speech.toggle(`m${idx}`, text)}
          onEdit={onEditPrompt && !busy ? (v: string) => onEditPrompt(idx, v) : undefined}
          onRegenerate={!busy && onRegenerate ? () => onRegenerate(idx) : undefined}
          onClarify={onClarify}
          isLast={idx === messages.length - 1}
        />
      ))}
      {/* Fallback "thinking" bubble only when NOT live-streaming (the live path
          shows its own status inside the streaming assistant bubble). */}
      {busy && (liveIdx === null || liveIdx === undefined) && <ThinkingBubble />}
      {!busy && onPickFollowup && followups && followups.length > 0 && (
        <div className="flex flex-wrap gap-1.5 sm:pl-11">
          {followups.map((q, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onPickFollowup(q)}
              className="inline-flex items-center gap-1 text-[12.5px] text-slate-600 bg-white ring-1 ring-slate-200 rounded-full px-3 py-1.5 hover:ring-primary/40 hover:text-primary transition-colors text-left animate-fade-up"
            >
              <span className="text-primary font-semibold">+</span> {q}
            </button>
          ))}
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}

// ----------------------------------------------------------------- ThinkingBubble
// Rotates through professional, in-character status phrases while the model
// is generating. The assistant avatar on the left gets a soft pulsing glow.
const STATUS_PHRASES = [
  "Searching primary sources",
  "Reading the Income-Tax Act",
  "Cross-referencing sections",
  "Checking CBDT circulars",
  "Composing your answer",
  "Polishing citations",
];

function ThinkingBubble() {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(
      () => setIdx((i) => (i + 1) % STATUS_PHRASES.length),
      1700,
    );
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex gap-3 animate-fade-up">
      <AssistantAvatar pulse />
      <div className="rounded-2xl bg-white border border-slate-200 px-4 py-3 shadow-sm min-w-[260px]">
        <div className="flex items-center gap-1.5">
          <span className="typing-dot" />
          <span className="typing-dot" />
          <span className="typing-dot" />
          <span
            key={idx}
            className="ml-2 text-[12.5px] font-medium text-slate-600 status-phrase"
          >
            {STATUS_PHRASES[idx]}…
          </span>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- Message
// A user's own prompt bubble with copy + inline-edit affordances (ChatGPT-style).
// Copy puts the prompt on the clipboard; Edit re-opens it in place, and saving
// re-runs the conversation from that prompt with the new text.
// When the AI is unsure or the request has multiple valid readings, it asks a
// clarifying question with options. Picking one sends it as the next turn; the
// "Other" pill opens a free-text box so the user can answer in their own words.
// A single clarification "card" — bold question at the top followed by
// number-badged option pills stacked one per row. Rendered by ClarifyPanel
// for each entry in the questions array.
function ClarifyCard({
  index, total, question, options, onPick,
}: {
  index: number; total: number; question: string; options: string[];
  onPick: (v: string) => void;
}) {
  const [other, setOther] = useState(false);
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => { if (other && ref.current) ref.current.focus(); }, [other]);
  const submit = () => { const v = text.trim(); if (v) onPick(v); };
  return (
    <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm p-4 space-y-3">
      {/* Bold question header — always rendered so the option list reads
          as a real "pick one to answer" panel, never a bare choice grid. */}
      <div className="pb-3 border-b border-slate-100 flex items-start gap-2.5">
        <div className="size-7 shrink-0 rounded-lg bg-primary/10 text-primary grid place-items-center mt-0.5">
          <Sparkles className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-primary mb-1">
            {total > 1 ? `Question ${index + 1} of ${total}` : "Clarification needed"}
          </div>
          <p className="text-[15px] font-semibold text-slate-900 leading-snug">
            {question}
          </p>
        </div>
      </div>
      <div className="space-y-1.5">
        {options.map((o, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onPick(o)}
            className="group w-full text-left flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl bg-white ring-1 ring-slate-200 hover:ring-primary/50 hover:bg-primary/[0.04] transition-all"
          >
            <span className="shrink-0 size-6 rounded-full bg-slate-100 text-slate-500 group-hover:bg-primary group-hover:text-white grid place-items-center text-[11px] font-semibold tabular-nums transition-colors">
              {i + 1}
            </span>
            <span className="text-[13.5px] text-slate-800 group-hover:text-slate-900 leading-snug">
              {o}
            </span>
          </button>
        ))}
        {!other ? (
          <button
            type="button"
            onClick={() => setOther(true)}
            className="w-full inline-flex items-center justify-center gap-1 text-[12.5px] px-3.5 py-2 rounded-xl bg-slate-50 ring-1 ring-dashed ring-slate-300 text-slate-500 hover:ring-primary/50 hover:text-primary transition-all"
          >
            <Pencil className="size-3.5" /> Answer in my own words
          </button>
        ) : (
          <div className="rounded-xl ring-1 ring-primary/30 bg-white p-2 shadow-sm animate-fade-up">
            <textarea
              ref={ref}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${e.target.scrollHeight}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
                if (e.key === "Escape") { setOther(false); setText(""); }
              }}
              rows={1}
              placeholder="Type your answer…"
              className="w-full resize-none bg-transparent outline-none text-[14px] px-2 py-1.5"
            />
            <div className="flex justify-end gap-2 mt-1">
              <button
                type="button"
                onClick={() => { setOther(false); setText(""); }}
                className="text-[12.5px] px-3 py-1 rounded-full text-slate-500 hover:bg-slate-100 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                className="text-[12.5px] px-3 py-1 rounded-full bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
              >
                Send
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ClarifyPanel — a sliding-window carousel when the AI asks more than one
// clarifying question in a single turn. One card at a time; prev / next
// arrows + dot indicators. Falls back to a single card when there's only
// one question.
function ClarifyPanel({
  questions, onPick,
}: {
  questions: { question: string; options: string[] }[];
  onPick: (v: string) => void;
}) {
  const [idx, setIdx] = useState(0);
  const safeIdx = Math.min(Math.max(0, idx), Math.max(0, questions.length - 1));
  const active = questions[safeIdx];
  if (!active) return null;
  const total = questions.length;
  const prev = () => setIdx((i) => Math.max(0, i - 1));
  const next = () => setIdx((i) => Math.min(total - 1, i + 1));
  return (
    <div className="mt-1 space-y-2">
      {/* Sliding window with animated transition between question cards. */}
      <div className="relative overflow-hidden">
        <div
          className="flex transition-transform duration-300 ease-out"
          style={{ width: `${total * 100}%`, transform: `translateX(-${(safeIdx * 100) / total}%)` }}
        >
          {questions.map((q, i) => (
            <div key={i} className="pr-1" style={{ width: `${100 / total}%` }}>
              <ClarifyCard
                index={i}
                total={total}
                question={q.question}
                options={q.options}
                onPick={onPick}
              />
            </div>
          ))}
        </div>
      </div>
      {total > 1 && (
        <div className="flex items-center justify-between px-1">
          <button
            type="button"
            onClick={prev}
            disabled={safeIdx === 0}
            className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md ring-1 ring-slate-200 bg-white text-[12px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="size-3.5" /> Prev
          </button>
          <div className="flex items-center gap-1.5">
            {questions.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setIdx(i)}
                aria-label={`Go to question ${i + 1}`}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === safeIdx ? "w-5 bg-primary" : "w-1.5 bg-slate-300 hover:bg-slate-400",
                )}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={next}
            disabled={safeIdx === total - 1}
            className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md ring-1 ring-slate-200 bg-white text-[12px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next <ChevronRight className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function UserMessage({
  content,
  attachments,
  onEdit,
}: {
  content: string;
  attachments?: import("@/lib/chatStore").ChatAttachment[];
  onEdit?: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const [copied, setCopied] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (editing && taRef.current) {
      const el = taRef.current;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [editing]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      toast.success("Prompt copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy");
    }
  }

  function save() {
    const v = draft.trim();
    setEditing(false);
    if (v && v !== content) onEdit?.(v);
    else setDraft(content);
  }

  if (editing) {
    return (
      <div className="flex justify-end animate-fade-up">
        <div className="w-full max-w-[85%] rounded-2xl bg-primary text-primary-foreground px-3.5 py-3 shadow-sm">
          <textarea
            ref={taRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); }
              if (e.key === "Escape") { setDraft(content); setEditing(false); }
            }}
            rows={1}
            className="w-full resize-none bg-transparent outline-none text-[15px] leading-relaxed placeholder:text-white/60"
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => { setDraft(content); setEditing(false); }}
              className="text-[12.5px] px-3 py-1 rounded-full bg-white/15 hover:bg-white/25 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              className="text-[12.5px] px-3 py-1 rounded-full bg-white text-primary font-medium hover:bg-white/90 transition-colors"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex flex-col items-end animate-fade-up">
      {/* Attachment chips — rendered ABOVE the text bubble in the same
          right-aligned column, so it's visually clear these files belong
          to this turn. Images get an inline thumbnail; other files show
          a file glyph + name + size. */}
      {attachments && attachments.length > 0 && (
        <div className="mb-1.5 flex flex-wrap justify-end gap-1.5 max-w-[80%]">
          {attachments.map((a, i) => (
            <UserAttachmentChip key={`${a.docId ?? i}_${a.filename}`} att={a} />
          ))}
        </div>
      )}
      {content && (
        <div className="max-w-[80%] rounded-2xl bg-primary text-primary-foreground px-4 py-2.5 shadow-sm whitespace-pre-wrap text-[15px] leading-relaxed">
          {content}
        </div>
      )}
      <div className="mt-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={copy}
          title="Copy prompt"
          className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
        >
          {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
        </button>
        {onEdit && (
          <button
            type="button"
            onClick={() => { setDraft(content); setEditing(true); }}
            title="Edit prompt"
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <Pencil className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// A single attachment "chip" inside a user's message bubble. Compact
// pill with a thumbnail (images) or file glyph (everything else), the
// filename, and the size — matches the visual language of the composer
// preview strip so the user recognises what they attached.
function UserAttachmentChip({ att }: { att: import("@/lib/chatStore").ChatAttachment }) {
  const isImage = (att.contentType || "").startsWith("image/") || !!att.previewDataUrl;
  const isPdf = (att.contentType || "") === "application/pdf" ||
                (att.filename || "").toLowerCase().endsWith(".pdf");
  const canInline = isImage || isPdf;
  const [preview, setPreview] = useState<{ url: string; kind: "image" | "pdf" } | null>(null);
  const [busy, setBusy] = useState<"preview" | "download" | null>(null);
  const sizeLabel = (() => {
    const n = att.size;
    if (!n && n !== 0) return "";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  })();

  // Fetch the file bytes and either preview (in-app modal) or download.
  // Both paths use a Blob + object-URL so the bearer-token stays out of
  // the URL. Preview renders in our own dialog — for images an <img>,
  // for PDFs an <iframe> — never `window.open` (which some browsers /
  // pop-up blockers turn into a silent download).
  async function open(mode: "preview" | "download", ev?: React.MouseEvent) {
    // Stop the click from bubbling into the parent chip's own handler
    // — otherwise the Preview button click also fired the chip click,
    // running open() twice (once as "preview", once as fallback).
    if (ev) { ev.preventDefault(); ev.stopPropagation(); }
    if (typeof att.docId !== "number" || busy) return;
    setBusy(mode);
    try {
      const blob = await api.documentFile(att.docId, { inline: mode === "preview" });
      const url = URL.createObjectURL(blob);
      if (mode === "download") {
        const a = document.createElement("a");
        a.href = url;
        a.download = att.filename || "download";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        return;
      }
      // preview mode
      if (isImage) {
        setPreview({ url, kind: "image" });
      } else if (isPdf) {
        setPreview({ url, kind: "pdf" });
      } else {
        // Nothing sensible to render inline — download instead.
        const a = document.createElement("a");
        a.href = url; a.download = att.filename || "download";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      }
    } catch (e) {
      toast.error(
        `Couldn't ${mode === "preview" ? "preview" : "download"} the file — ${(e as Error).message || "please retry"}.`,
      );
    } finally {
      setBusy(null);
    }
  }

  function closePreview() {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
  }

  return (
    <>
      <div
        className="group relative flex items-center gap-2 rounded-lg bg-white/95 ring-1 ring-primary/20 shadow-sm pl-1.5 pr-1.5 py-1.5 max-w-[280px]"
        title={att.filename}
      >
        <button
          type="button"
          onClick={(e) => open(canInline ? "preview" : "download", e)}
          disabled={typeof att.docId !== "number"}
          className="flex items-center gap-2 min-w-0 flex-1 rounded-md hover:bg-primary/5 pr-1.5 pl-0.5 py-0.5 text-left disabled:cursor-not-allowed"
          title={canInline ? "Click to preview" : "Click to download"}
        >
          {att.previewDataUrl && isImage ? (
            <img
              src={att.previewDataUrl}
              alt={att.filename}
              className="size-9 rounded-md object-cover bg-slate-100 shrink-0"
            />
          ) : (
            <div className="size-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
              {isImage ? (
                <ImageIcon className="size-4 text-primary" />
              ) : (
                <FileText className="size-4 text-primary" />
              )}
            </div>
          )}
          <div className="min-w-0">
            <div className="text-[12.5px] font-medium text-slate-800 truncate leading-tight">
              {att.filename}
            </div>
            {sizeLabel && (
              <div className="text-[11px] text-slate-500 leading-tight">{sizeLabel}</div>
            )}
          </div>
        </button>
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          {canInline && (
            <button
              type="button"
              onClick={(e) => open("preview", e)}
              disabled={typeof att.docId !== "number" || !!busy}
              aria-label="Preview"
              title="Preview"
              className="p-1.5 rounded-md text-slate-500 hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
            >
              {busy === "preview"
                ? <Loader2 className="size-3.5 animate-spin" />
                : <Eye className="size-3.5" />}
            </button>
          )}
          <button
            type="button"
            onClick={(e) => open("download", e)}
            disabled={typeof att.docId !== "number" || !!busy}
            aria-label="Download"
            title="Download"
            className="p-1.5 rounded-md text-slate-500 hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
          >
            {busy === "download"
              ? <Loader2 className="size-3.5 animate-spin" />
              : <Download className="size-3.5" />}
          </button>
        </div>
      </div>
      {preview && (
        <FilePreviewModal
          url={preview.url}
          kind={preview.kind}
          filename={att.filename}
          docId={att.docId}
          onClose={closePreview}
        />
      )}
    </>
  );
}

/** In-app preview dialog. Renders images with <img> and PDFs with
 *  <iframe> so the user never leaves the app. Esc / backdrop-click /
 *  close-button all dismiss. Includes a Download button in the header
 *  because you can't right-click-save an <iframe> reliably. */
function FilePreviewModal({
  url, kind, filename, docId, onClose,
}: {
  url: string;
  kind: "image" | "pdf";
  filename: string;
  docId?: number;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  async function saveAs() {
    // The blob URL we already have works for direct save — no need for
    // a second network round-trip.
    const a = document.createElement("a");
    a.href = url; a.download = filename || `document.${kind === "pdf" ? "pdf" : "png"}`;
    document.body.appendChild(a); a.click(); a.remove();
    if (typeof docId !== "number") return;
  }

  const isImage = kind === "image";
  // Portal into <body> so we escape any ancestor with `transform` /
  // `filter` / `backdrop-filter` (e.g. the chat message's
  // `animate-fade-up`), which would otherwise become the containing
  // block for our `position: fixed` root and force the modal to render
  // inline inside the chat bubble instead of covering the viewport.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${filename}`}
      onMouseDown={(e) => {
        // Close only when the backdrop itself (not the inner card) is clicked.
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 animate-fade-up"
    >
      {/* Framed inner card so PDFs get a real container instead of
          floating in the void — matches the rest of the app's chrome. */}
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className={cn(
          "relative bg-white rounded-2xl shadow-2xl ring-1 ring-slate-200 flex flex-col overflow-hidden",
          isImage
            ? "max-w-[92vw] max-h-[92vh]"
            : "w-[92vw] h-[92vh] max-w-6xl",
        )}
      >
        {/* Header: filename + Download + Close */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-200 bg-slate-50/80">
          <div className="size-7 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
            {isImage ? <ImageIcon className="size-4" /> : <FileText className="size-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-slate-800 truncate">{filename}</div>
            <div className="text-[11px] text-slate-500">{isImage ? "Image preview" : "Document preview"}</div>
          </div>
          <button
            type="button"
            onClick={saveAs}
            className="inline-flex items-center gap-1 text-[12.5px] font-medium text-slate-700 hover:text-primary hover:bg-primary/10 rounded-md px-2.5 py-1.5 transition-colors"
            title="Download"
          >
            <Download className="size-3.5" /> Download
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="size-8 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-200 flex items-center justify-center transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>
        {/* Body: <img> for images (bounded by card), <iframe> for PDFs */}
        <div className="flex-1 min-h-0 bg-slate-100 flex items-center justify-center overflow-auto">
          {isImage ? (
            <img
              src={url}
              alt={filename}
              className="max-w-full max-h-[85vh] object-contain"
            />
          ) : (
            <iframe
              src={url}
              title={filename}
              className="w-full h-full min-h-[70vh] bg-white"
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Message({
  msg,
  question,
  live,
  liveStatus,
  speaking,
  onToggleSpeak,
  onRegenerate,
  onEdit,
  onClarify,
  isLast,
}: {
  msg: ChatMessage;
  question?: string;
  live?: boolean;
  liveStatus?: string | null;
  speaking?: boolean;
  onToggleSpeak?: (text: string) => void;
  onRegenerate?: () => void;
  onEdit?: (content: string) => void;
  onClarify?: (text: string) => void;
  isLast?: boolean;
}) {
  // On-demand translation of THIS answer (null = original English).
  const [xlate, setXlate] = useState<{ lang: string; text: string } | null>(null);
  const [xbusy, setXbusy] = useState(false);

  if (msg.role === "user") {
    return (
      <UserMessage
        content={msg.content}
        attachments={msg.attachments}
        onEdit={onEdit}
      />
    );
  }

  // Extras (citations, source chips, feedback) only once the turn has settled.
  const settled = !live;
  const shownText = xlate?.text ?? msg.content;
  // Clarify can arrive in three shapes:
  //   1. `{ question, options }`                                     — single
  //   2. `{ questions: [{ question, options }, ...] }`               — multi
  //   3. `{ question, options }` with `options` embedded per question
  // We normalise into a plain array of `{question, options}` so the panel
  // can render a carousel uniformly.
  type ClarifyShape = {
    question?: string;
    options?: string[];
    questions?: { question: string; options: string[] }[];
  };
  const rawClarify = (msg.meta as { clarify?: ClarifyShape } | undefined)?.clarify;
  // The question can live in one of three places (in order of preference):
  //   1. `meta.clarify.questions[i].question`
  //   2. `meta.clarify.question`
  //   3. `msg.content` — some tools only fill `options` and put the prompt
  //      in the message body. When we suppress the message bubble we still
  //      need to show that text as the bold question above the choices.
  //   4. Ultimate fallback — a generic prompt so we never render an
  //      unlabelled option list.
  const fallbackQuestion =
    (shownText || "").trim() ||
    "Which of these would you like me to help with?";
  const clarifyQuestions: { question: string; options: string[] }[] =
    rawClarify?.questions?.length
      ? rawClarify.questions.map((q) => ({
          question: (q.question || "").trim() || fallbackQuestion,
          options: q.options ?? [],
        }))
      : (rawClarify?.options?.length
          ? [{
              question: (rawClarify.question || "").trim() || fallbackQuestion,
              options: rawClarify.options,
            }]
          : []);
  const hasClarify = clarifyQuestions.length > 0;

  async function translateTo(lang: string) {
    if (!lang || lang === "English") {
      setXlate(null);
      return;
    }
    setXbusy(true);
    try {
      const text = await api.translate(msg.content, lang);
      setXlate({ lang, text });
    } catch {
      toast.error(`Couldn't translate to ${lang}`);
    } finally {
      setXbusy(false);
    }
  }

  // A "refusal" is a genuinely short reply that reads like the model
  // declined — think "I don't have enough information to answer that."
  // A grounded=false response with a full draft in it is NOT a refusal;
  // the RAG layer flags web-sourced content as ungrounded even when the
  // content itself is a useful answer. Only paint the amber warning card
  // for actual refusals.
  const looksLikeRefusal = (() => {
    const t = (shownText || "").trim();
    if (!t) return false;
    if (t.length > 400) return false;
    const refusalHints = [
      "don't have", "do not have", "cannot", "can not", "unable",
      "insufficient", "not enough", "cannot answer", "cant answer",
      "no relevant", "sorry", "not able",
    ];
    const low = t.toLowerCase();
    return refusalHints.some((h) => low.includes(h));
  })();
  const isRefusal = msg.grounded === false && looksLikeRefusal;
  // Note: some answers come from live web-search; when grounded=false but the
  // reply is substantive we still render it as a normal message and add a
  // discreet "Web-sourced" chip so the officer knows it wasn't corpus-cited.
  const isWebSourced = msg.grounded === false && !isRefusal;

  return (
    <div className="flex gap-3 animate-fade-up">
      <AssistantAvatar pulse={!!live} />
      <div className="min-w-0 flex-1 space-y-3">
        {isRefusal ? (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 flex gap-3 text-amber-900">
            <AlertTriangle className="size-5 shrink-0 mt-0.5" />
            <p className="text-sm leading-relaxed">{msg.content}</p>
          </div>
        ) : live ? (
          msg.content ? (
            // Tokens are arriving — render what we have so far, growing live.
            <div className="rounded-2xl bg-white border border-slate-200 px-5 py-4 shadow-sm">
              <Markdown text={msg.content} />
            </div>
          ) : (
            // Tool phase, before the first token: show the real status.
            <div className="rounded-2xl bg-white border border-slate-200 px-4 py-3 shadow-sm min-w-[260px]">
              <div className="flex items-center gap-1.5">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="ml-2 text-[12.5px] font-medium text-slate-600">
                  {(liveStatus || "Thinking").replace(/…$/, "")}…
                </span>
              </div>
            </div>
          )
        ) : hasClarify && isLast && onClarify ? (
          // The latest clarify turn: the question(s) render inside the
          // interactive ClarifyPanel below, so no plain-text bubble here.
          null
        ) : hasClarify ? (
          // A clarify from a PAST turn — no options anymore (the user has
          // already answered), but we still show the question(s) so the
          // conversation history reads naturally instead of leaving a
          // blank space next to the assistant avatar.
          <div className="rounded-2xl bg-white border border-slate-200 px-5 py-4 shadow-sm space-y-2">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              Clarification asked
            </div>
            {clarifyQuestions.map((q, i) => (
              <p key={i} className="text-[14px] text-slate-800 leading-snug">
                {clarifyQuestions.length > 1 && (
                  <span className="text-slate-400 mr-1.5 tabular-nums">{i + 1}.</span>
                )}
                {q.question}
              </p>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl bg-white border border-slate-200 px-5 py-4 shadow-sm">
            {isWebSourced && (
              <div className="mb-2 -mt-1 inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary text-[10.5px] font-semibold tracking-wide px-2 py-0.5">
                <Globe className="size-3" /> Web-sourced · verify before relying
              </div>
            )}
            <Markdown text={shownText} />
            {xlate && (
              <div className="mt-2 pt-2 border-t border-slate-100 flex items-center gap-2 text-[11.5px] text-slate-400">
                <Languages className="size-3.5" /> Translated to {xlate.lang}
                <button onClick={() => setXlate(null)} className="text-primary hover:underline">Show original</button>
              </div>
            )}
          </div>
        )}

        {settled && isLast && onClarify && hasClarify ? (
          <ClarifyPanel questions={clarifyQuestions} onPick={onClarify} />
        ) : null}

        {msg.citations && msg.citations.length > 0 && settled && (
          <div>
            <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-slate-600">
              <BookOpen className="size-3.5 text-primary" />
              Sources ({msg.citations.length})
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              {msg.citations.map((c) => (
                <div
                  key={c.n}
                  className="rounded-lg bg-white border border-slate-200 px-3 py-2 hover:border-primary/40 transition-colors"
                >
                  <div className="flex items-start gap-2">
                    <span className="inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded-full bg-primary/10 text-primary text-[0.72rem] font-semibold">
                      {c.n}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium leading-snug truncate">
                        {c.breadcrumb}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                        {c.section_number && (
                          <span className="font-mono">§ {c.section_number}</span>
                        )}
                        {c.source_url && (
                          <a
                            href={c.source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary hover:underline inline-flex items-center gap-0.5"
                          >
                            source <ArrowUpRight className="size-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {settled &&
          Array.isArray(msg.meta?.["web_sources"]) &&
          (msg.meta["web_sources"] as unknown[]).length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-slate-400 mr-0.5">Sources</span>
              {(msg.meta["web_sources"] as { title?: string; url?: string }[])
                .slice(0, 8)
                .map((src, i) => {
                  const domain = (src.title || "")
                    .replace(/^https?:\/\//, "")
                    .replace(/\/.*$/, "")
                    .trim();
                  if (!domain) return null;
                  return (
                    <a
                      key={i}
                      href={src.url || `https://${domain}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={domain}
                      className="inline-flex items-center gap-1 rounded-full bg-slate-100 hover:bg-slate-200 px-2 py-0.5 text-[11px] text-slate-600 transition-colors"
                    >
                      {/* Local icon instead of Google's favicon service — a
                          self-hosted product must not leak visited source
                          domains to a third party. */}
                      <Globe className="size-3.5 text-slate-400 shrink-0" />
                      <span className="max-w-[150px] truncate">{domain}</span>
                    </a>
                  );
                })}
            </div>
          )}
        {settled && Array.isArray(msg.meta?.["memory_added"]) &&
          (msg.meta["memory_added"] as unknown[]).length > 0 && (
            <MemoryCue items={msg.meta["memory_added"] as { id: number; content: string }[]} />
          )}
        {settled && !hasClarify && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5">
            <MessageActions
              text={shownText}
              speaking={speaking}
              onToggleSpeak={onToggleSpeak ? () => onToggleSpeak(shownText) : undefined}
              onRegenerate={onRegenerate}
            />
            <LanguageMenu current={xlate?.lang ?? "English"} busy={xbusy} onPick={translateTo} />
            {/* Feedback + rating on every real answer, including web-sourced
                ones. Only genuine refusals hide it because there's nothing
                to rate there. */}
            {!isRefusal && (
              <>
                <span className="hidden sm:block w-px h-4 bg-slate-200 mx-0.5" />
                <FeedbackRow question={question} answer={msg.content} />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// One-tap actions under an answer: copy, read aloud, regenerate.
function MessageActions({
  text,
  speaking,
  onToggleSpeak,
  onRegenerate,
}: {
  text: string;
  speaking?: boolean;
  onToggleSpeak?: () => void;
  onRegenerate?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  function copy() {
    // Rich clipboard: styled HTML for Word/Docs/Notion/Gmail (headings,
    // bullets, tables, code blocks all preserved) + a clean plain-text
    // fallback with markdown syntax stripped for terminal/plain paste
    // targets. Beats a raw `## foo` / `**bar**` dump every time.
    copyMarkdownRich(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  const btn =
    "inline-flex items-center justify-center size-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors";
  return (
    <div className="flex items-center gap-0.5">
      <button onClick={copy} className={btn} title="Copy" aria-label="Copy answer">
        {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
      </button>
      {ttsSupported() && onToggleSpeak && (
        <button
          onClick={onToggleSpeak}
          className={cn(btn, speaking && "text-primary bg-primary/10 hover:text-primary")}
          title={speaking ? "Stop" : "Read aloud"}
          aria-label={speaking ? "Stop reading" : "Read aloud"}
        >
          {speaking ? <Square className="size-3.5" /> : <Volume2 className="size-4" />}
        </button>
      )}
      {onRegenerate && (
        <button onClick={onRegenerate} className={btn} title="Regenerate" aria-label="Regenerate answer">
          <RotateCcw className="size-4" />
        </button>
      )}
    </div>
  );
}

// The 22 scheduled languages of India + English. On-demand translation of the
// displayed answer (Gemini); read-aloud then reads whatever is shown.
const LANGUAGES = [
  "English", "Hindi", "Bengali", "Marathi", "Telugu", "Tamil", "Gujarati",
  "Urdu", "Kannada", "Odia", "Malayalam", "Punjabi", "Assamese", "Maithili",
  "Santali", "Kashmiri", "Nepali", "Konkani", "Sindhi", "Dogri", "Manipuri",
  "Bodo", "Sanskrit",
];

function LanguageMenu({ current, busy, onPick }: {
  current: string;
  busy?: boolean;
  onPick: (lang: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const translated = current !== "English";
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        title="Translate this answer"
        className={cn(
          "inline-flex items-center gap-1 h-8 px-2 rounded-lg text-[12px] transition-colors disabled:opacity-60",
          translated ? "text-primary bg-primary/10" : "text-slate-400 hover:text-slate-700 hover:bg-slate-100",
        )}
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Languages className="size-3.5" />}
        <span className="hidden sm:inline">{translated ? current : "Translate"}</span>
      </button>
      {open && (
        <div className="absolute left-0 bottom-9 z-20 w-40 max-h-64 overflow-y-auto chat-scrollbar rounded-lg bg-white ring-1 ring-slate-200 shadow-lg py-1 animate-fade-up">
          {LANGUAGES.map((l) => (
            <button
              key={l}
              onClick={() => { setOpen(false); onPick(l); }}
              className={cn(
                "w-full flex items-center justify-between px-3 py-1.5 text-[13px] text-left hover:bg-slate-100",
                l === current ? "text-primary font-medium" : "text-slate-700",
              )}
            >
              {l}
              {l === current && <Check className="size-3.5" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MemoryCue({ items }: { items: { id: number; content: string }[] }) {
  const [undone, setUndone] = useState<Record<number, boolean>>({});
  const live = items.filter((i) => !undone[i.id]);
  if (live.length === 0)
    return <div className="mt-2 text-[11.5px] text-slate-400">Memory update undone.</div>;
  async function undo(id: number) {
    setUndone((u) => ({ ...u, [id]: true }));
    try {
      await api.deleteMemory(id);
    } catch {
      /* best-effort */
    }
  }
  return (
    <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-primary/[0.07] text-primary px-3 py-1 text-[11.5px] font-medium">
      <Brain className="size-3.5" />
      Memory updated
      {live.length === 1 && (
        <button type="button" onClick={() => undo(live[0].id)} className="text-slate-500 hover:text-rose-600 underline underline-offset-2">
          Undo
        </button>
      )}
    </div>
  );
}


function FeedbackRow({ question, answer }: { question?: string; answer: string }) {
  const { session } = useAuth();
  const [sent, setSent] = useState<"up" | "down" | null>(null);
  const [stars, setStars] = useState(0);
  async function send(rating: "up" | "down") {
    setSent(rating);
    try {
      await api.feedback({ question, answer, rating });
    } catch {
      /* feedback is best-effort */
    }
  }
  async function rate(n: number) {
    setStars(n);
    try {
      await api.rate({ target_type: "chat", question, answer, stars: n });
    } catch {
      /* best-effort */
    }
  }
  const raw = session?.username || "";
  const name = raw ? raw[0].toUpperCase() + raw.slice(1) : "";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-400">
      {sent ? (
        <span className="text-[11px]">
          {name ? `Thanks ${name} — your feedback helps improve answers.` : "Thanks — your feedback helps improve answers."}
        </span>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-[11px]">Was this helpful?</span>
          <button onClick={() => send("up")} className="hover:text-emerald-600 transition-colors" title="Helpful">
            <ThumbsUp className="size-4" />
          </button>
          <button onClick={() => send("down")} className="hover:text-rose-600 transition-colors" title="Not helpful">
            <ThumbsDown className="size-4" />
          </button>
        </div>
      )}
      <div className="flex items-center gap-1">
        <span className="text-[11px]">Rate:</span>
        <StarRating value={stars} onRate={rate} size={15} disabled={stars > 0} />
        {stars > 0 ? <span className="text-[11px] text-amber-500">{stars}/5</span> : null}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- AssistantAvatar
function AssistantAvatar({ pulse }: { pulse?: boolean }) {
  return (
    <div
      className={
        "size-8 shrink-0 rounded-lg bg-white ring-1 ring-slate-200 flex items-center justify-center overflow-hidden" +
        (pulse ? " avatar-pulse" : "")
      }
    >
      <img src="/favicon.png" alt="BharatTax" className="size-6 object-contain" draggable={false} />
    </div>
  );
}

// Keep User2 referenced for downstream stories that may want a user avatar.
void User2;
