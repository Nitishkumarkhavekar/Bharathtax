import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Link } from "react-router-dom";
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
  ScrollText,
  Clock,
  UserCircle2,
  MessageSquareText,
  SquarePen,
  Sparkles,
  Coins,
  ChevronDown,
  PanelLeft,
  MoreHorizontal,
  Pin,
  PinOff,
  Pencil,
  Archive,
} from "lucide-react";
import { ChatThread, groupByRecency } from "@/lib/chatStore";
import { cn } from "@/lib/utils";
import { useAuth } from "@/auth";

// Tools available to officers / auditors alongside the chat.
const TOOLS = [
  { to: "/appeals", label: "Appeals", icon: Gavel, tone: "amber" as const },
  { to: "/drafts", label: "Drafting", icon: ScrollText, tone: "teal" as const },
  { to: "/rulings", label: "Rulings", icon: BookOpen, tone: "violet" as const },
  { to: "/documents", label: "Documents", icon: FileText, tone: "sky" as const },
  { to: "/history", label: "History", icon: Clock, tone: "emerald" as const },
  { to: "/tokens", label: "Token Usage", icon: Coins, tone: "rose" as const },
  { to: "/profile", label: "Profile", icon: UserCircle2, tone: "indigo" as const },
];

/** Icon-tile styling for the light-theme sidebar — soft gradient chip with a
 *  matching-tone ring and slightly-desaturated icon colour. */
// Single primary tint across every tool tile — the app uses a strict
// 3-colour palette (slate + primary + emerald + rose), so we lean on
// iconography rather than hue to differentiate sections.
const TONE_TILE: Record<string, string> = {
  amber: "bg-primary/10 text-primary",
  teal: "bg-primary/10 text-primary",
  violet: "bg-primary/10 text-primary",
  sky: "bg-primary/10 text-primary",
  emerald: "bg-primary/10 text-primary",
  rose: "bg-primary/10 text-primary",
  indigo: "bg-primary/10 text-primary",
};

interface ChatSidebarProps {
  threads: ChatThread[];
  activeThreadId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename?: (id: string, title: string) => void;
  onTogglePin?: (id: string) => void;
  onArchive?: (id: string) => void;
  onOpenArchived?: () => void;
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
  onRename,
  onTogglePin,
  onArchive,
  onOpenArchived,
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

  const pinned = useMemo(() => filtered.filter((t) => t.pinned), [filtered]);
  const groups = useMemo(
    () => groupByRecency(filtered.filter((t) => !t.pinned)),
    [filtered],
  );
  const isAdmin =
    !!session && ["super_admin", "wing_admin"].includes(session.role);
  const firstLetter = (session?.username || "?").slice(0, 1).toUpperCase();

  // Collapsed rail — a compact icon-only mode that keeps the toggle,
  // "New chat" button and tool tiles reachable without eating horizontal
  // space. Expand via the arrow at top-right.
  if (collapsed) {
    return (
      <aside className="relative w-16 shrink-0 h-full flex flex-col bt-sidebar-bg text-slate-800 border-r border-slate-200 overflow-hidden">
        {/* Brand mark + expand toggle */}
        <div className="relative h-16 flex flex-col items-center justify-center gap-1 border-b border-slate-200/80">
          <div className="size-8 rounded-lg bg-primary flex items-center justify-center ring-1 ring-primary/30 shadow-sm">
            <Scale className="size-4 text-white" strokeWidth={2.2} />
          </div>
        </div>
        <div className="relative flex flex-col items-center gap-2 p-2">
          <button
            onClick={onToggleCollapsed}
            title="Show sidebar"
            aria-label="Show sidebar"
            className="size-9 rounded-lg bg-white ring-1 ring-slate-200 hover:ring-primary/40 hover:text-primary text-slate-600 flex items-center justify-center transition-colors"
          >
            <PanelLeft className="size-4" />
          </button>
          <button
            onClick={onNew}
            title="New chat"
            aria-label="New chat"
            className="size-9 rounded-lg text-white flex items-center justify-center bg-primary shadow-sm hover:bg-primary/90 transition-colors"
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
                    "size-9 rounded-lg flex items-center justify-center transition-all",
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
        {/* Footer: avatar (→ profile) + logout */}
        <div className="relative border-t border-slate-200/80 p-2 flex flex-col items-center gap-2">
          <Link
            to="/profile"
            title="Open profile"
            className="size-9 rounded-full bg-primary text-white flex items-center justify-center text-[13px] font-semibold uppercase ring-1 ring-primary/20 hover:ring-primary/50 transition-all"
          >
            {firstLetter}
          </Link>
          <button
            onClick={logout}
            title="Sign out"
            aria-label="Sign out"
            className="p-2 rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
          >
            <LogOut className="size-[18px]" />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="relative w-full sm:w-72 lg:w-80 shrink-0 h-full flex flex-col bt-sidebar-bg text-slate-800 border-r border-slate-200 overflow-hidden">
      {/* Brand */}
      <div className="relative h-16 flex items-center justify-between gap-2 px-4 border-b border-slate-200/80">
        <div className="flex items-center gap-2.5">
          <div className="size-9 rounded-lg bg-primary flex items-center justify-center ring-1 ring-primary/30 shadow-sm">
            <Scale className="size-4.5 text-white" strokeWidth={2.2} />
          </div>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-tight text-slate-900">
              BharatTax
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
              <PanelLeft className="size-4" />
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

      {/* Full-width "New chat" row + search. The action spans the sidebar
          width, dark-slate pill with the SquarePen glyph (ChatGPT style). */}
      <div className="relative p-3 space-y-2 border-b border-slate-200/80">
        <button
          onClick={onNew}
          title="Start a new chat"
          aria-label="New chat"
          className="w-full inline-flex items-center justify-center gap-2 h-11 rounded-lg text-[14px] font-semibold text-white bg-slate-900 hover:bg-slate-800 shadow-sm ring-1 ring-black/40 transition-colors"
        >
          <SquarePen className="size-4" strokeWidth={1.8} />
          <span>New chat</span>
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
        {pinned.length === 0 && groups.length === 0 ? (
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
          <>
            {pinned.length > 0 && (
              <div className="mb-3">
                <div className="px-3 mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-400 flex items-center gap-1">
                  <Pin className="size-3" /> Pinned
                </div>
                <ul className="space-y-1">
                  {pinned.map((t) => (
                    <ThreadItem
                      key={t.id}
                      thread={t}
                      active={t.id === activeThreadId}
                      onSelect={() => onSelect(t.id)}
                      onDelete={() => onDelete(t.id)}
                      onRename={onRename}
                      onTogglePin={onTogglePin}
                      onArchive={onArchive}
                    />
                  ))}
                </ul>
              </div>
            )}
            {groups.map((g) => (
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
                      onRename={onRename}
                      onTogglePin={onTogglePin}
                      onArchive={onArchive}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </>
        )}
        {onOpenArchived && (
          <button
            onClick={onOpenArchived}
            className="mt-2 w-full flex items-center gap-2 rounded-lg px-3 py-2 text-[12.5px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
          >
            <Archive className="size-3.5" /> Archived
          </button>
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
                      "size-7 rounded-lg flex items-center justify-center shrink-0",
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

      {/* User card — the name/avatar opens the profile; the button signs out. */}
      <div className="relative border-t border-slate-200/80 p-3">
        <div className="rounded-xl bg-white ring-1 ring-slate-200 shadow-sm p-1.5 flex items-center gap-1">
          <Link
            to="/profile"
            onClick={() => onClose?.()}
            title="Open profile"
            className="flex items-center gap-2.5 min-w-0 flex-1 rounded-lg px-1.5 py-1 hover:bg-slate-50 transition-colors"
          >
            <div className="shrink-0 size-9 rounded-full bg-primary text-white flex items-center justify-center text-[13px] font-semibold uppercase">
              {firstLetter}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold truncate text-slate-900">
                {session?.username}
              </div>
              <div className="mt-0.5 inline-flex items-center gap-1 text-[10.5px] text-slate-500 capitalize">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                {session?.role?.replace("_", " ")}
              </div>
            </div>
          </Link>
          <button
            onClick={logout}
            title="Sign out"
            aria-label="Sign out"
            className="shrink-0 p-2 rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
          >
            <LogOut className="size-[18px]" />
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
  onRename,
  onTogglePin,
  onArchive,
}: {
  thread: ChatThread;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename?: (id: string, title: string) => void;
  onTogglePin?: (id: string) => void;
  onArchive?: (id: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(thread.title);
  const rootRef = useRef<HTMLLIElement | null>(null);

  // Close the menu on any outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  function commitRename() {
    const t = draft.trim();
    setRenaming(false);
    if (t && t !== thread.title) onRename?.(thread.id, t);
    else setDraft(thread.title);
  }

  if (renaming) {
    return (
      <li ref={rootRef}>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") {
              setDraft(thread.title);
              setRenaming(false);
            }
          }}
          className="w-full rounded-lg px-3 py-2 text-[13.5px] bg-white border border-primary ring-2 ring-primary/20 focus:outline-none"
        />
      </li>
    );
  }

  const menuItem = "w-full flex items-center gap-2 px-3 py-1.5 text-[13px] text-slate-700 hover:bg-slate-100 text-left";
  return (
    <li ref={rootRef} className="relative">
      <button
        onClick={onSelect}
        className={cn(
          "group relative w-full flex items-center gap-2 rounded-lg pl-3 pr-1 py-2 text-left text-[13.5px] transition-all",
          active
            ? "bg-primary/10 text-primary font-semibold"
            : "text-slate-800 hover:bg-primary/[0.07] hover:text-slate-900",
        )}
      >
        {active && (
          <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-primary" />
        )}
        {thread.pinned ? (
          <Pin className={cn("size-3.5 shrink-0", active ? "text-primary" : "text-slate-400")} />
        ) : (
          <MessageSquareText
            className={cn("size-3.5 shrink-0 transition-colors", active ? "text-primary" : "text-slate-400")}
          />
        )}
        <span className="flex-1 truncate">{thread.title}</span>
        <span
          role="button"
          tabIndex={0}
          aria-label="Chat options"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((o) => !o);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              setMenuOpen((o) => !o);
            }
          }}
          className={cn(
            "shrink-0 p-1.5 rounded hover:bg-slate-200 text-slate-500 transition-opacity",
            menuOpen ? "opacity-100 bg-slate-200" : "opacity-0 group-hover:opacity-100",
          )}
        >
          <MoreHorizontal className="size-3.5" />
        </span>
      </button>

      {menuOpen && (
        <div className="absolute right-1 top-9 z-20 w-40 rounded-lg bg-white ring-1 ring-slate-200 shadow-lg py-1 animate-fade-up">
          <button
            className={menuItem}
            onClick={() => {
              setMenuOpen(false);
              setDraft(thread.title);
              setRenaming(true);
            }}
          >
            <Pencil className="size-3.5 text-slate-400" /> Rename
          </button>
          {onTogglePin && (
            <button
              className={menuItem}
              onClick={() => {
                setMenuOpen(false);
                onTogglePin(thread.id);
              }}
            >
              {thread.pinned ? <PinOff className="size-3.5 text-slate-400" /> : <Pin className="size-3.5 text-slate-400" />}
              {thread.pinned ? "Unpin" : "Pin"}
            </button>
          )}
          {onArchive && (
            <button
              className={menuItem}
              onClick={() => {
                setMenuOpen(false);
                onArchive(thread.id);
              }}
            >
              <Archive className="size-3.5 text-slate-400" /> Archive
            </button>
          )}
          <div className="my-1 h-px bg-slate-100" />
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[13px] text-rose-600 hover:bg-rose-50 text-left"
            onClick={() => {
              setMenuOpen(false);
              if (confirm(`Delete "${thread.title}"?`)) onDelete();
            }}
          >
            <Trash2 className="size-3.5" /> Delete
          </button>
        </div>
      )}
    </li>
  );
}

// Re-export to satisfy lint (children was only used in older drafts).
export type { ReactNode };
