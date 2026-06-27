import { NavLink, Outlet } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  Brain,
  Server,
  IndianRupee,
  KeyRound,
  LogOut,
  Scale,
} from "lucide-react";
import { useAuth } from "@/auth";
import { cn } from "@/lib/utils";

const NAV: {
  to: string;
  label: string;
  icon: typeof Users;
  super?: boolean;
  desc?: string;
}[] = [
  { to: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard, desc: "Overview" },
  { to: "/admin/users", label: "User Management", icon: Users, desc: "Officers & auditors" },
  { to: "/admin/admins", label: "Admin Management", icon: ShieldCheck, desc: "Super & wing admins" },
  { to: "/admin/model", label: "Model Management", icon: Brain, desc: "LLM models & metrics" },
  { to: "/admin/server", label: "Model Server", icon: Server, desc: "System health" },
  { to: "/admin/revenue", label: "Revenue Management", icon: IndianRupee, super: true, desc: "Sales ledger" },
  { to: "/admin/licenses", label: "License Keys", icon: KeyRound, super: true, desc: "Issue & revoke" },
];

export default function AdminLayout() {
  const { session, logout } = useAuth();
  const isSuper = session?.role === "super_admin";
  const items = NAV.filter((n) => !n.super || isSuper);

  return (
    <div className="h-screen w-screen flex bg-slate-50 overflow-hidden">
      {/* Left rail — dark, sticky, full height */}
      <aside className="hidden md:flex w-72 shrink-0 bg-sidebar text-sidebar-foreground flex-col border-r border-white/5">
        {/* Brand */}
        <div className="h-16 flex items-center gap-2.5 px-5 border-b border-white/10">
          <div className="size-9 rounded-lg bg-primary/15 ring-1 ring-primary/30 flex items-center justify-center">
            <Scale className="size-4 text-primary" />
          </div>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-tight text-white">BharathTax</div>
            <div className="text-[11px] text-sidebar-foreground/80 -mt-0.5">Admin console</div>
          </div>
        </div>

        {/* Role chip */}
        <div className="px-4 pt-4 pb-2">
          <div
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium",
              isSuper
                ? "bg-rose-500/15 text-rose-200 ring-1 ring-rose-500/20"
                : "bg-amber-500/15 text-amber-200 ring-1 ring-amber-500/20",
            )}
          >
            <ShieldCheck className="size-3.5" />
            {isSuper ? "Super Admin" : "Wing Admin"}
            <span className="ml-auto text-[10.5px] text-sidebar-foreground/60">
              @{session?.username}
            </span>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto chat-scrollbar p-3 space-y-1">
          {items.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                cn(
                  "group flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-sidebar-foreground/95 hover:bg-white/10 hover:text-white",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <n.icon
                    className={cn(
                      "size-4 mt-0.5 shrink-0",
                      isActive ? "text-primary-foreground" : "text-sidebar-foreground/90",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-medium leading-snug">{n.label}</div>
                    {n.desc && (
                      <div
                        className={cn(
                          "text-[11px] mt-0.5 leading-tight",
                          isActive ? "text-primary-foreground/90" : "text-sidebar-foreground/70",
                        )}
                      >
                        {n.desc}
                      </div>
                    )}
                  </div>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-white/10 px-4 py-3 flex items-center gap-2">
          <div className="size-8 rounded-full bg-gradient-to-br from-primary to-primary/60 text-white flex items-center justify-center text-xs font-semibold uppercase">
            {session?.username?.[0] ?? "?"}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-white truncate">{session?.username}</div>
            <div className="text-[11px] text-sidebar-foreground/80 capitalize">
              {session?.role?.replace("_", " ")}
            </div>
          </div>
          <button
            onClick={logout}
            title="Logout"
            className="p-2 rounded-md text-sidebar-foreground/85 hover:bg-white/10 hover:text-white"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex-1 min-w-0 h-full flex flex-col">
        {/* Top bar */}
        <header className="h-16 shrink-0 bg-white border-b border-slate-200 flex items-center px-6 gap-4">
          <div className="md:hidden flex items-center gap-2">
            <div className="size-8 rounded-lg bg-primary/15 ring-1 ring-primary/30 flex items-center justify-center">
              <Scale className="size-4 text-primary" />
            </div>
            <span className="font-semibold text-sm">BharathTax</span>
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900">Admin Console</div>
            <div className="text-[11px] text-slate-500">
              Manage users, models, server, revenue and licensing
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={logout}
              className="md:hidden p-2 rounded-md text-slate-500 hover:bg-slate-100"
              title="Logout"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </header>

        {/* Content (scrolls) */}
        <main className="flex-1 overflow-y-auto admin-bg">
          <div className="mx-auto max-w-7xl px-6 py-7">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
