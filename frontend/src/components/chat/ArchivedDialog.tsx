import { useEffect, useState } from "react";
import { X, Archive, ArchiveRestore, Trash2, Loader2 } from "lucide-react";
import { api, ServerChat } from "@/api";

// Browse archived chats: restore them to the active list, or delete for good.
export default function ArchivedDialog({
  open,
  onClose,
  onUnarchived,
}: {
  open: boolean;
  onClose: () => void;
  onUnarchived: (chat: ServerChat) => void;
}) {
  const [rows, setRows] = useState<ServerChat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api
      .chatList(true)
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function restore(c: ServerChat) {
    setRows((r) => r.filter((x) => x.id !== c.id));
    try {
      await api.chatPatch(c.id, { archived: false });
      onUnarchived(c);
    } catch {
      /* best-effort */
    }
  }
  async function remove(c: ServerChat) {
    if (!confirm(`Delete "${c.title}" permanently?`)) return;
    setRows((r) => r.filter((x) => x.id !== c.id));
    api.chatDelete(c.id).catch(() => {});
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-xl ring-1 ring-slate-200 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
          <div className="flex items-center gap-2 font-semibold text-slate-900">
            <Archive className="size-4 text-slate-500" /> Archived chats
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto chat-scrollbar p-2">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-500 gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center text-[13px] text-slate-500 py-12">No archived chats.</div>
          ) : (
            <ul className="space-y-1">
              {rows.map((c) => (
                <li
                  key={c.id}
                  className="group flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-slate-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] text-slate-800 truncate">{c.title}</div>
                    {c.updated_at && (
                      <div className="text-[11px] text-slate-400">
                        {new Date(c.updated_at).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => restore(c)}
                    title="Restore"
                    className="p-1.5 rounded-md text-slate-500 hover:bg-slate-200 hover:text-primary"
                  >
                    <ArchiveRestore className="size-4" />
                  </button>
                  <button
                    onClick={() => remove(c)}
                    title="Delete permanently"
                    className="p-1.5 rounded-md text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
