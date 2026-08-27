import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  MessageSquareText,
  SquarePen,
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
  // Chat is the flagship — it gets a prominent "New chat" button at the very
  // top of the sidebar (rendered separately), so it's the hero action rather
  // than one row in a list.
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, tone: "primary", hint: "Your caseload at a glance" },
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
  const hasChat = isAdmin || !feats || feats.includes("chat");
  const nav = NAV.filter(
    (n) =>
      n.to !== "/profile" && // account lives in the footer card, not the nav
      (!n.roles || (session && n.roles.includes(session.role))) &&
      (!n.feature || isAdmin || !feats || feats.includes(n.feature)),
  );
  // Two clean, always-visible sections: a PRIMARY list (the officer's most-used
  // pages — wing-ordered when they've picked a function) and a TOOLS list. No
  // hiding behind a default-collapsed drawer; the icons carry the hierarchy.
  const ws = resolveWorkspace(session?.workspaceProfile, session?.workspaceWings);
  const scoped = ws.scoped;
  const toolPaths = new Set(nav.filter((n) => n.group === "tools").map((n) => n.to));

  let primaryList: typeof nav;
  let secondaryList: typeof nav;
  let primaryLabel: string | null;
  const secondaryLabel = "Tools";
  if (scoped) {
    // Officer's function first: Dashboard, their wing tools, then Chat/Calendar,
    // then any remaining primary pages. Tools stay in the Tools group below.
    const order = ["/dashboard", ...ws.tools.filter((p) => !toolPaths.has(p)), "/workspace"];
    const seen = new Set<string>();
    primaryList = order
      .map((p) => nav.find((n) => n.to === p))
      .filter((n): n is (typeof nav)[number] => !!n);
    primaryList.forEach((n) => seen.add(n.to));
    nav.forEach((n) => { if (n.group !== "tools" && !seen.has(n.to)) { primaryList.push(n); seen.add(n.to); } });
    // Tools: the tool-group, wing tools first.
    const wingTools = ws.tools.filter((p) => toolPaths.has(p));
    const tOrder = [...wingTools, ...nav.filter((n) => n.group === "tools").map((n) => n.to)];
    const tSeen = new Set<string>();
    secondaryList = tOrder
      .map((p) => nav.find((n) => n.to === p && n.group === "tools"))
      .filter((n): n is (typeof nav)[number] => !!n && !tSeen.has(n.to) && (tSeen.add(n.to), true));
    primaryLabel = "Your workspace";
  } else {
    primaryList = nav.filter((n) => n.group !== "tools");
    secondaryList = nav.filter((n) => n.group === "tools");
    primaryLabel = null;
  }

  const renderItem = (n: (typeof nav)[number]) => {
    const active = loc.pathname.startsWith(n.to);
    return (
      <Link
        key={n.to}
        to={n.to}
        data-tour={n.to}
        onClick={onNavigate}
        title={collapsed ? n.label : undefined}
        aria-label={n.label}
        className={cn(
          "group flex items-center rounded-lg text-[13.5px] transition-colors",
          collapsed ? "justify-center p-2" : "gap-2.5 px-2.5 py-[7px]",
          active
            ? "bg-primary/10 text-primary font-semibold"
            : "text-slate-600 font-medium hover:bg-slate-100 hover:text-slate-900",
        )}
      >
        <n.icon className={cn("size-[18px] shrink-0", active ? "text-primary" : "text-slate-400 group-hover:text-slate-600")} />
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
  // the nav sinks to a pinned strip at the bottom.
  const slot = useSidebarSlotContent();

  const SectionLabel = ({ children }: { children: ReactNode }) => (
    <div className="px-2.5 pt-3 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-slate-400">{children}</div>
  );

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

      {/* New chat — the flagship action, top of the sidebar. A dark pill
          (ChatGPT style) that starts a fresh chat from anywhere; collapses to
          an icon on the rail. Hidden only if the user lacks chat access. */}
      {hasChat && (
        <div className={cn("relative", collapsed ? "px-2 pt-3" : "px-2.5 pt-3")}>
          <Link
            to="/ask"
            data-tour="new-chat"
            onClick={onNavigate}
            title="New chat"
            aria-label="New chat"
            className={cn(
              "inline-flex items-center justify-center gap-2 rounded-lg text-white bg-slate-900 hover:bg-slate-800 shadow-sm ring-1 ring-black/30 transition-colors font-semibold",
              collapsed ? "size-9 mx-auto" : "w-full h-10 text-[13.5px]",
            )}
          >
            <SquarePen className="size-4" strokeWidth={1.9} />
            {!collapsed && <span>New chat</span>}
          </Link>
        </div>
      )}

      {/* Slot — feature pages inject a panel here (e.g. "Your drafts").
          When populated it takes the flex-1 area so the panel scrolls; the
          Workspace nav becomes a compact strip pinned below it. Hidden when
          the sidebar is collapsed to the icon rail. */}
      {slot && !collapsed && (
        <div className="relative flex-1 min-h-0 overflow-hidden border-b border-slate-200/80">
          {slot}
        </div>
      )}

      {/* Nav — a PRIMARY list and a TOOLS list, both always visible. The
          primary list is wing-ordered when the officer has picked a function;
          nothing is hidden behind a drawer. The icon rail shows the same order
          with a hairline divider between the two groups. */}
      <nav
        className={cn(
          "relative overflow-y-auto chat-scrollbar",
          slot && !collapsed ? "shrink-0 max-h-[42vh]" : "flex-1",
          collapsed ? "px-2 py-3 space-y-1" : "px-2.5 py-2.5 space-y-0.5",
        )}
      >
        {!collapsed && primaryLabel && <SectionLabel>{primaryLabel}</SectionLabel>}
        {primaryList.map((n) => renderItem(n))}

        {secondaryList.length > 0 && (
          collapsed
            ? <div className="my-1.5 mx-auto h-px w-6 bg-slate-200" />
            : <SectionLabel>{secondaryLabel}</SectionLabel>
        )}
        {secondaryList.map((n) => renderItem(n))}
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
            <span data-tour="bell" className="inline-flex"><NotificationBell /></span>
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
