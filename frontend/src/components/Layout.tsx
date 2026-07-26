import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  MessageSquareText,
  FileText,
  Clock,
  ShieldCheck,
  LogOut,
  Scale,
  Gavel,
  ScrollText,
  BookOpen,
  Menu,
  X,
  UserCircle2,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { api, SeatUsage } from "../api";
import { useAuth } from "../auth";
import { cn } from "@/lib/utils";

type NavTone = "primary" | "amber" | "violet" | "sky" | "emerald" | "rose" | "indigo" | "slate";
const NAV: {
  to: string;
  label: string;
  icon: typeof MessageSquareText;
  roles?: string[];
  feature?: string;   // gateable module key; hidden unless the user is allotted it
  tone: NavTone;
  hint: string;
}[] = [
  { to: "/ask", label: "Chat", icon: MessageSquareText, feature: "chat", tone: "primary", hint: "Citation-grounded chat" },
  { to: "/appeals", label: "Appeals", icon: Gavel, feature: "appeals", tone: "amber", hint: "Draft CIT(A) orders" },
  { to: "/drafts", label: "Drafting", icon: ScrollText, tone: "rose", hint: "Notices & orders" },
  { to: "/rulings", label: "Rulings", icon: BookOpen, feature: "rulings", tone: "violet", hint: "Case-law search" },
  { to: "/documents", label: "Documents", icon: FileText, feature: "documents", tone: "sky", hint: "Upload · summarise" },
  { to: "/history", label: "History", icon: Clock, feature: "history", tone: "emerald", hint: "Past queries" },
  { to: "/profile", label: "Profile", icon: UserCircle2, tone: "indigo", hint: "Account settings" },
  { to: "/admin", label: "Admin", icon: ShieldCheck, roles: ["super_admin", "wing_admin"], tone: "slate", hint: "Console" },
];

/** Light-theme icon-tile styling — pastel gradient chip + tone ring. */
const NAV_TONE_TILE: Record<NavTone, string> = {
  primary: "from-sky-100 to-blue-50 text-primary ring-primary/25",
  amber: "from-amber-100 to-amber-50 text-amber-700 ring-amber-200",
  violet: "from-violet-100 to-violet-50 text-violet-700 ring-violet-200",
  sky: "from-sky-100 to-sky-50 text-sky-700 ring-sky-200",
  emerald: "from-emerald-100 to-emerald-50 text-emerald-700 ring-emerald-200",
  rose: "from-rose-100 to-rose-50 text-rose-700 ring-rose-200",
  indigo: "from-indigo-100 to-indigo-50 text-indigo-700 ring-indigo-200",
  slate: "from-slate-100 to-slate-50 text-slate-700 ring-slate-200",
};

function SeatWidget() {
  const { session } = useAuth();
  const [usage, setUsage] = useState<SeatUsage | null>(null);
  const isAdmin = session && ["super_admin", "wing_admin"].includes(session.role);
  useEffect(() => {
    if (!isAdmin || !session) return;
    api.seatUsage(session.wingId).then(setUsage).catch(() => setUsage(null));
  }, [isAdmin, session]);
  if (!usage) return null;
  const unlimited = usage.limit <= 0;
  const pct = unlimited ? 0 : Math.min(100, Math.round((usage.used / usage.limit) * 100));
  return (
    <div
      className="px-3 py-2 rounded-lg bg-white ring-1 ring-slate-200"
      title="Live seat pool for your wing"
    >
      <div className="flex justify-between text-[11px] text-slate-500 mb-1">
        <span className="font-medium text-slate-700">Wing seats</span>
        <span className="tabular-nums">
          {unlimited ? `${usage.used} active` : `${usage.used}/${usage.limit}`}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary to-violet-500"
          style={{ width: `${unlimited ? 8 : pct}%` }}
        />
      </div>
    </div>
  );
}

function SidebarBody({
  onNavigate,
  collapsed = false,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const { session, logout } = useAuth();
  const loc = useLocation();
  const isAdmin = !!session && ["super_admin", "wing_admin"].includes(session.role);
  const feats = session?.features ?? null; // null = all modules
  const nav = NAV.filter(
    (n) =>
      (!n.roles || (session && n.roles.includes(session.role))) &&
      (!n.feature || isAdmin || !feats || feats.includes(n.feature)),
  );
  // Prefer the human-facing full name over the login handle so the sidebar
  // and greeting agree ("Hello, Avinash" vs. an initial from "ceo").  Fall
  // back to the username when full_name isn't set on the user record.
  const displayName = session?.fullName?.trim() || session?.username || "";
  const firstLetter = (displayName || "?").slice(0, 1).toUpperCase();
  return (
    <>
      {/* Aurora accents in the light sidebar */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute -top-24 -left-16 size-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute bottom-20 -right-16 size-72 rounded-full bg-violet-300/25 blur-3xl" />
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
      <div
        className={cn(
          "relative h-16 flex items-center border-b border-slate-200/80",
          collapsed ? "px-0 justify-center" : "px-5 gap-2.5",
        )}
      >
        <div className="relative">
          <div className="absolute -inset-1 rounded-xl bg-gradient-to-br from-primary/40 via-sky-400/30 to-violet-500/30 blur-md" />
          <div className="relative size-9 rounded-xl bg-gradient-to-br from-primary via-sky-500 to-violet-600 flex items-center justify-center ring-1 ring-white/40 shadow-md">
            <Scale className="size-4.5 text-white" strokeWidth={2.2} />
          </div>
        </div>
        {!collapsed && (
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-tight text-slate-900">
              BharathTax
            </div>
            <div className="text-[10.5px] text-slate-500 -mt-0.5">
              Income-tax research
            </div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav
        className={cn(
          "relative flex-1 space-y-1 overflow-y-auto chat-scrollbar",
          collapsed ? "px-2 py-3" : "p-3",
        )}
      >
        {!collapsed && (
          <div className="px-2 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Workspace
          </div>
        )}
        {nav.map((n) => {
          const active = loc.pathname.startsWith(n.to);
          return (
            <Link
              key={n.to}
              to={n.to}
              onClick={onNavigate}
              title={collapsed ? n.label : undefined}
              aria-label={n.label}
              className={cn(
                "group relative flex items-center rounded-xl text-[13.5px] font-medium transition-all",
                collapsed
                  ? "justify-center p-1.5"
                  : "gap-3 px-2.5 py-2",
                active
                  ? "bg-gradient-to-r from-primary/20 via-primary/10 to-transparent text-slate-900 font-semibold ring-1 ring-primary/35 shadow-sm"
                  : "text-slate-800 hover:bg-primary/[0.07] hover:text-slate-900 hover:ring-1 hover:ring-primary/15",
              )}
            >
              {/* Active-state left accent bar */}
              {active && !collapsed && (
                <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-gradient-to-b from-primary to-violet-500" />
              )}
              <span
                className={cn(
                  "size-8 rounded-lg bg-gradient-to-br ring-1 flex items-center justify-center shrink-0",
                  NAV_TONE_TILE[n.tone],
                )}
              >
                <n.icon className="size-4" />
              </span>
              {!collapsed && (
                <span className="min-w-0 flex-1 truncate">{n.label}</span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer: seat widget + user card */}
      <div
        className={cn(
          "relative border-t border-slate-200/80",
          collapsed ? "p-2" : "p-3 space-y-3",
        )}
      >
        {!collapsed && <SeatWidget />}
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <div className="relative" title={displayName}>
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
        ) : (
          <div className="rounded-xl bg-white ring-1 ring-slate-200 shadow-sm p-2.5 flex items-center gap-2.5">
            <div className="relative shrink-0">
              <div className="absolute -inset-0.5 rounded-full bg-gradient-to-br from-primary to-violet-500 opacity-60 blur-sm" />
              <div className="relative size-9 rounded-full bg-gradient-to-br from-primary to-violet-600 text-white flex items-center justify-center text-[13px] font-semibold uppercase ring-2 ring-white">
                {firstLetter}
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div
                className="text-[13px] font-semibold truncate text-slate-900"
                title={session?.username && displayName !== session.username ? `@${session.username}` : undefined}
              >
                {displayName}
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
        )}
      </div>
    </>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const current = NAV.find((n) => loc.pathname.startsWith(n.to));
  const [mobileOpen, setMobileOpen] = useState(false);
  // Desktop sidebar collapsed state — persisted so it survives page reloads
  // and route changes. Default is expanded.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("bt_sidebar_collapsed_v1") === "1";
    } catch {
      return false;
    }
  });
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const nxt = !c;
      try {
        localStorage.setItem("bt_sidebar_collapsed_v1", nxt ? "1" : "0");
      } catch {
        /* */
      }
      return nxt;
    });
  };

  // Close the drawer whenever the route changes.
  useEffect(() => {
    setMobileOpen(false);
  }, [loc.pathname]);

  return (
    // h-screen + overflow-hidden pins the shell to the viewport so the sidebar and
    // header stay fixed and ONLY <main> scrolls (previously min-h-screen let the
    // whole page grow, scrolling the body — sidebar and all).
    <div className="h-screen flex bg-background overflow-hidden">
      {/* Desktop sidebar — collapses to a 4rem icon rail when the header
          toggle is clicked. The width is animated so the transition feels
          intentional. */}
      <aside
        className={cn(
          "hidden md:flex shrink-0 relative overflow-hidden bt-sidebar-bg text-slate-800 border-r border-slate-200 flex-col transition-[width] duration-200 ease-out",
          collapsed ? "w-16" : "w-60 lg:w-64",
        )}
      >
        <SidebarBody collapsed={collapsed} />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 z-40 bg-black/50"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="md:hidden fixed inset-y-0 left-0 z-50 w-72 max-w-[85%] relative overflow-hidden bt-sidebar-bg text-slate-800 border-r border-slate-200 flex flex-col shadow-2xl">
            <div className="md:hidden flex items-center justify-end px-3 py-2 border-b border-white/10">
              <button
                onClick={() => setMobileOpen(false)}
                className="p-2 rounded-md text-sidebar-foreground/85 hover:bg-white/10 hover:text-white"
                aria-label="Close menu"
              >
                <X className="size-4" />
              </button>
            </div>
            <SidebarBody onNavigate={() => setMobileOpen(false)} />
          </aside>
        </>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 sm:h-16 shrink-0 bt-header-glass flex items-center px-3 sm:px-6 lg:px-8 gap-2 sticky top-0 z-30">
          <button
            onClick={() => setMobileOpen(true)}
            className="md:hidden p-2 rounded-md hover:bg-slate-100 text-slate-700"
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </button>
          {/* Desktop collapse toggle — hides the sidebar to an icon rail
              (or expands it back). Persisted in localStorage. */}
          <button
            onClick={toggleCollapsed}
            className="hidden md:inline-flex p-2 rounded-md hover:bg-slate-100 text-slate-600 hover:text-primary transition-colors"
            aria-label={collapsed ? "Show sidebar" : "Hide sidebar"}
            title={collapsed ? "Show sidebar" : "Hide sidebar"}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-5" />
            ) : (
              <PanelLeftClose className="size-5" />
            )}
          </button>
          <h1 className="text-base font-semibold text-foreground truncate">
            {current?.label ?? "BharathTax"}
          </h1>
          <div className="ml-auto hidden sm:flex items-center gap-2 text-xs text-slate-500">
            <span className="inline-block size-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.20)]" />
            Citation-grounded · primary Indian tax law
          </div>
        </header>
        <main className="flex-1 min-h-0 overflow-auto bt-app-bg">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-5">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
