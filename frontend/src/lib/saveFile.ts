// Save a file to the user's OWN computer.
//
// Data-security first: on Chromium browsers (Chrome / Edge) this uses the
// File System Access API, so the officer picks the exact local folder and the
// document is written straight to their machine — it is never parked in a
// temp/downloads area and never routes through our cloud. On other browsers it
// falls back to an ordinary download (which also lands on their computer, just
// in the Downloads folder). Returns how it was saved, or "cancelled" if the
// officer dismissed the picker.

export type SaveResult = "saved" | "downloaded" | "cancelled";

const EXT_MIME: Record<string, { desc: string; mime: string }> = {
  docx: { desc: "Word document", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  pdf: { desc: "PDF document", mime: "application/pdf" },
  txt: { desc: "Text file", mime: "text/plain" },
};

/** True when the browser can save straight to a user-chosen local file. */
export function canSaveLocally(): boolean {
  return typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === "function";
}

export async function saveBlob(blob: Blob, suggestedName: string): Promise<SaveResult> {
  const picker = (window as unknown as {
    showSaveFilePicker?: (opts: unknown) => Promise<{
      createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }>;
    }>;
  }).showSaveFilePicker;

  if (typeof picker === "function") {
    const ext = suggestedName.split(".").pop()?.toLowerCase() || "";
    const known = EXT_MIME[ext];
    try {
      const handle = await picker({
        suggestedName,
        types: known ? [{ description: known.desc, accept: { [known.mime]: ["." + ext] } }] : undefined,
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return "saved";
    } catch (e: unknown) {
      // The officer cancelled the Save dialog — not an error.
      if (e && typeof e === "object" && (e as { name?: string }).name === "AbortError") return "cancelled";
      // Any other failure (permission, unsupported) → fall back to a download.
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "downloaded";
}
