import { ReactNode, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  Scale,
  Plus,
  Search,
  Trash2,
  LogOut,
  X,
  Gavel,
  BookOpen,
  FileText,
  Clock,
  UserCircle2,
  MessageSquareText,
  Sparkles,
  Coins,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { ChatThread, groupByRecency } from "@/lib/chatStore";
import { cn } from "@/lib/utils";
import { useAuth } from "@/auth";

// Tools available to officers / auditors alongside the chat.
const TOOLS = [
  { to: "/appeals", label: "Appeals", icon: Gavel, tone: "amber" as const },
  { to: "/rulings", label: "Rulings", icon: BookOpen, tone: "violet" as const },
  { to: "/documents", label: "Documents", icon: FileText, tone: "sky" as const },
  { to: "/history", label: "History", icon: Clock, tone: "emerald" as const },
  { to: "/tokens", label: "Token Usage", icon: Coins, tone: "rose" as const },
  { to: "/profile", label: "Profile", icon: UserCircle2, tone: "indigo" as const },
];

/** Icon-tile styling for the light-theme sidebar — soft gradient chip with a
 *  matching-tone ring and slightly-desaturated icon colour. */
const TONE_TILE: Record<string, string> = {
  amber: "from-amber-100 to-amber-50 text-amber-700 ring-amber-200",
  violet: "from-violet-100 to-violet-50 text-violet-700 ring-violet-200",
  sky: "from-sky-100 to-sky-50 text-sky-700 ring-sky-200",
  emerald: "from-emerald-100 to-emerald-50 text-emerald-700 ring-emerald-200",
  rose: "from-rose-100 to-rose-50 text-rose-700 ring-rose-200",
  indigo: "from-indigo-100 to-indigo-50 text-indigo-700 ring-indigo-200",
};

interface ChatSidebarProps {
  threads: ChatThread[];
  activeThreadId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onClose?: () => void; // mobile
  /** Desktop collapse — when true, renders as a thin icon rail. */
  collapsed?: boolean;
  /** Called when the user clicks the show/hide toggle on the sidebar. */
  onToggleCollapsed?: () => void;
}

export default function ChatSidebar({
  threads,
  activeThreadId,
  onSelect,
  onNew,
  onDelete,
  onClose,
  collapsed = false,
  onToggleCollapsed,
}: ChatSidebarProps) {
  const { session, logout } = useAuth();
  const [query, setQuery] = useState("");
  // Persist the Tools collapse state so it survives navigation / reloads.
  // Default is CLOSED — the sidebar's primary purpose is chat threads;
  // tools are a secondary drawer the user opens on demand.
  const [toolsOpen, setToolsOpen] = useState(() => {
    try {
      const v = localStorage.getItem("bt_chat_tools_open_v2");
      return v === "1";
    } catch {
      return false;
    }
  });
  const toggleTools = () => {
    setToolsOpen((o) => {
      const nxt = !o;
      try {
        localStorage.setItem("bt_chat_tools_open_v2", nxt ? "1" : "0");
      } catch {
        /* */
      }
      return nxt;
    });
  };

  const filtered = useMemo(() => {
    if (!query.trim()) return threads;
    const q = query.toLowerCase();
    return threads.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.messages.some((m) => m.content.toLowerCase().includes(q)),
    );
  }, [threads, query]);

  const groups = useMemo(() => groupByRecency(filtered), [filtered]);
  const isAdmin =
    !!session && ["super_admin", "wing_admin"].includes(session.role);
  const firstLetter = (session?.username || "?").slice(0, 1).toUpperCase();

  // Collapsed rail — a compact icon-only mode that keeps the toggle,
  // "New chat" button and tool tiles reachable without eating horizontal
  // space. Expand via the arrow at top-right.
  if (collapsed) {
    return (
      <aside className="relative w-16 shrink-0 h-full flex flex-col bt-sidebar-bg text-slate-800 border-r border-slate-200 overflow-hidden">
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <div className="absolute -top-16 -left-12 size-56 rounded-full bg-primary/10 blur-3xl" />
          <div className="absolute bottom-24 -right-12 size-56 rounded-full bg-violet-300/25 blur-3xl" />
        </div>
        {/* Brand mark + expand toggle */}
        <div className="relative h-16 flex flex-col items-center justify-center gap-1 border-b border-slate-200/80">
          <div className="relative">
            <div className="absolute -inset-1 rounded-xl bg-gradient-to-br from-primary/40 via-sky-400/30 to-violet-500/30 blur-md" />
            <div className="relative size-8 rounded-xl bg-gradient-to-br from-primary via-sky-500 to-violet-600 flex items-center justify-center ring-1 ring-white/40 shadow-md">
              <Scale className="size-4 text-white" strokeWidth={2.2} />
            </div>
          </div>
        </div>
        <div className="relative flex flex-col items-center gap-2 p-2">
          <button
            onClick={onToggleCollapsed}
            title="Show sidebar"
            aria-label="Show sidebar"
            className="size-9 rounded-lg bg-white ring-1 ring-slate-200 hover:ring-primary/40 hover:text-primary text-slate-600 flex items-center justify-center transition-colors"
          >
            <PanelLeftOpen className="size-4" />
          </button>
          <button
            onClick={onNew}
            title="New chat"
            aria-label="New chat"
            className="size-9 rounded-lg text-white flex items-center justify-center shadow-lg shadow-primary/25 transition-transform hover:scale-105"
            style={{
              background:
                "linear-gradient(135deg, rgba(46,124,200,1) 0%, rgba(37,99,235,1) 55%, rgba(99,102,241,1) 100%)",
            }}
          >
            <Plus className="size-4" />
          </button>
        </div>
        {/* Tool icons stacked vertically */}
        {!isAdmin && (
          <div className="relative flex-1 overflow-y-auto chat-scrollbar flex flex-col items-center gap-1 py-2">
            {TOOLS.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                title={t.label}
                aria-label={t.label}
                className={({ isActive }) =>
                  cn(
                    "size-9 rounded-lg bg-gradient-to-br ring-1 flex items-center justify-center transition-all",
                    TONE_TILE[t.tone],
                    isActive && "ring-2 ring-primary/50 shadow-sm",
                  )
                }
              >
                <t.icon className="size-4" />
              </NavLink>
            ))}
          </div>
        )}
        {/* Footer: avatar + logout */}
        <div className="relative border-t border-slate-200/80 p-2 flex flex-col items-center gap-2">
          <div className="relative" title={session?.username}>
            <div className="absolute -inset-0.5 rounded-full bg-gradient-to-br from-primary to-violet-500 opacity-60 blur-sm" />
            <div className="relative size-9 rounded-full bg-gradient-to-br from-primary to-violet-600 text-white flex items-center justify-center text-[13px] font-semibold uppercase ring-2 ring-white">
              {firstLetter}
            </div>
          </div>
          <button
            onClick={logout}
            title="Logout"
            aria-label="Logout"
            className="p-2 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="relative w-full sm:w-72 lg:w-80 shrink-0 h-full flex flex-col bt-sidebar-bg text-slate-800 border-r border-slate-200 overflow-hidden">
      {/* Soft aurora accents in the light surface */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute -top-24 -left-24 size-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute bottom-24 -right-16 size-72 rounded-full bg-violet-300/25 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgb(15 23 42) 1px, transparent 0)",
            backgroundSize: "22px 22px",
          }}
        />
      </div>

      {/* Brand */}
      <div className="relative h-16 flex items-center justify-between gap-2 px-4 border-b border-slate-200/80">
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <div className="absolute -inset-1 rounded-xl bg-gradient-to-br from-primary/40 via-sky-400/30 to-violet-500/30 blur-md" />
            <div className="relative size-9 rounded-xl bg-gradient-to-br from-primary via-sky-500 to-violet-600 flex items-center justify-center ring-1 ring-white/40 shadow-md">
              <Scale className="size-4.5 text-white" strokeWidth={2.2} />
            </div>
          </div>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-tight text-slate-900">
              BharathTax
            </div>
            <div className="text-[10.5px] text-slate-500 -mt-0.5 flex items-center gap-1">
              <Sparkles className="size-2.5" /> Income-tax research
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {onToggleCollapsed && (
            <button
              onClick={onToggleCollapsed}
              className="hidden sm:inline-flex p-2 rounded-md text-slate-500 hover:bg-slate-100 hover:text-primary transition-colors"
              aria-label="Hide sidebar"
              title="Hide sidebar"
            >
              <PanelLeftClose className="size-4" />
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="sm:hidden p-2 rounded-md hover:bg-slate-100"
              aria-label="Close menu"
            >
              <X className="size-4 text-slate-600" />
            </button>
          )}
        </div>
      </div>

      {/* New chat + search */}
      <div className="relative p-3 space-y-2 border-b border-slate-200/80">
        <button
          onClick={onNew}
          className="group relative w-full flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold text-white transition-all overflow-hidden"
          style={{
            background:
              "linear-gradient(135deg, rgba(46,124,200,1) 0%, rgba(37,99,235,1) 55%, rgba(99,102,241,1) 100%)",
            boxShadow:
              "0 8px 24px -12px rgba(46,124,200,0.55), inset 0 1px 0 rgba(255,255,255,0.20)",
          }}
        >
          <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-white/10" />
          <Plus className="size-4 relative" />
          <span className="relative">New chat</span>
        </button>
        <div className="relative">
          <Search className="absolute left-3 top-2.5 size-4 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-white border border-slate-200 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>
      </div>

      {/* Threads */}
      <div className="relative flex-1 overflow-y-auto chat-scrollbar px-2 py-3">
        {groups.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <div className="mx-auto size-10 rounded-full bg-slate-100 ring-1 ring-slate-200 flex items-center justify-center mb-2">
              <MessageSquareText className="size-4 text-slate-400" />
            </div>
            <div className="text-xs text-slate-500">
              {query.trim()
                ? "No chats match."
                : "Your conversations will appear here."}
            </div>
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.label} className="mb-3">
              <div className="px-3 mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                {g.label}
              </div>
              <ul className="space-y-1">
                {g.threads.map((t) => (
                  <ThreadItem
                    key={t.id}
                    thread={t}
                    active={t.id === activeThreadId}
                    onSelect={() => onSelect(t.id)}
                    onDelete={() => onDelete(t.id)}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
      </div>

      {/* Tools — collapsible via the chevron. */}
      {!isAdmin && (
        <div className="relative border-t border-slate-200/80 p-3">
          <button
            type="button"
            onClick={toggleTools}
            aria-expanded={toolsOpen}
            aria-controls="chat-sidebar-tools-list"
            className="w-full flex items-center justify-between px-2 py-1 rounded-md text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          >
            <span>Tools</span>
            <span
              className={cn(
                "size-5 rounded-md bg-white ring-1 ring-slate-200 flex items-center justify-center transition-transform duration-200 text-slate-500",
                toolsOpen ? "rotate-180" : "rotate-0",
              )}
              title={toolsOpen ? "Collapse" : "Expand"}
            >
              <ChevronDown className="size-3.5" />
            </span>
          </button>
          <div
            id="chat-sidebar-tools-list"
            className={cn(
              "overflow-hidden transition-[max-height,opacity,margin] duration-300 ease-out",
              toolsOpen
                ? "max-h-[440px] opacity-100 mt-1.5"
                : "max-h-0 opacity-0 mt-0",
            )}
          >
            <div className="space-y-1">
              {TOOLS.map((t) => (
                <NavLink
                  key={t.to}
                  to={t.to}
                  className={({ isActive }) =>
                    cn(
                      "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-all",
                      isActive
                        ? "bg-primary/15 text-primary ring-1 ring-primary/40 shadow-sm font-semibold"
                        : "text-slate-800 hover:bg-primary/[0.08] hover:text-primary hover:ring-1 hover:ring-primary/20",
                    )
                  }
                >
                  <span
                    className={cn(
                      "size-7 rounded-lg bg-gradient-to-br ring-1 flex items-center justify-center shrink-0",
                      TONE_TILE[t.tone],
                    )}
                  >
                    <t.icon className="size-4" />
                  </span>
                  <span className="truncate">{t.label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* User card */}
      <div className="relative border-t border-slate-200/80 p-3">
        <div className="rounded-xl bg-white ring-1 ring-slate-200 shadow-sm p-2.5 flex items-center gap-2.5">
          <div className="relative shrink-0">
            <div className="absolute -inset-0.5 rounded-full bg-gradient-to-br from-primary to-violet-500 opacity-60 blur-sm" />
            <div className="relative size-9 rounded-full bg-gradient-to-br from-primary to-violet-600 text-white flex items-center justify-center text-[13px] font-semibold uppercase ring-2 ring-white">
              {firstLetter}
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold truncate text-slate-900">
              {session?.username}
            </div>
            <div className="mt-0.5 inline-flex items-center gap-1 text-[10.5px] text-slate-500 capitalize">
              <span className="size-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.15)]" />
              {session?.role?.replace("_", " ")}
            </div>
          </div>
          <button
            onClick={logout}
            title="Logout"
            aria-label="Logout"
            className="p-2 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}

function ThreadItem({
  thread,
  active,
  onSelect,
  onDelete,
}: {
  thread: ChatThread;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <li>
      <button
        onClick={onSelect}
        className={cn(
          "group relative w-full flex items-center gap-2 rounded-lg pl-3 pr-1 py-2 text-left text-[13.5px] transition-all",
          active
            ? "bg-gradient-to-r from-primary/20 via-primary/10 to-transparent text-slate-900 font-semibold ring-1 ring-primary/35 shadow-sm"
            : "text-slate-800 hover:bg-primary/[0.07] hover:text-slate-900",
        )}
      >
        {active && (
          <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-gradient-to-b from-primary to-violet-500" />
        )}
        <MessageSquareText
          className={cn(
            "size-3.5 shrink-0 transition-colors",
            active ? "text-primary" : "text-slate-400",
          )}
        />
        <span className="flex-1 truncate">{thread.title}</span>
        <span
          role="button"
          tabIndex={0}
          aria-label="Delete chat"
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`Delete "${thread.title}"?`)) onDelete();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              if (confirm(`Delete "${thread.title}"?`)) onDelete();
            }
          }}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-slate-200 text-slate-500 hover:text-rose-600"
        >
          <Trash2 className="size-3.5" />
        </span>
      </button>
    </li>
  );
}

// Re-export to satisfy lint (children was only used in older drafts).
export type { ReactNode };
