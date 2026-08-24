import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, BellRing, Check, X, CalendarClock } from "lucide-react";
import { api, WsReminder } from "../api";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const POLL_MS = 60_000;

function whenLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const days = Math.round((d.getTime() - now.setHours(0, 0, 0, 0)) / 86_400_000);
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

/** App-wide notification bell — polls the workspace reminder feed and surfaces
 *  due reminders as a badge + dropdown, with a toast when a new one arrives. */
export default function NotificationBell() {
  const nav = useNavigate();
  const [items, setItems] = useState<WsReminder[]>([]);
  const [open, setOpen] = useState(false);
  const seen = useRef<Set<number>>(new Set());
  const primed = useRef(false);            // don't toast the initial backlog
  const wrapRef = useRef<HTMLDivElement>(null);

  const poll = useCallback(async () => {
    try {
      const due = await api.wsDueReminders();
      setItems(due);
      if (primed.current) {
        const fresh = due.filter((r) => !seen.current.has(r.id));
        if (fresh.length === 1) toast(`Reminder: ${fresh[0].title}`, { icon: "🔔" });
        else if (fresh.length > 1) toast(`${fresh.length} reminders are due`, { icon: "🔔" });
      }
      due.forEach((r) => seen.current.add(r.id));
      primed.current = true;
    } catch {
      /* silent — a poll hiccup shouldn't nag the user */
    }
  }, []);

  useEffect(() => {
    poll();
    const t = setInterval(poll, POLL_MS);
    return () => clearInterval(t);
  }, [poll]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const act = async (r: WsReminder, status: "done" | "dismissed") => {
    setItems((xs) => xs.filter((x) => x.id !== r.id));   // optimistic
    try { await api.wsUpdateReminder(r.id, { status }); }
    catch { poll(); }                                     // resync on failure
  };

  const count = items.length;

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        title="Reminders"
        className={cn(
          "relative inline-flex items-center justify-center size-9 rounded-lg transition-colors",
          open ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800",
        )}
      >
        {count > 0 ? <BellRing className="size-[18px]" /> : <Bell className="size-[18px]" />}
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl bg-white ring-1 ring-slate-200 shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-slate-100">
            <span className="text-[13px] font-semibold text-slate-900">Reminders</span>
            <button
              onClick={() => { setOpen(false); nav("/workspace"); }}
              className="text-[11.5px] font-semibold text-primary hover:underline"
            >
              Open calendar
            </button>
          </div>

          {count === 0 ? (
            <div className="px-4 py-8 text-center">
              <Bell className="size-6 mx-auto text-slate-300 mb-2" />
              <p className="text-[12.5px] text-slate-400">You're all caught up.</p>
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto divide-y divide-slate-100">
              {items.map((r) => (
                <div key={r.id} className="flex items-start gap-2.5 px-3.5 py-2.5 hover:bg-slate-50">
                  <div className="shrink-0 size-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center mt-0.5">
                    <CalendarClock className="size-4" />
                  </div>
                  <button
                    onClick={() => { setOpen(false); nav("/workspace"); }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="text-[13px] font-semibold text-slate-800 truncate">{r.title}</div>
                    <div className="text-[11px] text-slate-500">Due {whenLabel(r.due_at)}</div>
                  </button>
                  <div className="shrink-0 flex items-center gap-0.5">
                    <button
                      onClick={() => act(r, "done")} title="Mark done"
                      className="p-1.5 rounded-md text-slate-400 hover:bg-emerald-50 hover:text-emerald-600"
                    >
                      <Check className="size-4" />
                    </button>
                    <button
                      onClick={() => act(r, "dismissed")} title="Dismiss"
                      className="p-1.5 rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
