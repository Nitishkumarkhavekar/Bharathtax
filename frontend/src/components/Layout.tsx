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
  BookOpen,
  Menu,
  X,
  UserCircle2,
  Coins,
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
  tone: NavTone;
  hint: string;
}[] = [
  { to: "/ask", label: "Ask Bot", icon: MessageSquareText, tone: "primary", hint: "Citation-grounded chat" },
  { to: "/appeals", label: "Appeals", icon: Gavel, tone: "amber", hint: "Draft CIT(A) orders" },
  { to: "/rulings", label: "Rulings", icon: BookOpen, tone: "violet", hint: "Case-law search" },
  { to: "/documents", label: "Documents", icon: FileText, tone: "sky", hint: "Upload · summarise" },
  { to: "/history", label: "History", icon: Clock, tone: "emerald", hint: "Past queries" },
  { to: "/tokens", label: "Token Usage", icon: Coins, tone: "rose", hint: "Your AI spend" },
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
  const pct = usage.limit ? Math.min(100, Math.round((usage.used / usage.limit) * 100)) : 0;
  return (
    <div
      className="px-3 py-2 rounded-lg bg-white ring-1 ring-slate-200"
      title="Live seat pool for your wing"
    >
      <div className="flex justify-between text-[11px] text-slate-500 mb-1">
        <span className="font-medium text-slate-700">Wing seats</span>
        <span className="tabular-nums">
          {usage.used}/{usage.limit}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary to-violet-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  const { session, logout } = useAuth();
  const loc = useLocation();
  const nav = NAV.filter((n) => !n.roles || (session && n.roles.includes(session.role)));
  const firstLetter = (session?.username || "?").slice(0, 1).toUpperCase();
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
      <div className="relative h-16 flex items-center gap-2.5 px-5 border-b border-slate-200/80">
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
          <div className="text-[10.5px] text-slate-500 -mt-0.5">
            Income-tax research
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="relative flex-1 p-3 space-y-1 overflow-y-auto chat-scrollbar">
        <div className="px-2 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">
          Workspace
        </div>
        {nav.map((n) => {
          const active = loc.pathname.startsWith(n.to);
          return (
            <Link
              key={n.to}
              to={n.to}
              onClick={onNavigate}
              className={cn(
                "group relative flex items-center gap-3 rounded-xl px-2.5 py-2 text-[13.5px] font-medium transition-all",
                active
                  ? "bg-gradient-to-r from-primary/20 via-primary/10 to-transparent text-slate-900 font-semibold ring-1 ring-primary/35 shadow-sm"
                  : "text-slate-800 hover:bg-primary/[0.07] hover:text-slate-900 hover:ring-1 hover:ring-primary/15",
              )}
            >
              {/* Active-state left accent bar */}
              {active && (
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
              <span className="min-w-0 flex-1 truncate">{n.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer: seat widget + user card */}
      <div className="relative border-t border-slate-200/80 p-3 space-y-3">
        <SeatWidget />
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
    </>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const current = NAV.find((n) => loc.pathname.startsWith(n.to));
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the drawer whenever the route changes.
  useEffect(() => {
    setMobileOpen(false);
  }, [loc.pathname]);

  return (
    <div className="min-h-screen flex bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 lg:w-64 shrink-0 relative overflow-hidden bt-sidebar-bg text-slate-800 border-r border-slate-200 flex-col">
        <SidebarBody />
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
            className="md:hidden p-2 rounded-md hover:bg-slate-100"
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </button>
          <h1 className="text-base font-semibold text-foreground truncate">
            {current?.label ?? "BharathTax"}
          </h1>
          <div className="ml-auto hidden sm:flex items-center gap-2 text-xs text-slate-500">
            <span className="inline-block size-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.20)]" />
            Citation-grounded · primary Indian tax law
          </div>
        </header>
        <main className="flex-1 overflow-auto bt-app-bg">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
