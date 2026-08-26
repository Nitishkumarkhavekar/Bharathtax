import { Fragment, ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  MessageSquareText,
  Clock,
  ShieldCheck,
  LogOut,
  ScrollText,
  CalendarClock,
  LayoutDashboard,
  Calculator,
  FileText,
  Bookmark,
  Scale,
  BookOpen,
  Menu,
  X,
  HelpCircle,
  UserCircle2,
  ChevronDown,
  PanelLeft,
} from "lucide-react";
import { api, SeatUsage } from "../api";
import { useAuth } from "../auth";
import { cn } from "@/lib/utils";
import { SidebarSlotProvider, useSidebarSlotContent } from "./SidebarSlot";
import { resolveWorkspace } from "@/lib/workspaceProfiles";
import WorkspaceProfilePrompt from "./WorkspaceProfilePrompt";
import NotificationBell from "./NotificationBell";
import AppTour from "./AppTour";

type NavTone = "primary" | "amber" | "violet" | "sky" | "emerald" | "rose" | "indigo" | "slate";
const NAV: {
  to: string;
  label: string;
  icon: typeof MessageSquareText;
  roles?: string[];
  feature?: string;   // gateable module key; hidden unless the user is allotted it
  tone: NavTone;
  hint: string;
  group?: "tools";    // renders under a "Tools" subheader
}[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, tone: "primary", hint: "Your caseload at a glance" },
  { to: "/ask", label: "Chat", icon: MessageSquareText, feature: "chat", tone: "primary", hint: "Citation-grounded chat" },
  { to: "/workspace", label: "Calendar", icon: CalendarClock, tone: "primary", hint: "Matters, deadlines & reminders" },
  { to: "/drafting", label: "Drafting", icon: ScrollText, tone: "rose", hint: "Orders, appeals & notices" },
  { to: "/rulings", label: "Rulings", icon: BookOpen, feature: "rulings", tone: "violet", hint: "Case-law search" },
  { to: "/history", label: "History", icon: Clock, feature: "history", tone: "emerald", hint: "Past queries" },
  { to: "/calculators", label: "Calculators", icon: Calculator, tone: "primary", hint: "Interest & tax", group: "tools" },
  { to: "/templates", label: "Templates", icon: FileText, tone: "amber", hint: "Reusable drafts", group: "tools" },
  { to: "/watchlists", label: "Watchlists", icon: Bookmark, tone: "emerald", hint: "Track sections & rulings", group: "tools" },
  { to: "/reconcile", label: "Reconcile", icon: Scale, tone: "primary", hint: "AIS / 26AS matching", group: "tools" },
  { to: "/profile", label: "Profile", icon: UserCircle2, tone: "indigo", hint: "Account settings" },
  { to: "/admin", label: "Admin", icon: ShieldCheck, roles: ["super_admin", "wing_admin"], tone: "slate", hint: "Console" },
];

/** Icon chip — a single primary tint across every nav item. The colour
 *  differentiates action items from body text and from the neutral surface;
 *  we lean on iconography (not hue) to differentiate sections. Admin rows
 *  keep a neutral slate chip so the console reads as "system" area. */
/** Icon-tile styling for the main app sidebar. Rotates across the three
 *  BharatTax logo tones (navy primary, brand-orange, brand-green) so each
 *  workspace section carries a visual anchor from the palette. Mirrors
 *  the ChatSidebar's TONE_TILE so navigating between /ask and other
 *  pages keeps the same coloured chips per tool. */
const NAV_TONE_TILE: Record<NavTone, string> = {
  primary: "bg-primary/10 text-primary",                        // Chat
  amber: "bg-brand-orange/15 text-brand-orange",                // Appeals
  violet: "bg-primary/10 text-primary",                         // Rulings
  sky: "bg-primary/10 text-primary",                            // (legacy)
  emerald: "bg-brand-green/15 text-brand-green",                // History
  rose: "bg-brand-green/15 text-brand-green",                   // Drafting
  indigo: "bg-primary/10 text-primary",                         // Profile
  slate: "bg-slate-100 text-slate-600",                         // Admin
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
          className="h-full rounded-full bg-primary"
          style={{ width: `${unlimited ? 8 : pct}%` }}
        />
      </div>
    </div>
  );
}

function SidebarBody({
  onNavigate,
  collapsed = false,
  onToggleCollapsed,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
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
  // Role-tailored sidebar: when the user has picked a workspace profile, split
  // the nav into "Your workspace" (the function's tools + core) and a
  // collapsible "All tools" with the rest. Soft emphasis — nothing is removed.
  const ws = resolveWorkspace(session?.workspaceProfile, session?.workspaceWings);
  const CORE_PATHS = ["/dashboard", "/ask", "/workspace"]; // for everyone
  let featured: typeof nav = [];
  let rest: typeof nav = nav;
  const scoped = ws.scoped;
  if (scoped) {
    const order = ["/dashboard", ...ws.tools, "/ask", "/workspace"];
    const featuredSet = new Set([...CORE_PATHS, ...ws.tools]);
    featured = order
      .map((p) => nav.find((n) => n.to === p))
      .filter((n): n is (typeof nav)[number] => !!n);
    rest = nav.filter((n) => !featuredSet.has(n.to));
  }

  const renderItem = (n: (typeof nav)[number]) => {
    const active = loc.pathname.startsWith(n.to);
    return (
      <Link
        key={n.to}
        to={n.to}
        onClick={onNavigate}
        title={collapsed ? n.label : undefined}
        aria-label={n.label}
        className={cn(
          "group relative flex items-center rounded-lg text-[13.5px] font-medium transition-colors",
          collapsed ? "justify-center p-1.5" : "gap-3 px-2.5 py-2",
          active ? "bg-primary/10 text-primary font-semibold" : "text-slate-700 hover:bg-slate-100 hover:text-slate-900",
        )}
      >
        {active && !collapsed && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-primary" />}
        <span className={cn("size-8 rounded-lg flex items-center justify-center shrink-0", NAV_TONE_TILE[n.tone])}>
          <n.icon className="size-4" />
        </span>
        {!collapsed && <span className="min-w-0 flex-1 truncate">{n.label}</span>}
      </Link>
    );
  };
  // Prefer the human-facing full name over the login handle so the sidebar
  // and greeting agree ("Hello, Avinash" vs. an initial from "ceo").  Fall
  // back to the username when full_name isn't set on the user record.
  const displayName = session?.fullName?.trim() || session?.username || "";
  const firstLetter = (displayName || "?").slice(0, 1).toUpperCase();
  // A page (e.g. Drafting) may have injected a panel to render at the top
  // of the sidebar. When present, the panel gets the flex-1 scroll space and
  // Workspace nav sinks to a pinned strip at the bottom.
  const slot = useSidebarSlotContent();

  // Persist the Workspace collapse state — default is CLOSED so the sidebar
  // reads as clean chrome and the officer can expand tools on demand.
  const [workspaceOpen, setWorkspaceOpen] = useState<boolean>(() => {
    try { return localStorage.getItem("bt_sidebar_workspace_open_v1") === "1"; }
    catch { return false; }
  });
  const toggleWorkspace = () => {
    setWorkspaceOpen((o) => {
      const nxt = !o;
      try { localStorage.setItem("bt_sidebar_workspace_open_v1", nxt ? "1" : "0"); } catch { /* */ }
      return nxt;
    });
  };
  // Auto-expand once when the current route lives inside the nav — otherwise
  // arriving at a fresh page in a closed sidebar would hide the active pill.
  useEffect(() => {
    if (collapsed) return;
    const active = nav.some((n) => loc.pathname.startsWith(n.to));
    if (active && !workspaceOpen) {
      // Only nudge open the first time we land on a nav route in this
      // session — otherwise we'd fight the officer's explicit collapse.
      try {
        if (localStorage.getItem("bt_sidebar_workspace_open_v1") === null) {
          setWorkspaceOpen(true);
        }
      } catch { /* */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.pathname]);

  return (
    <>
      {/* Brand + sidebar collapse toggle. The toggle sits next to the
          BharatTax mark (right side when expanded, stacked below when
          collapsed) so hiding / showing the sidebar always happens on the
          sidebar itself, not from the main content header. */}
      <div
        className={cn(
          "relative h-20 flex items-center border-b border-slate-200 overflow-hidden",
          collapsed ? "px-0 flex-col justify-center gap-1.5" : "px-3 gap-3",
        )}
      >
        {collapsed ? (
          // Collapsed rail — just the "h" mark from favicon.png (no wordmark).
          <img
            src="/favicon.png"
            alt="BharatTax"
            className="h-12 w-12 object-contain select-none"
            draggable={false}
          />
        ) : (
          // Expanded — transparent-PNG full wordmark. The image ships with
          // generous transparent padding around the wordmark; we render it
          // at h-40 inside an h-20 overflow-hidden banner so the padding
          // gets visually clipped and the wordmark fills the header.
          <img
            src="/bharattax-logo-transparent.png"
            alt="BharatTax"
            className="h-40 w-auto max-w-[calc(100%-3rem)] object-contain object-left select-none shrink-0"
            draggable={false}
          />
        )}
        {onToggleCollapsed && (
          <button
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Show sidebar" : "Hide sidebar"}
            title={collapsed ? "Show sidebar" : "Hide sidebar"}
            className={cn(
              "hidden md:inline-flex items-center justify-center size-8 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors",
              collapsed ? "" : "ml-auto shrink-0",
            )}
          >
            <PanelLeft className="size-4.5" />
          </button>
        )}
      </div>

      {/* Slot — feature pages inject a panel here (e.g. "Your drafts").
          When populated it takes the flex-1 area so the panel scrolls; the
          Workspace nav becomes a compact strip pinned below it. Hidden when
          the sidebar is collapsed to the icon rail. */}
      {slot && !collapsed && (
        <div className="relative flex-1 min-h-0 overflow-hidden border-b border-slate-200/80">
          {slot}
        </div>
      )}

      {/* Nav */}
      <nav
        className={cn(
          "relative space-y-1 overflow-y-auto chat-scrollbar",
          // When a page has injected a slot, cap the Workspace nav so the
          // drafts / thread panel above keeps most of the vertical space.
          slot && !collapsed ? "shrink-0 max-h-[42vh] p-2" : "flex-1",
          collapsed ? "px-2 py-3" : (slot ? "" : "p-3"),
        )}
      >
        {/* Profile-tailored layout: a static "Your workspace" (the function's
            tools) + a collapsible "All tools" with the rest. Falls back to the
            single collapsible "Workspace" list when no profile is picked. On
            the icon rail every item is always shown. */}
        {scoped && !collapsed ? (
          <>
            <div className="px-2 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-500">Your workspace</div>
            <div className="space-y-1 mt-0.5">{featured.map((n) => renderItem(n))}</div>
            {rest.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={toggleWorkspace}
                  aria-expanded={workspaceOpen}
                  aria-controls="sidebar-workspace-list"
                  className="mt-3 w-full flex items-center justify-between px-2 py-1.5 rounded-md text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                >
                  <span>All tools</span>
                  <span className={cn("size-5 rounded-md bg-white ring-1 ring-slate-200 flex items-center justify-center transition-transform duration-200 text-slate-500", workspaceOpen ? "rotate-180" : "rotate-0")} title={workspaceOpen ? "Collapse" : "Expand"}>
                    <ChevronDown className="size-3.5" />
                  </span>
                </button>
                <div id="sidebar-workspace-list" className={cn("overflow-hidden transition-[max-height,opacity,margin] duration-300 ease-out space-y-1", workspaceOpen ? "max-h-[600px] opacity-100 mt-1.5" : "max-h-0 opacity-0 mt-0")}>
                  {rest.map((n) => renderItem(n))}
                </div>
              </>
            )}
          </>
        ) : (
          <>
            {!collapsed && (
              <button
                type="button"
                onClick={toggleWorkspace}
                aria-expanded={workspaceOpen}
                aria-controls="sidebar-workspace-list"
                className="w-full flex items-center justify-between px-2 py-1.5 rounded-md text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
              >
                <span>Workspace</span>
                <span className={cn("size-5 rounded-md bg-white ring-1 ring-slate-200 flex items-center justify-center transition-transform duration-200 text-slate-500", workspaceOpen ? "rotate-180" : "rotate-0")} title={workspaceOpen ? "Collapse" : "Expand"}>
                  <ChevronDown className="size-3.5" />
                </span>
              </button>
            )}
            <div
              id="sidebar-workspace-list"
              className={cn(
                collapsed
                  ? "space-y-1"
                  : cn("overflow-hidden transition-[max-height,opacity,margin] duration-300 ease-out space-y-1", workspaceOpen ? "max-h-[600px] opacity-100 mt-1.5" : "max-h-0 opacity-0 mt-0"),
              )}
            >
              {nav.map((n, i) => {
                const startTools = n.group === "tools" && nav[i - 1]?.group !== "tools";
                return (
                  <Fragment key={n.to}>
                    {startTools && (
                      collapsed
                        ? <div className="my-1.5 mx-auto h-px w-6 bg-slate-200" />
                        : <div className="px-2 pt-3 pb-1 text-[9.5px] font-bold uppercase tracking-[0.16em] text-slate-400">Tools</div>
                    )}
                    {renderItem(n)}
                  </Fragment>
                );
              })}
            </div>
          </>
        )}
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
        ) : (
          <div className="rounded-xl bg-white ring-1 ring-slate-200 shadow-sm p-1.5 flex items-center gap-1">
            <Link
              to="/profile"
              title="Open profile"
              className="flex items-center gap-2.5 min-w-0 flex-1 rounded-lg px-1.5 py-1 hover:bg-slate-50 transition-colors"
            >
              <div className="shrink-0 size-9 rounded-full bg-primary text-white flex items-center justify-center text-[13px] font-semibold uppercase">
                {firstLetter}
              </div>
              <div className="min-w-0 flex-1">
                <div
                  className="text-[13px] font-semibold truncate text-slate-900"
                  title={session?.username && displayName !== session.username ? `@${session.username}` : undefined}
                >
                  {displayName}
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
        )}
      </div>
    </>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <SidebarSlotProvider>
      <LayoutInner>{children}</LayoutInner>
    </SidebarSlotProvider>
  );
}

function LayoutInner({ children }: { children: ReactNode }) {
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

  // First-visit welcome tour — shown once, re-openable from the header help button.
  const [tourOpen, setTourOpen] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem("bt_tour_seen_v1") !== "1") {
        const t = setTimeout(() => setTourOpen(true), 600);
        return () => clearTimeout(t);
      }
    } catch { /* */ }
  }, []);
  const closeTour = () => {
    setTourOpen(false);
    try { localStorage.setItem("bt_tour_seen_v1", "1"); } catch { /* */ }
  };

  return (
    // h-screen + overflow-hidden pins the shell to the viewport so the sidebar and
    // header stay fixed and ONLY <main> scrolls (previously min-h-screen let the
    // whole page grow, scrolling the body — sidebar and all).
    <div className="h-screen flex bg-background overflow-hidden">
      <WorkspaceProfilePrompt />
      {/* Desktop sidebar — collapses to a 4rem icon rail when the header
          toggle is clicked. The width is animated so the transition feels
          intentional. */}
      <aside
        className={cn(
          "hidden md:flex shrink-0 relative overflow-hidden bt-sidebar-bg text-slate-800 border-r border-slate-200 flex-col transition-[width] duration-200 ease-out",
          // Uniform width across the whole app: main sidebar, chat sidebar
          // and admin sidebar all render at `w-60 lg:w-64` when expanded,
          // `w-16` when collapsed. Keep the two variants at the same width
          // so navigating between /ask (with slot) and /rulings (no slot)
          // doesn't shift layout under the user.
          collapsed
            ? "w-16"
            : "w-60 lg:w-64",
        )}
      >
        <SidebarBody collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 z-40 bg-black/50"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="md:hidden fixed inset-y-0 left-0 z-50 w-72 max-w-[85%] relative overflow-hidden bt-sidebar-bg text-slate-800 border-r border-slate-200 flex flex-col shadow-2xl">
            <div className="md:hidden flex items-center justify-end px-3 py-2 border-b border-slate-200">
              <button
                onClick={() => setMobileOpen(false)}
                className="p-2 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800"
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
          {/* Sidebar collapse toggle lives inside the sidebar itself
              (next to the BharatTax mark) — no duplicate control here. */}
          <h1 className="text-base font-semibold text-foreground truncate">
            {current?.label ?? "BharatTax"}
          </h1>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500">
              <span className="inline-block size-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.20)]" />
              Citation-grounded · primary Indian tax law
            </div>
            <button
              onClick={() => setTourOpen(true)}
              title="Take the tour" aria-label="Take the tour"
              className="inline-flex items-center justify-center size-9 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
            >
              <HelpCircle className="size-[18px]" />
            </button>
            <NotificationBell />
          </div>
        </header>
        <main className="flex-1 min-h-0 overflow-auto bt-app-bg">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-5">
            {children}
          </div>
        </main>
      </div>
      <AppTour open={tourOpen} onClose={closeTour} />
    </div>
  );
}
