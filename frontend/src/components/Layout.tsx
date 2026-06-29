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
} from "lucide-react";
import { api, SeatUsage } from "../api";
import { useAuth } from "../auth";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/ask", label: "Ask Bot", icon: MessageSquareText },
  { to: "/appeals", label: "Appeals", icon: Gavel },
  { to: "/rulings", label: "Rulings", icon: BookOpen },
  { to: "/documents", label: "Documents", icon: FileText },
  { to: "/history", label: "History", icon: Clock },
  { to: "/profile", label: "Profile", icon: UserCircle2 },
  { to: "/admin", label: "Admin", icon: ShieldCheck, roles: ["super_admin", "wing_admin"] },
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
  const pct = usage.limit ? Math.min(100, Math.round((usage.used / usage.limit) * 100)) : 0;
  return (
    <div className="px-3 py-2 rounded-md bg-white/5" title="Live seat pool for your wing">
      <div className="flex justify-between text-xs text-sidebar-foreground/70 mb-1">
        <span>Wing seats</span><span>{usage.used}/{usage.limit}</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function SidebarBody({ onNavigate }: { onNavigate?: () => void }) {
  const { session, logout } = useAuth();
  const loc = useLocation();
  const nav = NAV.filter((n) => !n.roles || (session && n.roles.includes(session.role)));
  return (
    <>
      <div className="h-16 flex items-center gap-2 px-5 border-b border-white/10">
        <Scale className="size-6 text-primary" />
        <span className="font-semibold text-lg tracking-tight">BharathTax</span>
      </div>
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto chat-scrollbar">
        {nav.map((n) => {
          const active = loc.pathname.startsWith(n.to);
          return (
            <Link
              key={n.to}
              to={n.to}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-sidebar-foreground/90 hover:bg-white/8 hover:text-white",
              )}
            >
              <n.icon className="size-4" /> {n.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 space-y-3 border-t border-white/10">
        <SeatWidget />
        <div className="flex items-center justify-between gap-2 px-1">
          <div className="min-w-0">
            <div className="text-sm font-medium truncate text-white">{session?.username}</div>
            <div className="text-xs text-sidebar-foreground/70 capitalize">
              {session?.role?.replace("_", " ")}
            </div>
          </div>
          <button
            onClick={logout}
            title="Logout"
            className="text-sidebar-foreground/80 hover:text-white p-2 rounded-md hover:bg-white/8"
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
      <aside className="hidden md:flex w-60 lg:w-64 shrink-0 bg-sidebar text-sidebar-foreground flex-col">
        <SidebarBody />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 z-40 bg-black/50"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="md:hidden fixed inset-y-0 left-0 z-50 w-72 max-w-[85%] bg-sidebar text-sidebar-foreground flex flex-col shadow-2xl">
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
        <header className="h-14 sm:h-16 shrink-0 bg-card border-b flex items-center px-3 sm:px-6 lg:px-8 gap-2">
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
          <div className="ml-auto hidden sm:block text-xs text-muted-foreground">
            Citation-grounded · primary Indian tax law
          </div>
        </header>
        <main className="flex-1 overflow-auto">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-7">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
