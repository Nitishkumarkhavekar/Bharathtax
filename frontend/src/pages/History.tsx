import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Clock,
  Trash2,
  Eraser,
  User2,
  ChevronLeft,
  ChevronRight,
  MessageSquareText,
  Gavel,
  FileText,
  Image as ImageIcon,
  LogIn,
  Sparkles,
  ArrowUpRight,
  Eye,
  Download,
} from "lucide-react";
import { ApiError, HistoryItem, HistoryKind, HistoryCounts, api } from "../api";
import { toast } from "@/lib/toast";
import { useAuth } from "../auth";
import { Card, CardContent } from "@/components/ui/card";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { FilePreviewModal } from "@/components/FilePreviewModal";
import PageHelp from "@/components/PageHelp";

export default function History() {
  const { session } = useAuth();
  const { confirm, dialog } = useConfirm();
  const navigate = useNavigate();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [counts, setCounts] = useState<HistoryCounts | null>(null);
  const [kind, setKind] = useState<HistoryKind>("all");
  const [loading, setLoading] = useState(true);
  const [busyClear, setBusyClear] = useState(false);
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  // Tracks per-row document previews / downloads in flight so buttons
  // can show a spinner and stay disabled while the blob is fetched.
  const [docBusy, setDocBusy] = useState<Record<string, "preview" | "download" | null>>({});

  const email = useMemo(() => session?.username || "", [session]);

  async function refresh(k: HistoryKind = kind) {
    setLoading(true);
    try {
      const [rows, c] = await Promise.all([
        api.history(k, 200),
        api.historyCounts(),
      ]);
      setItems(rows);
      setCounts(c);
    } catch {
      /* transient — leave list as-is */
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh(kind);
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  async function deleteOne(id: string) {
    const ok = await confirm({
      title: "Delete this history entry?",
      description:
        "This row will be permanently removed from your activity feed. Other users' history is unaffected.",
      tone: "danger",
      confirmLabel: "Delete entry",
    });
    if (!ok) return;
    setDeleting((d) => ({ ...d, [id]: true }));
    try {
      await api.historyDelete(id);
      setItems((prev) => prev.filter((r) => r.id !== id));
      toast.success("Entry deleted");
    } catch {
      toast.error("Could not delete this row. Please try again.");
    } finally {
      setDeleting((d) => {
        const nxt = { ...d };
        delete nxt[id];
        return nxt;
      });
    }
  }

  async function clearAll() {
    const scopeLabel = kind === "all" ? "your entire history" : `all ${kind} entries`;
    const ok = await confirm({
      title: `Clear ${scopeLabel}?`,
      description:
        kind === "all"
          ? "Every entry in your activity feed — queries, appeal events, document events, sessions — will be permanently removed."
          : `Every ${kind} entry in your activity feed will be permanently removed. Other kinds are untouched.`,
      tone: "danger",
      confirmLabel: kind === "all" ? "Clear all history" : `Clear ${kind}`,
      confirmPhrase: kind === "all" ? "clear all" : undefined,
    });
    if (!ok) return;
    setBusyClear(true);
    try {
      await api.historyClear(kind);
      await refresh(kind);
      toast.success(kind === "all" ? "History cleared" : `Cleared ${kind} entries`);
    } catch {
      toast.error("Could not clear history. Please try again.");
    } finally {
      setBusyClear(false);
    }
  }

  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageStart = (safePage - 1) * pageSize;
  const paged = items.slice(pageStart, pageStart + pageSize);

  // Click-through: send the user back to where the item originated.
  // Queries → open the ORIGINAL chat thread when we resolved a chat_id;
  // fallback to a fresh /ask with the question pre-filled in the composer.
  // Appeals → the case page. Documents → previewed in-place. Sessions are
  // not clickable.
  function openItem(it: HistoryItem) {
    if (it.kind === "query") {
      if (it.chat_id != null) {
        // Ask.tsx watches sessionStorage.bt_open_chat_id and opens that
        // thread once the server-side chat list has been fetched. Setting
        // it before navigate() means the thread opens on the first render.
        try { sessionStorage.setItem("bt_open_chat_id", String(it.chat_id)); } catch { /* */ }
        navigate("/ask");
        return;
      }
      // Chat no longer exists (deleted) — best-effort: open a fresh chat
      // with the question pre-filled so the user can re-ask.
      navigate(`/ask?q=${encodeURIComponent(it.title || "")}`);
      return;
    }
    if (it.kind === "appeal" && it.resource_type === "appeal_case" && it.resource_id) {
      const rid = Number(it.resource_id);
      if (!Number.isNaN(rid)) {
        navigate(`/appeals/${rid}`);
        return;
      }
    }
    if (it.kind === "document") {
      // Default click on a document row = inline preview.
      void previewDocument(it, "preview");
      return;
    }
  }

  // Fetch the raw bytes for a document audit row and either open them in a
  // new tab (`inline`) or trigger a Save-As download. Owner-scoped: the
  // /documents/{id}/file endpoint 404s for anyone else. Non-inline-safe
  // types (docx etc) always download regardless of `mode`.
  async function previewDocument(it: HistoryItem, mode: "preview" | "download") {
    const rid = it.resource_id ? Number(it.resource_id) : NaN;
    if (Number.isNaN(rid)) {
      toast.error("This document is no longer available.");
      return;
    }
    setDocBusy((d) => ({ ...d, [it.id]: mode }));
    try {
      const blob = await api.documentFile(rid, { inline: mode === "preview" });
      const url = URL.createObjectURL(blob);
      if (mode === "preview") {
        // Fire-and-forget window.open — the browser inlines PDFs and images,
        // and falls back to Save-As for anything else automatically. We keep
        // the object URL alive for a minute so the new tab has time to load
        // before we revoke it.
        window.open(url, "_blank", "noopener,noreferrer");
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } else {
        // Force download using an anchor with a suggested filename.
        const a = document.createElement("a");
        a.href = url;
        a.download = it.detail || `document-${rid}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1_000);
      }
    } catch (e) {
      const msg = e instanceof ApiError && e.status === 404
        ? "This document is no longer available."
        : (e as Error)?.message || "Could not open the document.";
      toast.error(msg);
    } finally {
      setDocBusy((d) => ({ ...d, [it.id]: null }));
    }
  }

  return (
    <div className="space-y-5">
      {dialog}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl font-semibold flex items-center gap-2">
            <Clock className="size-5 text-primary" />
            Activity History
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Only your own activity — queries, appeal-case events, document
            events. Never shared with other users.
          </p>
          {email && (
            <div className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-slate-600 bg-slate-100 rounded-full px-2.5 py-1 ring-1 ring-slate-200">
              <User2 className="size-3.5 text-slate-500" />
              Signed in as <span className="font-medium text-slate-800">{email}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <PageHelp id="history" />
          {items.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={clearAll}
              disabled={busyClear}
              className="text-rose-700 hover:bg-rose-50 hover:text-rose-800 border-rose-200"
            >
              <Eraser className="size-4" />
              {busyClear ? "Clearing…" : kind === "all" ? "Clear my history" : `Clear ${kind}`}
            </Button>
          )}
        </div>
      </div>

      <FilterChips value={kind} onChange={setKind} counts={counts} />

      {loading && (
        <div className="rounded-2xl bg-white ring-1 ring-slate-200"><SkeletonRows rows={6} /></div>
      )}

      {items.length > 0 && (
        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <div className="tabular-nums">
            <span className="font-medium text-slate-700">{items.length}</span>{" "}
            {items.length === 1 ? "entry" : "entries"}
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="hist-page-size">Rows per page</label>
            <select
              id="hist-page-size"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="h-7 rounded-md border border-slate-200 bg-white px-1.5 tabular-nums"
            >
              {[10, 20, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {paged.map((it) => (
          <HistoryRow
            key={it.id}
            it={it}
            deleting={!!deleting[it.id]}
            docBusy={docBusy[it.id] ?? null}
            onDelete={() => deleteOne(it.id)}
            onOpen={() => openItem(it)}
            onPreviewDoc={() => previewDocument(it, "preview")}
            onDownloadDoc={() => previewDocument(it, "download")}
          />
        ))}
        {!loading && items.length === 0 && (
          <div className="rounded-2xl bg-white border border-dashed border-slate-300 p-10 text-center">
            <div className="mx-auto size-12 rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15 flex items-center justify-center mb-3">
              <Clock className="size-5" />
            </div>
            <div className="text-[14px] font-semibold text-slate-900">
              Nothing here yet
            </div>
            <div className="text-[12.5px] text-slate-500 mt-1">
              Your {kind === "all" ? "activity" : kind} will appear here as you
              use the app.
            </div>
          </div>
        )}
      </div>

      {items.length > 0 && (
        <div className="flex items-center justify-between flex-wrap gap-3 pt-2">
          <div className="text-[11px] text-slate-500 tabular-nums">
            Showing{" "}
            <span className="font-medium text-slate-700">{pageStart + 1}</span>
            –
            <span className="font-medium text-slate-700">
              {Math.min(pageStart + pageSize, items.length)}
            </span>{" "}
            of <span className="font-medium text-slate-700">{items.length}</span>
          </div>
          <div className="flex items-center gap-1">
            <PagerButton
              disabled={safePage === 1}
              onClick={() => setPage(1)}
              label="First"
            >
              «
            </PagerButton>
            <PagerButton
              disabled={safePage === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              label="Previous"
            >
              <ChevronLeft className="size-3.5" />
            </PagerButton>
            {pageWindow(safePage, pageCount).map((p, idx) =>
              p === "…" ? (
                <span
                  key={`gap-${idx}`}
                  className="px-2 text-[11px] text-slate-400 select-none"
                >
                  …
                </span>
              ) : (
                <button
                  key={p}
                  onClick={() => setPage(p as number)}
                  className={
                    "min-w-7 h-7 px-2 rounded-md text-[11px] font-medium tabular-nums transition-colors " +
                    (p === safePage
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-slate-600 hover:bg-slate-100")
                  }
                >
                  {p}
                </button>
              ),
            )}
            <PagerButton
              disabled={safePage === pageCount}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              label="Next"
            >
              <ChevronRight className="size-3.5" />
            </PagerButton>
            <PagerButton
              disabled={safePage === pageCount}
              onClick={() => setPage(pageCount)}
              label="Last"
            >
              »
            </PagerButton>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================ subcomponents

function FilterChips({
  value,
  onChange,
  counts,
}: {
  value: HistoryKind;
  onChange: (k: HistoryKind) => void;
  counts: HistoryCounts | null;
}) {
  // Documents intentionally omitted — chat-attached files are already
  // visible inside the chat message they were uploaded to (via
  // UserAttachmentChip), so a separate History surface would duplicate.
  const chips: {
    key: HistoryKind;
    label: string;
    icon: typeof MessageSquareText;
    tone: string;
  }[] = [
    { key: "all", label: "All", icon: Sparkles, tone: "primary" },
    { key: "query", label: "Queries", icon: MessageSquareText, tone: "sky" },
    { key: "appeal", label: "Appeals", icon: Gavel, tone: "amber" },
    { key: "session", label: "Sessions", icon: LogIn, tone: "emerald" },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((ch) => {
        const Icon = ch.icon;
        const active = value === ch.key;
        const n = counts?.[ch.key] ?? 0;
        return (
          <button
            key={ch.key}
            onClick={() => onChange(ch.key)}
            className={
              "inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12.5px] font-medium border transition-all " +
              (active
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "bg-white text-slate-700 border-slate-200 hover:border-primary/30 hover:text-slate-900")
            }
          >
            <Icon className="size-3.5" />
            {ch.label}
            <span
              className={
                "inline-block min-w-[20px] text-center rounded-full px-1.5 text-[10.5px] tabular-nums " +
                (active
                  ? "bg-white/25 text-white"
                  : "bg-slate-100 text-slate-600")
              }
            >
              {n}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function HistoryRow({
  it,
  deleting,
  docBusy,
  onDelete,
  onOpen,
  onPreviewDoc,
  onDownloadDoc,
}: {
  it: HistoryItem;
  deleting: boolean;
  docBusy: "preview" | "download" | null;
  onDelete: () => void;
  onOpen: () => void;
  onPreviewDoc: () => void;
  onDownloadDoc: () => void;
}) {
  const kindMeta: Record<
    string,
    { icon: typeof MessageSquareText; tone: string; label: string }
  > = {
    query: { icon: MessageSquareText, tone: "sky", label: "Query" },
    appeal: { icon: Gavel, tone: "amber", label: "Appeal" },
    document: { icon: FileText, tone: "violet", label: "Document" },
    session: { icon: LogIn, tone: "emerald", label: "Session" },
  };
  const meta = kindMeta[it.kind] ?? kindMeta.query;
  const Icon = meta.icon;
  const toneClass: Record<string, string> = {
    sky: "bg-primary/10 text-primary ring-primary/20",
    amber: "bg-brand-orange/15 text-brand-orange ring-brand-orange/20",
    violet: "bg-brand-green/15 text-brand-green ring-brand-green/20",
    emerald: "bg-primary/10 text-primary ring-primary/20",
  };

  // "Openable" rows get a full-card click handler + cursor affordance.
  // Documents ONLY open when we have a numeric resource_id (the doc may
  // have been deleted since the audit-log entry was written).
  const isDocDeleteAction = it.action === "doc.delete";
  const openable =
    (it.kind === "query" && !!it.title) ||
    (it.kind === "appeal" && it.resource_type === "appeal_case" && !!it.resource_id) ||
    (it.kind === "document" && !isDocDeleteAction && !!it.resource_id);

  return (
    <Card
      className={
        "group " +
        (openable
          ? "cursor-pointer transition-shadow hover:shadow-md hover:border-primary/30"
          : "")
      }
      onClick={openable ? onOpen : undefined}
      role={openable ? "button" : undefined}
      tabIndex={openable ? 0 : undefined}
      onKeyDown={
        openable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen();
              }
            }
          : undefined
      }
      aria-label={openable ? `Open ${meta.label.toLowerCase()}: ${it.title}` : undefined}
    >
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start gap-3">
          <div
            className={
              "size-9 rounded-lg ring-1 flex items-center justify-center shrink-0 " +
              (toneClass[meta.tone] || toneClass.sky)
            }
          >
            <Icon className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="flex items-center gap-2 min-w-0">
                <Badge variant={it.kind === "query" ? "default" : "secondary"}>
                  {meta.label}
                </Badge>
                {it.scope && (
                  <span className="text-[10.5px] text-slate-400 uppercase tracking-wider">
                    {it.scope}
                  </span>
                )}
                <span className="text-xs text-muted-foreground truncate">
                  {it.created_at ? new Date(it.created_at).toLocaleString() : "—"}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {/* Document-specific actions: preview + download. Owner-scoped
                    on the backend, so any other user gets a 404. Shown only
                    when the underlying doc row is still resolvable. */}
                {it.kind === "document" && !isDocDeleteAction && it.resource_id && (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); onPreviewDoc(); }}
                      disabled={docBusy !== null}
                      className="p-1.5 rounded-md text-slate-500 hover:bg-primary/10 hover:text-primary transition disabled:opacity-50"
                      title="Preview in a new tab"
                      aria-label="Preview document"
                    >
                      {docBusy === "preview" ? (
                        <span className="block size-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                      ) : (
                        <Eye className="size-4" />
                      )}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onDownloadDoc(); }}
                      disabled={docBusy !== null}
                      className="p-1.5 rounded-md text-slate-500 hover:bg-primary/10 hover:text-primary transition disabled:opacity-50"
                      title="Download"
                      aria-label="Download document"
                    >
                      {docBusy === "download" ? (
                        <span className="block size-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                      ) : (
                        <Download className="size-4" />
                      )}
                    </button>
                  </>
                )}
                {/* Open-affordance arrow — only for rows that actually go
                    somewhere. Keeps the visual language consistent with the
                    "external link" convention used on the CaseCard etc. */}
                {openable && it.kind !== "document" && (
                  <span
                    aria-hidden
                    className="p-1.5 text-slate-400 group-hover:text-primary transition-colors"
                    title="Open"
                  >
                    <ArrowUpRight className="size-4" />
                  </span>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  disabled={deleting}
                  className="opacity-0 group-hover:opacity-100 transition text-slate-400 hover:text-rose-600 focus:opacity-100 disabled:opacity-40 p-1.5"
                  title="Delete this entry"
                  aria-label="Delete this entry"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
            <div className="font-medium text-slate-900 line-clamp-2">
              {it.title}
            </div>
            {/* Attached documents (query rows only) — mirror the chat
                bubble's attachment strip so the user can preview /
                download the file they sent with the question. */}
            {it.attachments && it.attachments.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {it.attachments.map((att) => (
                  <AttachmentChip key={att.docId} att={att} />
                ))}
              </div>
            )}
            {it.detail && (
              <p className="text-sm text-muted-foreground mt-1 line-clamp-3">
                {it.detail}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Compact preview/download chip for a document attached to a chat turn.
 *  Fetches bytes on demand via `api.documentFile` — the bearer token
 *  never leaks into the URL. Preview opens an in-app FilePreviewModal
 *  (image <img> or PDF <iframe>) — never window.open, so we never lose
 *  the file to a browser's pop-up blocker. Rendered inside a query
 *  HistoryRow — clicks swallow propagation so they don't also trigger
 *  the row's own openItem navigation. */
function AttachmentChip({ att }: { att: NonNullable<HistoryItem["attachments"]>[number] }) {
  const [busy, setBusy] = useState<"preview" | "download" | null>(null);
  const [preview, setPreview] = useState<{ url: string; kind: "image" | "pdf" } | null>(null);
  const isImage = (att.contentType || "").startsWith("image/") ||
                  /\.(png|jpe?g|webp|heic|heif|bmp|gif)$/i.test(att.filename || "");
  const isPdf = (att.contentType || "") === "application/pdf" ||
                (att.filename || "").toLowerCase().endsWith(".pdf");
  const canInline = isImage || isPdf;
  const sizeLabel = (() => {
    const n = att.size;
    if (n == null) return "";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  })();

  async function open(mode: "preview" | "download", e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (busy) return;
    setBusy(mode);
    try {
      const blob = await api.documentFile(att.docId, { inline: mode === "preview" });
      const url = URL.createObjectURL(blob);
      if (mode === "download") {
        const a = document.createElement("a");
        a.href = url;
        a.download = att.filename || `document-${att.docId}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4_000);
        return;
      }
      // preview
      if (isImage) {
        setPreview({ url, kind: "image" });
      } else if (isPdf) {
        setPreview({ url, kind: "pdf" });
      } else {
        // No safe inline renderer — fall back to a download.
        const a = document.createElement("a");
        a.href = url;
        a.download = att.filename || `document-${att.docId}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4_000);
      }
    } catch (e) {
      const msg = e instanceof ApiError && e.status === 404
        ? "This document is no longer available."
        : (e as Error)?.message || "Could not open the document.";
      toast.error(msg);
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
        className="group/att inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 pl-1.5 pr-1 py-1 max-w-[260px]"
        onClick={(e) => e.stopPropagation()}
        title={att.filename || undefined}
      >
        <button
          type="button"
          onClick={(e) => open(canInline ? "preview" : "download", e)}
          className="flex items-center gap-2 min-w-0 flex-1 rounded-md hover:bg-primary/5 pr-1 pl-0.5 py-0.5 text-left"
          title={canInline ? "Click to preview" : "Click to download"}
        >
          <div className="size-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
            {isImage ? (
              <ImageIcon className="size-4 text-primary" />
            ) : (
              <FileText className="size-4 text-primary" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-medium text-slate-800 truncate leading-tight">
              {att.filename || `document-${att.docId}`}
            </div>
            {sizeLabel && (
              <div className="text-[10.5px] text-slate-500 leading-tight">{sizeLabel}</div>
            )}
          </div>
        </button>
        <div className="flex items-center gap-0.5 shrink-0">
          {canInline && (
            <button
              type="button"
              onClick={(e) => open("preview", e)}
              disabled={busy !== null}
              className="p-1 rounded-md text-slate-500 hover:bg-primary/10 hover:text-primary disabled:opacity-50"
              title="Preview"
              aria-label="Preview"
            >
              {busy === "preview" ? (
                <span className="block size-3.5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
              ) : (
                <Eye className="size-3.5" />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={(e) => open("download", e)}
            disabled={busy !== null}
            className="p-1 rounded-md text-slate-500 hover:bg-primary/10 hover:text-primary disabled:opacity-50"
            title="Download"
            aria-label="Download"
          >
            {busy === "download" ? (
              <span className="block size-3.5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
            ) : (
              <Download className="size-3.5" />
            )}
          </button>
        </div>
      </div>
      {preview && (
        <FilePreviewModal
          url={preview.url}
          kind={preview.kind}
          filename={att.filename || `document-${att.docId}`}
          onClose={closePreview}
        />
      )}
    </>
  );
}

function PagerButton({
  disabled,
  onClick,
  children,
  label,
}: {
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={
        "inline-flex items-center justify-center min-w-7 h-7 px-2 rounded-md border border-slate-200 bg-white text-slate-600 text-[11px] font-medium transition-colors " +
        (disabled
          ? "opacity-40 cursor-not-allowed"
          : "hover:bg-slate-50 hover:text-slate-900")
      }
    >
      {children}
    </button>
  );
}

/** Compact pagination window: 1 … 4 [5] 6 … 12 */
function pageWindow(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const left = Math.max(2, current - 1);
  const right = Math.min(total - 1, current + 1);
  if (left > 2) out.push("…");
  for (let p = left; p <= right; p++) out.push(p);
  if (right < total - 1) out.push("…");
  out.push(total);
  return out;
}
