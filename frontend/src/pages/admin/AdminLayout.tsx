import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  Brain,
  Server,
  IndianRupee,
  KeyRound,
  LogOut,
  Menu,
  X,
  Coins,
  Sparkles,
  Tag,
  CreditCard,
  Package,
  LifeBuoy,
  Mail,
  MonitorSmartphone,
  PanelLeftClose,
  PanelLeftOpen,
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
  { to: "/admin/users", label: "User Management", icon: Users, desc: "All user accounts" },
  { to: "/admin/admins", label: "Admin Management", icon: ShieldCheck, desc: "Super & wing admins" },
  { to: "/admin/model", label: "Model Management", icon: Brain, desc: "LLM models & metrics" },
  { to: "/admin/tokens", label: "Token Usage", icon: Coins, desc: "Per-user token spend" },
  { to: "/admin/gemini", label: "Gemini API", icon: Sparkles, desc: "Web-search backend health" },
  { to: "/admin/pricing", label: "Pricing Management", icon: Tag, desc: "Plans & token rates" },
  { to: "/admin/billing", label: "User Billing", icon: CreditCard, desc: "Assign plans, watch balances" },
  { to: "/admin/releases", label: "Release Management", icon: Package, desc: "Desktop app releases & auto-update" },
  { to: "/admin/support", label: "Support Tickets", icon: LifeBuoy, desc: "Officer-reported issues" },
  { to: "/admin/contact", label: "Leads", icon: Mail, desc: "New leads from the website contact form — newest first" },
  { to: "/admin/desktop-logs", label: "Desktop User Logs", icon: MonitorSmartphone, desc: "Who used the desktop app and when" },
  { to: "/admin/server", label: "Model Server", icon: Server, desc: "System health" },
  { to: "/admin/revenue", label: "Revenue Management", icon: IndianRupee, super: true, desc: "Sales ledger" },
  { to: "/admin/licenses", label: "License Keys", icon: KeyRound, super: true, desc: "Issue & revoke" },
];

function Rail({
  isSuper,
  items,
  session,
  logout,
  onNavigate,
  onClose,
  collapsed = false,
}: {
  isSuper: boolean;
  items: typeof NAV;
  session: ReturnType<typeof useAuth>["session"];
  logout: () => void;
  onNavigate?: () => void;
  onClose?: () => void;
  collapsed?: boolean;
}) {
  return (
    <>
      {/* Brand — top banner of the (now white) sidebar. The logo PNG carries
          a lot of transparent padding around the wordmark, so we render it
          at a larger height than the banner and clip with overflow-hidden. */}
      <div
        className={cn(
          "h-20 flex items-center bg-white border-b border-slate-100 relative z-10 overflow-hidden",
          collapsed ? "justify-center px-2" : "px-4",
        )}
      >
        {collapsed ? (
          // Collapsed rail — just the "h" mark from favicon.png.
          <img
            src="/favicon.png"
            alt="BharatTax"
            className="h-12 w-12 object-contain select-none"
            draggable={false}
          />
        ) : (
          // Expanded — full transparent wordmark. h-40 with parent
          // overflow-hidden clips the PNG's built-in vertical padding, so
          // the actual logo content fills the banner instead of floating
          // small in the corner.
          <img
            src="/bharattax-logo-transparent.png"
            alt="BharatTax"
            className="h-40 w-auto max-w-full object-contain object-left select-none shrink-0"
            draggable={false}
          />
        )}
        {onClose && !collapsed && (
          <button
            onClick={onClose}
            className="md:hidden shrink-0 ml-auto p-2 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            aria-label="Close menu"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* Role chip — soft rose/amber wash on white, ring for contrast. */}
      {collapsed ? (
        <div className="flex justify-center pt-4 pb-2">
          <div
            title={`${isSuper ? "Super Admin" : "Wing Admin"} · @${session?.username}`}
            className={cn(
              "size-9 rounded-lg flex items-center justify-center",
              isSuper
                ? "bg-rose-50 text-rose-600 ring-1 ring-rose-200"
                : "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
            )}
          >
            <ShieldCheck className="size-4" />
          </div>
        </div>
      ) : (
        <div className="px-4 pt-4 pb-2">
          <div
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium",
              isSuper
                ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200"
                : "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
            )}
          >
            <ShieldCheck className="size-3.5" />
            {isSuper ? "Super Admin" : "Wing Admin"}
            <span className="ml-auto text-[10.5px] text-slate-500">
              @{session?.username}
            </span>
          </div>
        </div>
      )}

      {/* Nav — light theme. Active = navy pill with white text; inactive =
          slate text with a soft primary hover wash. */}
      <nav
        className={cn(
          "flex-1 overflow-y-auto chat-scrollbar space-y-1",
          collapsed ? "px-2 py-3" : "p-3",
        )}
      >
        {items.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            onClick={onNavigate}
            title={collapsed ? n.label : undefined}
            className={({ isActive }) =>
              cn(
                "group flex rounded-lg transition-colors",
                collapsed
                  ? "items-center justify-center p-2.5"
                  : "items-start gap-3 px-3 py-2.5",
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-slate-700 hover:bg-primary/5 hover:text-primary",
              )
            }
          >
            {({ isActive }) => (
              <>
                <n.icon
                  className={cn(
                    "size-4 shrink-0",
                    collapsed ? "" : "mt-0.5",
                    isActive ? "text-primary-foreground" : "text-slate-500 group-hover:text-primary",
                  )}
                />
                {!collapsed && (
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-medium leading-snug">{n.label}</div>
                    {n.desc && (
                      <div
                        className={cn(
                          "text-[11px] mt-0.5 leading-tight",
                          isActive ? "text-primary-foreground/90" : "text-slate-500",
                        )}
                      >
                        {n.desc}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div
        className={cn(
          "border-t border-slate-200 py-3 flex items-center",
          collapsed ? "flex-col gap-2 px-2" : "gap-2 px-4",
        )}
      >
        <div
          title={collapsed ? `${session?.username} · ${session?.role?.replace("_", " ")}` : undefined}
          className="size-8 rounded-full bg-primary text-white flex items-center justify-center text-xs font-semibold uppercase shrink-0"
        >
          {session?.username?.[0] ?? "?"}
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-slate-900 truncate">{session?.username}</div>
            <div className="text-[11px] text-slate-500 capitalize">
              {session?.role?.replace("_", " ")}
            </div>
          </div>
        )}
        <button
          onClick={logout}
          title="Logout"
          className="p-2 rounded-md text-slate-500 hover:bg-slate-100 hover:text-primary"
        >
          <LogOut className="size-4" />
        </button>
      </div>
    </>
  );
}

export default function AdminLayout() {
  const { session, logout } = useAuth();
  const isSuper = session?.role === "super_admin";
  const items = NAV.filter((n) => !n.super || isSuper);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("bt_admin_sidebar_collapsed_v1") === "1",
  );
  const loc = useLocation();

  // Auto-close drawer on route change.
  useEffect(() => {
    setMobileOpen(false);
  }, [loc.pathname]);

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem("bt_admin_sidebar_collapsed_v1", next ? "1" : "0");
      return next;
    });
  }

  return (
    <div className="h-screen w-screen flex bg-slate-50 overflow-hidden">
      {/* Desktop rail — light theme (white sidebar, slate text, primary accents). */}
      <aside
        className={cn(
          "hidden md:flex shrink-0 bg-white text-slate-800 flex-col border-r border-slate-200 transition-[width] duration-200",
          collapsed ? "w-16" : "w-64 lg:w-72",
        )}
      >
        <Rail
          isSuper={isSuper}
          items={items}
          session={session}
          logout={logout}
          collapsed={collapsed}
        />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 z-40 bg-black/55"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="md:hidden fixed inset-y-0 left-0 z-50 w-72 max-w-[85%] bg-white text-slate-800 flex flex-col shadow-2xl border-r border-slate-200">
            <Rail
              isSuper={isSuper}
              items={items}
              session={session}
              logout={logout}
              onNavigate={() => setMobileOpen(false)}
              onClose={() => setMobileOpen(false)}
            />
          </aside>
        </>
      )}

      {/* Main column */}
      <div className="flex-1 min-w-0 h-full flex flex-col">
        <header className="h-14 sm:h-16 shrink-0 bg-white border-b border-slate-200 flex items-center px-3 sm:px-6 gap-3">
          <button
            onClick={() => setMobileOpen(true)}
            className="md:hidden p-2 rounded-md text-slate-700 hover:bg-slate-100"
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </button>
          <button
            onClick={toggleCollapsed}
            className="hidden md:inline-flex p-2 rounded-md text-slate-600 hover:bg-slate-100"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-5" />
            ) : (
              <PanelLeftClose className="size-5" />
            )}
          </button>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900 truncate">Admin Console</div>
            <div className="text-[11px] text-slate-500 truncate hidden sm:block">
              Manage users, models, server, revenue and licensing
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={logout}
              className="md:hidden p-2 rounded-md text-slate-600 hover:bg-slate-100"
              title="Logout"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto admin-bg">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 py-5 sm:py-7">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
