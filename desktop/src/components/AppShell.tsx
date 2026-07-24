import { useEffect, useMemo, useState } from "react";
import logoUrl from "../assets/income_tax_logo.png";
import { api, type AppealCase } from "../api";
import UpdateBanner from "./UpdateBanner";

// The primary chrome for the app after sign-in.  A collapsible sidebar on
// the left carries the Income-Tax Department mark, the nav actions
// (Dashboard, New Appeal, Appeals dropdown, Sign out) and a signed-in
// footer; the right side is the routed content pane.
//
// The collapsed / expanded preference is persisted in localStorage so the
// officer's choice survives an app restart.
export type NavKey = "dashboard" | "appeals" | "case" | "report";

export interface ShellProps {
  username: string;
  licenseValidUntil: string | null;
  activeKey: NavKey;
  activeCaseSlug: string | null;
  onGoDashboard: () => void;
  onGoAppeals: () => void;
  onOpenCase: (c: AppealCase) => void;
  onNewCase: () => void;
  onGoReport: () => void;
  supportUnread: number;
  onSignOut: () => void;
  children: React.ReactNode;
}

const COLLAPSED_KEY = "bt.sidebarCollapsed";

export default function AppShell(props: ShellProps) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(COLLAPSED_KEY) === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0"); } catch { /* silent */ }
  }, [collapsed]);

  return (
    <div className="h-screen flex overflow-hidden bg-slate-100">
      <Sidebar {...props} collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      <div className="flex-1 flex flex-col min-w-0 h-full">
        <UpdateBanner />
        <main className="flex-1 min-h-0 overflow-y-auto">{props.children}</main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Sidebar

interface SidebarProps extends ShellProps {
  collapsed: boolean;
  onToggle: () => void;
}

function Sidebar({
  username, licenseValidUntil, activeKey, activeCaseSlug,
  onGoDashboard, onGoAppeals, onOpenCase, onNewCase, onGoReport, supportUnread, onSignOut,
  collapsed, onToggle,
}: SidebarProps) {
  const [cases, setCases] = useState<AppealCase[]>([]);
  const [appealsOpen, setAppealsOpen] = useState(activeKey === "appeals" || activeKey === "case");
  const [q, setQ] = useState("");

  // Pull the case list once on mount and again whenever we land back on
  // the appeals section (so newly-created / renamed cases surface without
  // a full app restart).
  async function refresh() {
    try { setCases(await api.listCases()); } catch { /* silent */ }
  }
  useEffect(() => { refresh(); }, []);
  useEffect(() => { if (activeKey === "appeals" || activeKey === "case") refresh(); }, [activeKey]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return cases;
    return cases.filter((c) =>
      c.title.toLowerCase().includes(t) ||
      (c.pan ?? "").toLowerCase().includes(t) ||
      (c.assessment_year ?? "").toLowerCase().includes(t),
    );
  }, [cases, q]);

  return (
    <aside
      className={
        "relative shrink-0 h-full flex flex-col bg-navy-800 text-white border-r border-navy-900/40 shadow-xl shadow-navy-900/20 transition-[width] duration-200 ease-out " +
        (collapsed ? "w-[68px]" : "w-[260px]")
      }
    >
      {/* Collapse toggle — sits on the right edge of the sidebar, half in / half
          out so it reads as a handle you can pull. */}
      <button
        onClick={onToggle}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="absolute -right-3 top-8 z-10 size-6 rounded-full bg-white text-navy-800 ring-1 ring-navy-900/20 shadow flex items-center justify-center hover:bg-slate-50"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
             className={"transition-transform " + (collapsed ? "" : "rotate-180")}>
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>

      {/* Branding — Income-Tax Department seal + product name */}
      <div className={"px-3 py-5 border-b border-white/10 flex items-center gap-3 " + (collapsed ? "justify-center" : "px-5")}>
        <div className="size-12 shrink-0 rounded-full bg-white ring-2 ring-white/25 shadow-md flex items-center justify-center p-1">
          <img src={logoUrl} alt="Income Tax Department" className="w-full h-full object-contain" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="text-[15px] font-semibold tracking-tight truncate">BharatTax</div>
            <div className="text-[12px] uppercase tracking-[0.16em] text-navy-200/85">Appeal Order</div>
          </div>
        )}
      </div>

      <nav className={"flex-1 min-h-0 overflow-y-auto py-4 space-y-1 text-[14.5px] " + (collapsed ? "px-2" : "px-3")}>
        <NavItem
          collapsed={collapsed}
          active={activeKey === "dashboard"}
          onClick={onGoDashboard}
          icon={<IconGrid />}
          label="Dashboard"
        />

        <button
          onClick={onNewCase}
          title="New Appeal"
          aria-label="New Appeal"
          className={
            "w-full mt-1 mb-2 inline-flex items-center gap-2 rounded-md bg-ashoka-600 hover:bg-ashoka-500 text-white font-semibold text-[14.5px] transition-colors shadow-sm shadow-ashoka-900/30 " +
            (collapsed ? "justify-center h-10" : "px-3 py-2")
          }
        >
          <IconPlus /> {!collapsed && "New Appeal"}
        </button>

        {/* Appeals — expandable list with search + scroll (hidden when
            collapsed; clicking the icon jumps to the Appeals screen). */}
        <div>
          <button
            onClick={() => {
              if (collapsed) { onGoAppeals(); return; }
              setAppealsOpen((v) => !v); onGoAppeals();
            }}
            title="Appeals"
            aria-label="Appeals"
            className={
              "w-full flex items-center gap-2 rounded-md transition-colors " +
              (collapsed ? "justify-center h-10" : "px-3 py-2") + " " +
              (activeKey === "appeals" || activeKey === "case"
                ? "bg-white/10 text-white"
                : "text-navy-100/90 hover:bg-white/5 hover:text-white")
            }
          >
            <IconFolder />
            {!collapsed && (
              <>
                <span className="flex-1 text-left">Appeals</span>
                <span className={"transition-transform " + (appealsOpen ? "rotate-180" : "")}>
                  <IconChevron />
                </span>
              </>
            )}
          </button>

          {!collapsed && appealsOpen && (
            <div className="mt-1.5 mb-2 ml-1 rounded-md bg-navy-900/50 ring-1 ring-white/10 overflow-hidden">
              <div className="px-2 pt-2 pb-1.5">
                <div className="relative">
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search cases…"
                    className="w-full h-8 pl-7 pr-2 rounded bg-navy-900/60 text-[13.5px] text-white placeholder-navy-200/50 ring-1 ring-white/10 focus:outline-none focus:ring-white/30"
                  />
                  <svg className="absolute left-2 top-2 size-3.5 text-navy-200/70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                </div>
              </div>
              <div className="max-h-[280px] overflow-y-auto pb-1.5 px-1.5">
                {filtered.length === 0 ? (
                  <div className="text-[13px] text-navy-200/60 px-2 py-3 text-center">
                    {cases.length ? "No matches" : "No cases yet — click New Appeal above."}
                  </div>
                ) : filtered.map((c) => {
                  const active = activeKey === "case" && activeCaseSlug === c.slug;
                  return (
                    <button
                      key={c.slug}
                      onClick={() => onOpenCase(c)}
                      title={c.title}
                      className={
                        "w-full text-left px-2 py-1.5 rounded text-[13.5px] truncate " +
                        (active ? "bg-white/15 text-white" : "text-navy-100/85 hover:bg-white/8 hover:text-white")
                      }
                    >
                      {c.title}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Report Issue — direct chat with an admin */}
        <button
          onClick={onGoReport}
          title="Report Issue"
          aria-label="Report Issue"
          className={
            "w-full flex items-center gap-2 rounded-md transition-colors mt-2 " +
            (collapsed ? "justify-center h-10" : "px-3 py-2") + " " +
            (activeKey === "report"
              ? "bg-white/10 text-white"
              : "text-navy-100/90 hover:bg-white/5 hover:text-white")
          }
        >
          <div className="relative">
            <IconLifebuoy />
            {supportUnread > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] px-1 rounded-full bg-ashoka-500 text-white text-[9.5px] font-bold flex items-center justify-center ring-2 ring-navy-800">
                {supportUnread > 9 ? "9+" : supportUnread}
              </span>
            )}
          </div>
          {!collapsed && <span>Report Issue</span>}
        </button>
      </nav>

      {/* Footer — signed-in user + logout, with license microcopy */}
      <div className="px-3 py-3 border-t border-white/10">
        <div className={"rounded-lg bg-navy-900/50 ring-1 ring-white/10 " + (collapsed ? "py-2.5 px-2 flex flex-col items-center gap-2" : "px-3 py-2.5")}>
          {collapsed ? (
            <>
              <div title={username} className="size-9 rounded-full bg-gradient-to-br from-ashoka-500 to-ashoka-700 grid place-items-center text-[14px] font-semibold ring-2 ring-white/10">
                {(username || "?").slice(0, 1).toUpperCase()}
              </div>
              <button
                onClick={onSignOut}
                title="Sign out"
                aria-label="Sign out"
                className="p-1.5 rounded text-navy-200/70 hover:text-white hover:bg-white/10 transition-colors"
              >
                <IconLogout />
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2.5">
              <div className="size-8 rounded-full bg-gradient-to-br from-ashoka-500 to-ashoka-700 grid place-items-center text-[13.5px] font-semibold ring-2 ring-white/10">
                {(username || "?").slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium truncate">{username}</div>
                <div className="text-[12px] text-navy-200/70">
                  {licenseValidUntil
                    ? `Licensed till ${new Date(licenseValidUntil).toLocaleDateString()}`
                    : "Officer"}
                </div>
              </div>
              <button
                onClick={onSignOut}
                title="Sign out"
                aria-label="Sign out"
                className="p-1.5 rounded text-navy-200/70 hover:text-white hover:bg-white/10 transition-colors"
              >
                <IconLogout />
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function NavItem({ collapsed, active, onClick, icon, label }: {
  collapsed: boolean; active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={
        "w-full flex items-center gap-2 rounded-md transition-colors " +
        (collapsed ? "justify-center h-10" : "px-3 py-2") + " " +
        (active ? "bg-white/10 text-white shadow-sm shadow-navy-900/30"
                : "text-navy-100/90 hover:bg-white/5 hover:text-white")
      }
    >
      {icon}
      {!collapsed && <span>{label}</span>}
    </button>
  );
}

// -- small icons kept inline to avoid adding a dependency for 5 glyphs ------

function IconGrid()   { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>; }
function IconPlus()   { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>; }
function IconFolder() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h4l2 2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/></svg>; }
function IconChevron(){ return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>; }
function IconLogout() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>; }
function IconLifebuoy() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><path d="m4.93 4.93 4.24 4.24M14.83 9.17l4.24-4.24M14.83 14.83l4.24 4.24M9.17 14.83l-4.24 4.24"/></svg>; }
