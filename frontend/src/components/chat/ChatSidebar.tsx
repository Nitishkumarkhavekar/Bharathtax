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
} from "lucide-react";
import { ChatThread, groupByRecency } from "@/lib/chatStore";
import { cn } from "@/lib/utils";
import { useAuth } from "@/auth";

// Tools available to officers / auditors alongside the chat. These all use the
// regular Layout outside the chat shell — the back-and-forth happens via
// Layout's own nav, which already includes "Ask Bot" to return here.
const TOOLS = [
  { to: "/appeals", label: "Appeals", icon: Gavel },
  { to: "/rulings", label: "Rulings", icon: BookOpen },
  { to: "/documents", label: "Documents", icon: FileText },
  { to: "/history", label: "History", icon: Clock },
  { to: "/profile", label: "Profile", icon: UserCircle2 },
];

interface ChatSidebarProps {
  threads: ChatThread[];
  activeThreadId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onClose?: () => void; // mobile
}

export default function ChatSidebar({
  threads,
  activeThreadId,
  onSelect,
  onNew,
  onDelete,
  onClose,
}: ChatSidebarProps) {
  const { session, logout } = useAuth();
  const [query, setQuery] = useState("");

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
  const isAdmin = !!session && ["super_admin", "wing_admin"].includes(session.role);

  return (
    <aside className="w-full sm:w-72 lg:w-80 shrink-0 h-full flex flex-col bg-sidebar text-sidebar-foreground border-r border-white/5">
      {/* Brand + close (mobile) */}
      <div className="h-16 flex items-center justify-between gap-2 px-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="size-8 rounded-lg bg-primary/15 ring-1 ring-primary/30 flex items-center justify-center">
            <Scale className="size-4 text-primary" />
          </div>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-tight text-white">BharathTax</div>
            <div className="text-[11px] text-sidebar-foreground/60 -mt-0.5">Income-tax research</div>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="sm:hidden p-2 rounded-md hover:bg-white/5"
            aria-label="Close menu"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* New chat + search */}
      <div className="p-3 space-y-2 border-b border-white/10">
        <button
          onClick={onNew}
          className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium bg-white/10 hover:bg-white/15 text-white transition-colors"
        >
          <Plus className="size-4" />
          New chat
        </button>
        <div className="relative">
          <Search className="absolute left-3 top-2.5 size-4 text-sidebar-foreground/50" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-white/[0.04] border border-white/[0.06] text-white placeholder:text-sidebar-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      </div>

      {/* Threads */}
      <div className="flex-1 overflow-y-auto chat-scrollbar px-2 py-3">
        {groups.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-sidebar-foreground/50">
            {query.trim() ? "No chats match." : "Your conversations will appear here."}
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.label} className="mb-3">
              <div className="px-3 mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
                {g.label}
              </div>
              <ul className="space-y-0.5">
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

      {/* Tools (officers / auditors only) */}
      {!isAdmin && (
        <div className="border-t border-white/10 p-3 space-y-0.5">
          <div className="px-2 mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-sidebar-foreground/55">
            Tools
          </div>
          {TOOLS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-[13.5px] transition-colors",
                  isActive
                    ? "bg-primary/20 text-white"
                    : "text-sidebar-foreground/90 hover:bg-white/8 hover:text-white",
                )
              }
            >
              <t.icon className="size-4 shrink-0" />
              <span className="truncate">{t.label}</span>
            </NavLink>
          ))}
        </div>
      )}

      {/* User */}
      <div className="border-t border-white/10 p-3 flex items-center gap-2">
        <div className="size-8 rounded-full bg-gradient-to-br from-primary to-primary/60 text-white flex items-center justify-center text-xs font-semibold uppercase">
          {session?.username?.[0] ?? "?"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate text-white">{session?.username}</div>
          <div className="text-[11px] text-sidebar-foreground/60 capitalize">
            {session?.role?.replace("_", " ")}
          </div>
        </div>
        <button
          onClick={logout}
          title="Logout"
          className="p-2 rounded-md text-sidebar-foreground/70 hover:bg-white/5 hover:text-white"
        >
          <LogOut className="size-4" />
        </button>
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
          "group w-full flex items-center gap-2 rounded-md pl-3 pr-1 py-2 text-left text-[13.5px] transition-colors",
          active
            ? "bg-white/[0.08] text-white"
            : "text-sidebar-foreground/80 hover:bg-white/[0.05] hover:text-white",
        )}
      >
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
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-white/10"
        >
          <Trash2 className="size-3.5" />
        </span>
      </button>
    </li>
  );
}

// Re-export to satisfy lint (children was only used in older drafts).
export type { ReactNode };
