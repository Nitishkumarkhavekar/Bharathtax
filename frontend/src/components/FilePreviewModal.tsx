import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Download, FileText, Image as ImageIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * In-app document preview overlay — used by the chat message chip AND
 * the History-page attachment chip. Portalled into <body> so it escapes
 * any ancestor with `transform` / `filter` / `backdrop-filter` (which
 * would otherwise become the containing block for our `position: fixed`
 * root and force the modal to render inline).
 *
 * Blob-URL contract: the caller creates the object URL, passes it in,
 * and is responsible for calling `URL.revokeObjectURL(url)` after
 * `onClose` fires. We don't revoke here because the caller may want to
 * keep the URL alive briefly (e.g. for a follow-up download).
 */
export function FilePreviewModal({
  url, kind, filename, onClose,
}: {
  url: string;
  kind: "image" | "pdf";
  filename: string;
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

  function saveAs() {
    // The blob URL we already have works for direct save — no second
    // network round-trip needed.
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || `document.${kind === "pdf" ? "pdf" : "png"}`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  const isImage = kind === "image";
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
