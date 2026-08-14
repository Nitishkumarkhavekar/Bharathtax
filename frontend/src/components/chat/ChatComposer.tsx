import {
  ChangeEvent,
  ClipboardEvent,
  DragEvent,
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowUp,
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Plus,
  Sparkles,
  Square,
  Upload,
  X,
} from "lucide-react";
import { ImprovePrompt } from "@/components/ImprovePrompt";
import { cn } from "@/lib/utils";
import { api, DocumentOut } from "@/api";
import { toast } from "@/lib/toast";

const MODULES = [
  { value: "", label: "All modules" },
  { value: "income_tax", label: "Income Tax" },
  { value: "gst", label: "GST (soon)" },
  { value: "customs", label: "Customs (soon)" },
];
const STYLES = [
  { value: "explanatory", label: "Explanatory" },
  { value: "concise", label: "Concise" },
];

// Max 5 attachments per turn, 25 MB per file — backend allows 30 MB but
// frontend caps at 25 MB to leave headroom for multipart boundary + JSON
// meta. Users can upload up to 5 large (Kannada scanned) deeds in a
// single turn and get a consolidated analysis.
const MAX_FILES_PER_TURN = 5;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Info the composer passes upstream about each attached file, so the
 *  parent can render a chip in the user's message bubble AFTER submit. */
export interface ComposerAttachment {
  docId: number;
  filename: string;
  contentType?: string;
  size?: number;
  /** data:image/…;base64,… — only set for image types small enough to
   *  serialise (~256 KB). Larger images just show the file glyph. */
  previewDataUrl?: string;
}

interface ChatComposerProps {
  value: string;
  onChange: (v: string) => void;
  /** Called when the user hits send. Receives full metadata for each
   * successfully-uploaded attachment (may be empty). Ask.tsx forwards
   * the docIds to /ask + /ask/stream, and stores the rest on the user
   * message so the chip renders in the bubble. */
  onSubmit: (attachments: ComposerAttachment[]) => void;
  busy: boolean;
  module: string;
  onModuleChange: (v: string) => void;
  style: string;
  onStyleChange: (v: string) => void;
  onStop?: () => void; // abort the in-flight generation
  compact?: boolean; // bottom-docked mode
}

// One row in the attachment preview strip. Tracks lifecycle: uploading →
// ready (docId set) OR error. `previewUrl` is set for image types so we
// can render a thumbnail; PDFs / .docx get the generic file glyph.
interface Attachment {
  clientId: string;
  file: File;
  previewUrl: string | null;
  // Lifecycle: uploading → ready.
  // "Ready" means the file has been received by the server and has a
  // doc id. OCR / chunking / embedding continue on a background thread
  // server-side; we intentionally do NOT block the user on that here —
  // by the time they've typed and hit Send, indexing is usually done,
  // and if it isn't, the /ask endpoint waits for it before answering.
  status: "uploading" | "ready" | "error";
  docId?: number;
  error?: string;
}

function newAttachment(file: File): Attachment {
  const isImage = file.type.startsWith("image/");
  return {
    clientId: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    file,
    previewUrl: isImage ? URL.createObjectURL(file) : null,
    status: "uploading",
  };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function ChatComposer({
  value,
  onChange,
  onSubmit,
  busy,
  module,
  onModuleChange,
  style,
  onStyleChange,
  onStop,
  compact,
}: ChatComposerProps) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const menuRootRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragOver, setDragOver] = useState(false);

  // auto-grow
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, compact ? 200 : 260) + "px";
  }, [value, compact]);

  // Keep the cursor ready in the box: focus on mount and every time we return
  // to idle after an answer (the textarea is disabled while busy, which drops
  // focus). So the officer can just start typing the next question — no click.
  useEffect(() => {
    if (!busy) taRef.current?.focus();
  }, [busy]);

  // Close the + menu on any outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRootRef.current && !menuRootRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  // Revoke object URLs for image previews when the component unmounts so
  // we don't leak blob handles into the browser's URL registry.
  useEffect(() => {
    return () => {
      for (const a of attachments) {
        if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      }
    };
    // Only on unmount — intentionally empty deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Upload one file and mark it ready as soon as the server has taken
  // custody. OCR / chunking / embedding continue on a background thread
  // server-side (kicked off by the upload endpoint); we do NOT poll for
  // that here because it would gate the user on 30-180 s of extraction
  // work they haven't asked for yet. The wait, if there is one, happens
  // during Send — ask.py's _build_attached_context polls chunks for up
  // to 45 s before answering. That way upload feels instant and by the
  // time the user has typed a prompt, indexing is usually already done.
  const uploadOne = useCallback(async (a: Attachment) => {
    try {
      const doc: DocumentOut = await api.uploadDocument(a.file);
      setAttachments((prev) =>
        prev.map((x) =>
          x.clientId === a.clientId ? { ...x, status: "ready", docId: doc.id } : x,
        ),
      );
    } catch (e) {
      const msg = (e as Error)?.message || "Upload failed";
      setAttachments((prev) =>
        prev.map((x) => (x.clientId === a.clientId ? { ...x, status: "error", error: msg } : x)),
      );
      toast.error(`Couldn't upload ${a.file.name}: ${msg}`);
    }
  }, []);

  const addFiles = useCallback(
    (files: File[]) => {
      if (!files.length) return;
      setAttachments((prev) => {
        const room = MAX_FILES_PER_TURN - prev.length;
        if (room <= 0) {
          toast.info(`You can attach up to ${MAX_FILES_PER_TURN} files per message.`);
          return prev;
        }
        const accepted: Attachment[] = [];
        let dropped = 0;
        for (const f of files.slice(0, room)) {
          if (f.size > MAX_FILE_BYTES) {
            toast.error(`${f.name} is over 20 MB — skipped.`);
            dropped++;
            continue;
          }
          accepted.push(newAttachment(f));
        }
        if (files.length > room + dropped) {
          toast.info(`Only the first ${room} file(s) were attached (limit is ${MAX_FILES_PER_TURN}).`);
        }
        // Kick off the upload for each newly-accepted attachment. Fires
        // after render because uploadOne calls setAttachments internally.
        setTimeout(() => {
          for (const a of accepted) void uploadOne(a);
        }, 0);
        return [...prev, ...accepted];
      });
    },
    [uploadOne],
  );

  function removeAttachment(clientId: string) {
    setAttachments((prev) => {
      const gone = prev.find((a) => a.clientId === clientId);
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      return prev.filter((a) => a.clientId !== clientId);
    });
  }

  function onFilePicked(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    // Reset the input so choosing the same file twice re-triggers the picker.
    e.target.value = "";
    addFiles(files);
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) {
      // Consume the paste — text alongside is still allowed, so only
      // preventDefault when we captured a file.
      e.preventDefault();
      addFiles(files);
    }
  }

  function onDrop(e: DragEvent<HTMLFormElement>) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length) addFiles(files);
  }

  function handleSubmit(e?: FormEvent) {
    e?.preventDefault();
    // Only block if the file itself hasn't finished uploading yet — we
    // need the docId to send. Server-side OCR/indexing continues in the
    // background; the /ask endpoint waits for chunks (up to 45 s) so we
    // don't need to gate the user here.
    if (attachments.some((a) => a.status === "uploading")) {
      toast.info("Please wait for the file(s) to finish uploading.");
      return;
    }
    if ((!value.trim() && attachments.length === 0) || busy) return;
    const ready = attachments.filter(
      (a) => a.status === "ready" && typeof a.docId === "number",
    );

    // Serialise each ready attachment for the parent. For image files we
    // ALWAYS produce a small preview by downscaling to a 160-px thumbnail
    // on a canvas (JPEG q=0.8). Result is ~5-25 KB per thumbnail — small
    // enough for localStorage even at the 5-file limit, and rich enough
    // that the chip shows the real image. Non-image files get the
    // file-glyph fallback.
    const buildThumbnailDataUrl = (file: File) =>
      new Promise<string | undefined>((resolve) => {
        if (!file.type.startsWith("image/")) return resolve(undefined);
        // Give up on anything the browser can't decode as an image (SVG
        // works, HEIC often doesn't on Windows Chrome, etc.). If we hit
        // an error we resolve undefined and the chip shows the glyph.
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          try {
            const MAX = 160;
            const scale = Math.min(1, MAX / Math.max(img.width, img.height));
            const w = Math.max(1, Math.round(img.width * scale));
            const h = Math.max(1, Math.round(img.height * scale));
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d");
            if (!ctx) return resolve(undefined);
            ctx.drawImage(img, 0, 0, w, h);
            // JPEG stays small; PNGs of typical screenshots become 1/10th
            // the size. Fallback to PNG only for transparent inputs — we
            // don't detect that, so we accept the tiny quality loss.
            const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
            resolve(dataUrl);
          } catch {
            resolve(undefined);
          } finally {
            URL.revokeObjectURL(url);
          }
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          resolve(undefined);
        };
        img.src = url;
      });

    // Fire the submit as soon as data URLs are ready — cheap for small
    // images, and we've already blocked the "still uploading" case above.
    Promise.all(
      ready.map(async (a) => ({
        docId: a.docId as number,
        filename: a.file.name,
        contentType: a.file.type || undefined,
        size: a.file.size,
        previewDataUrl: await buildThumbnailDataUrl(a.file),
      })),
    ).then((payload) => {
      onSubmit(payload);
    });

    // Clear the attachment strip so it doesn't carry into the next turn.
    // The uploaded documents remain available in the user's corpus — the
    // agent can still retrieve them via search_my_documents on any later
    // turn where they're relevant.
    for (const a of attachments) {
      if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    }
    setAttachments([]);
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  const anyUploading = attachments.some((a) => a.status === "uploading");
  // Send is enabled whenever there's content to send AND no upload is
  // still in flight. During `busy` we still allow Send — the parent's
  // send() will detect the busy state and queue the prompt instead of
  // firing immediately.
  const hasContent = value.trim().length > 0 || attachments.length > 0;
  const canSend = !anyUploading && hasContent;

  return (
    <form
      onSubmit={handleSubmit}
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes("Files")) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={cn(
        "composer-shell w-full relative",
        compact ? "px-3 py-2.5" : "px-4 py-3.5",
        dragOver && "ring-2 ring-primary/60 ring-offset-2 ring-offset-transparent",
      )}
    >
      {dragOver && (
        <div className="absolute inset-0 rounded-2xl bg-primary/5 border-2 border-dashed border-primary/40 flex items-center justify-center pointer-events-none z-10">
          <div className="flex items-center gap-2 text-primary text-sm font-medium">
            <Upload className="size-4" /> Drop to attach
          </div>
        </div>
      )}

      {/* Attachment preview strip — appears above the textarea when files are
          attached. Small cards with a thumbnail (image) or file glyph, name,
          size, upload spinner or ready check, and a remove (X) button. */}
      {attachments.length > 0 && (
        <div className="mb-2.5 flex flex-wrap gap-2">
          {attachments.map((a) => (
            <div
              key={a.clientId}
              className={cn(
                "group relative flex items-center gap-2 rounded-lg border bg-white pl-1.5 pr-2 py-1.5 shadow-sm max-w-[240px]",
                a.status === "error" ? "border-rose-300" : "border-slate-200",
              )}
              title={a.file.name}
            >
              {a.previewUrl ? (
                <img
                  src={a.previewUrl}
                  alt={a.file.name}
                  className="size-9 rounded-md object-cover bg-slate-100 shrink-0"
                />
              ) : (
                <div className="size-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                  {a.file.type.startsWith("image/") ? (
                    <ImageIcon className="size-4 text-primary" />
                  ) : (
                    <FileText className="size-4 text-primary" />
                  )}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-medium text-slate-800 truncate leading-tight">
                  {a.file.name}
                </div>
                <div className="text-[11px] text-slate-500 flex items-center gap-1">
                  {a.status === "uploading" && (
                    <>
                      <Loader2 className="size-3 animate-spin" /> Uploading…
                    </>
                  )}
                  {a.status === "ready" && (
                    <span>{formatBytes(a.file.size)}</span>
                  )}
                  {a.status === "error" && (
                    <span className="text-rose-600">Failed · click × to remove</span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => removeAttachment(a.clientId)}
                aria-label={`Remove ${a.file.name}`}
                className="shrink-0 p-1 rounded hover:bg-slate-100 text-slate-500 hover:text-rose-600 transition-colors"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKey}
        onPaste={onPaste}
        placeholder={
          busy
            ? "Type a follow-up — it'll queue and send when the current answer finishes."
            : "Ask a tax-law question — e.g. when is an addition under s.68 sustainable?"
        }
        rows={1}
        // Intentionally NOT disabled during busy — users can type,
        // paste, attach, and hit Enter to queue a follow-up prompt
        // that fires the moment the current generation completes.
        className={cn(
          "block w-full resize-none border-0 bg-transparent focus:outline-none placeholder:text-slate-400",
          compact ? "text-[14.5px] leading-6 min-h-[28px]" : "text-[15px] leading-7 min-h-[36px]",
        )}
      />

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {/* Attach button (+) with popover menu — clicking opens options,
            clicking "Upload from computer" triggers the native file picker. */}
        <div ref={menuRootRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Attach files"
            title="Attach files"
            className={cn(
              "inline-flex items-center justify-center size-8 rounded-full border transition-all",
              menuOpen
                ? "border-primary bg-primary text-white shadow-sm"
                : "border-slate-200 bg-white text-slate-600 hover:border-primary/40 hover:text-primary hover:bg-primary/[0.06]",
            )}
          >
            <Plus className={cn("size-4 transition-transform", menuOpen && "rotate-45")} />
          </button>
          {menuOpen && (
            <div className="absolute left-0 bottom-11 z-30 w-56 rounded-xl bg-white ring-1 ring-slate-200 shadow-lg p-1.5 animate-fade-up">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  fileInputRef.current?.click();
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-slate-800 hover:bg-primary/10 hover:text-primary text-left transition-colors"
              >
                <span className="size-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                  <Upload className="size-4" />
                </span>
                <span className="flex-1">
                  <span className="block font-medium">Upload from computer</span>
                  <span className="block text-[11px] text-slate-500">
                    PDF, DOCX, images · up to 20 MB
                  </span>
                </span>
              </button>
              <div className="mt-1 border-t border-slate-100 pt-1 px-2.5 py-1.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                <Paperclip className="size-3" /> Tip: paste (Ctrl+V) or drag &amp; drop also works.
              </div>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.doc,.docx,.txt,.csv,.xlsx,.xls"
            onChange={onFilePicked}
            className="hidden"
          />
        </div>

        <ImprovePrompt value={value} onChange={onChange} context="ask" disabled={busy} />
        <select
          className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary/30"
          value={module}
          onChange={(e) => onModuleChange(e.target.value)}
          disabled={busy}
        >
          {MODULES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <select
          className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary/30"
          value={style}
          onChange={(e) => onStyleChange(e.target.value)}
          disabled={busy}
        >
          {STYLES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-2">
          {!compact && (
            <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-slate-400">
              <Sparkles className="size-3" /> citation-grounded
            </span>
          )}
          {/* While busy we show the Stop button. If the user has typed a
              follow-up (hasContent) we ALSO show a queue-send button
              alongside it, so they can line up the next turn without
              interrupting the current one. */}
          {busy && onStop && (
            <button
              type="button"
              onClick={onStop}
              className="inline-flex items-center justify-center rounded-full size-9 bg-slate-900 text-white shadow-sm hover:bg-slate-800 active:scale-95 transition-all"
              aria-label="Stop generating"
              title="Stop generating"
            >
              <Square className="size-3.5 fill-current" />
            </button>
          )}
          <button
            type="submit"
            disabled={!canSend}
            className={cn(
              "inline-flex items-center justify-center rounded-full transition-all",
              "size-9 shadow-sm",
              busy
                ? "bg-primary/85 text-white hover:bg-primary"
                : "bg-primary text-white hover:bg-primary/90",
              "active:scale-95",
              "disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none disabled:cursor-not-allowed",
            )}
            aria-label={busy ? "Queue message" : "Send"}
            title={
              anyUploading
                ? "Waiting for upload…"
                : busy
                  ? "Queue this message — it'll send when the current answer finishes"
                  : "Send (Enter)"
            }
          >
            {anyUploading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ArrowUp className="size-4" />
            )}
          </button>
        </div>
      </div>
    </form>
  );
}
