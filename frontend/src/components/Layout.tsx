import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { MessageSquareText, FileText, Clock, ShieldCheck, LogOut, Scale, Gavel, BookOpen } from "lucide-react";
import { api, SeatUsage } from "../api";
import { useAuth } from "../auth";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/ask", label: "Ask Bot", icon: MessageSquareText },
  { to: "/appeals", label: "Appeals", icon: Gavel },
  { to: "/rulings", label: "Rulings", icon: BookOpen },
  { to: "/documents", label: "Documents", icon: FileText },
  { to: "/history", label: "History", icon: Clock },
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

export default function Layout({ children }: { children: ReactNode }) {
  const { session, logout } = useAuth();
  const loc = useLocation();
  const nav = NAV.filter((n) => !n.roles || (session && n.roles.includes(session.role)));
  const current = nav.find((n) => loc.pathname.startsWith(n.to));

  return (
    <div className="min-h-screen flex bg-background">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 bg-sidebar text-sidebar-foreground flex flex-col">
        <div className="h-16 flex items-center gap-2 px-5 border-b border-white/10">
          <Scale className="size-6 text-primary" />
          <span className="font-semibold text-lg tracking-tight">BharathTax</span>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {nav.map((n) => {
            const active = loc.pathname.startsWith(n.to);
            return (
              <Link key={n.to} to={n.to}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active ? "bg-primary text-primary-foreground" : "text-sidebar-foreground/80 hover:bg-white/5 hover:text-white"
                )}>
                <n.icon className="size-4" /> {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 space-y-3 border-t border-white/10">
          <SeatWidget />
          <div className="flex items-center justify-between gap-2 px-1">
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{session?.username}</div>
              <div className="text-xs text-sidebar-foreground/60 capitalize">{session?.role?.replace("_", " ")}</div>
            </div>
            <button onClick={logout} title="Logout"
              className="text-sidebar-foreground/70 hover:text-white p-2 rounded-md hover:bg-white/5">
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 shrink-0 bg-card border-b flex items-center px-8">
          <h1 className="text-base font-semibold text-foreground">{current?.label ?? "BharathTax"}</h1>
          <div className="ml-auto text-xs text-muted-foreground">
            Citation-grounded · primary Indian tax law
          </div>
        </header>
        <main className="flex-1 overflow-auto">
          <div className="max-w-5xl mx-auto px-8 py-7">{children}</div>
        </main>
      </div>
    </div>
  );
}
