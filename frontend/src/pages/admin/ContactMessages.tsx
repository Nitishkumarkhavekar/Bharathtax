import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Mail,
  Loader2,
  Check,
  Trash2,
  ExternalLink,
  Inbox,
  ChevronLeft,
  ChevronRight,
  Phone,
  MessageSquareText,
  Users,
} from "lucide-react";
import { api, ContactMessage, ContactMessagePage } from "../../api";
import { toast } from "@/lib/toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

type Filter = "all" | "open" | "handled";

const PER_PAGE = 20;

/**
 * Admin "Leads" page — new leads come in from the marketing site contact
 * form and land here newest-first. Each row can be inspected in a
 * read-only detail row (message body), marked handled, or deleted.
 * Server-side pagination via /contact?page=&per_page=&filter=.
 */
export default function LeadsPage() {
  const [pageData, setPageData] = useState<ContactMessagePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<number | null>(null);
  const { confirm, dialog } = useConfirm();

  const load = useCallback(() => {
    setLoading(true);
    setErr(null);
    api
      .adminContactList({ page, per_page: PER_PAGE, filter })
      .then((d) => {
        setPageData(d);
        // If server clamped the page (e.g. after a delete emptied the last
        // page), sync our local page state.
        if (d.page !== page) setPage(d.page);
      })
      .catch((e: any) => setErr(e?.message ?? "Failed to load leads"))
      .finally(() => setLoading(false));
  }, [page, filter]);

  useEffect(() => {
    load();
  }, [load]);

  // Reset to page 1 whenever the filter changes.
  useEffect(() => {
    setPage(1);
  }, [filter]);

  async function setHandled(m: ContactMessage, handled: boolean) {
    // Optimistic — patch the current page.
    setPageData((p) =>
      p ? { ...p, items: p.items.map((x) => (x.id === m.id ? { ...x, handled } : x)) } : p,
    );
    try {
      await api.adminContactSetHandled(m.id, handled);
      toast.success(handled ? "Marked handled" : "Re-opened");
      // If we're viewing a filtered view, the row may no longer match the
      // filter — refresh to sync.
      if (filter !== "all") load();
    } catch {
      toast.error("Couldn't update the lead");
      load();
    }
  }

  async function remove(m: ContactMessage) {
    if (
      !(await confirm({
        title: `Delete the lead from ${m.name}?`,
        description: "This removes the enquiry permanently.",
        tone: "danger",
        confirmLabel: "Delete lead",
      }))
    )
      return;
    setPageData((p) =>
      p ? { ...p, items: p.items.filter((x) => x.id !== m.id) } : p,
    );
    api
      .adminContactDelete(m.id)
      .then(() => {
        toast.success("Lead deleted");
        load();
      })
      .catch(() => {
        toast.error("Couldn't delete the lead");
        load();
      });
  }

  const items = pageData?.items ?? [];
  const total = pageData?.total ?? 0;
  const totalPages = pageData?.total_pages ?? 1;
  const openCount = useMemo(
    () => items.filter((r) => !r.handled).length,
    [items],
  );

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      {dialog}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-5">
        <div>
          <h1 className="font-serif text-2xl font-semibold tracking-tight text-slate-900 flex items-center gap-2">
            <Users className="size-5 text-primary" /> Leads
          </h1>
          <p className="text-[13px] text-slate-500 mt-0.5">
            New leads from the website contact form — newest first.
            {pageData ? ` ${total} total.` : ""}
          </p>
        </div>
        <div className="inline-flex rounded-lg ring-1 ring-slate-200 bg-white p-0.5 text-[13px]">
          {(["all", "open", "handled"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={
                "px-3 py-1.5 rounded-md font-medium capitalize transition-colors " +
                (filter === f
                  ? "bg-primary text-white"
                  : "text-slate-600 hover:bg-slate-100")
              }
            >
              {f}
              {f === "open" && filter !== "open" && openCount > 0
                ? ` (${openCount}+)`
                : ""}
            </button>
          ))}
        </div>
      </div>

      {err && (
        <div className="rounded-lg bg-rose-50 text-rose-800 text-sm px-4 py-2.5 mb-4">
          {err}
        </div>
      )}

      {loading && !pageData ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm py-16 justify-center">
          <Loader2 className="size-4 animate-spin" /> Loading leads…
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16">
          <div className="mx-auto size-12 rounded-xl bg-slate-100 grid place-items-center text-slate-400 mb-3">
            <Inbox className="size-6" />
          </div>
          <div className="text-[14px] text-slate-600 font-medium">
            {filter === "all" ? "No leads yet." : `No ${filter} leads.`}
          </div>
          <p className="text-[12.5px] text-slate-500 mt-1">
            When someone submits the website contact form, they'll appear here.
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-xl bg-white ring-1 ring-slate-200 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-[13.5px]">
                <thead className="bg-slate-50 text-slate-600 text-[11.5px] uppercase tracking-wider">
                  <tr>
                    <th className="text-left font-semibold px-4 py-3 whitespace-nowrap">
                      Received
                    </th>
                    <th className="text-left font-semibold px-4 py-3">Name</th>
                    <th className="text-left font-semibold px-4 py-3">Email</th>
                    <th className="text-left font-semibold px-4 py-3">
                      Mobile
                    </th>
                    <th className="text-left font-semibold px-4 py-3">Topic</th>
                    <th className="text-left font-semibold px-4 py-3">
                      Status
                    </th>
                    <th className="text-right font-semibold px-4 py-3 whitespace-nowrap">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((m) => (
                    <>
                      <tr
                        key={m.id}
                        className={
                          "hover:bg-slate-50/60 transition-colors " +
                          (m.handled ? "opacity-75" : "")
                        }
                      >
                        <td className="px-4 py-3 text-slate-500 whitespace-nowrap align-top">
                          {m.created_at
                            ? new Date(m.created_at).toLocaleString()
                            : "—"}
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900 align-top">
                          {m.name}
                          {m.organisation && (
                            <div className="text-[11.5px] text-slate-500 font-normal mt-0.5">
                              {m.organisation}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <a
                            href={`mailto:${m.email}`}
                            className="text-primary hover:underline inline-flex items-center gap-1"
                          >
                            {m.email} <ExternalLink className="size-3" />
                          </a>
                        </td>
                        <td className="px-4 py-3 align-top">
                          {m.mobile ? (
                            <a
                              href={`tel:${m.mobile}`}
                              className="text-slate-700 hover:text-primary inline-flex items-center gap-1"
                            >
                              <Phone className="size-3 text-slate-400" />
                              {m.mobile}
                            </a>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          {m.topic ? (
                            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                              {m.topic}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          {m.handled ? (
                            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 inline-flex items-center gap-1">
                              <Check className="size-3" /> Handled
                            </span>
                          ) : (
                            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
                              New
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <button
                              onClick={() =>
                                setOpenId(openId === m.id ? null : m.id)
                              }
                              title="View message"
                              className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                            >
                              <MessageSquareText className="size-4" />
                            </button>
                            <button
                              onClick={() => setHandled(m, !m.handled)}
                              title={
                                m.handled ? "Mark as open" : "Mark as handled"
                              }
                              className={
                                "p-1.5 rounded-md transition-colors " +
                                (m.handled
                                  ? "text-slate-400 hover:bg-slate-100"
                                  : "text-emerald-600 hover:bg-emerald-50")
                              }
                            >
                              <Check className="size-4" />
                            </button>
                            <button
                              onClick={() => remove(m)}
                              title="Delete"
                              className="p-1.5 rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {openId === m.id && (
                        <tr key={`${m.id}-body`} className="bg-slate-50/50">
                          <td colSpan={7} className="px-6 py-4">
                            <div className="text-[11.5px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5">
                              Message
                            </div>
                            <p className="text-[13.5px] text-slate-700 leading-relaxed whitespace-pre-wrap">
                              {m.message}
                            </p>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination controls */}
          <div className="mt-4 flex items-center justify-between gap-3 flex-wrap text-[13px]">
            <div className="text-slate-500">
              Showing <span className="font-medium text-slate-800">
                {(pageData!.page - 1) * pageData!.per_page + 1}
              </span>
              –
              <span className="font-medium text-slate-800">
                {Math.min(pageData!.page * pageData!.per_page, total)}
              </span>{" "}
              of <span className="font-medium text-slate-800">{total}</span>
              {loading && (
                <Loader2 className="size-3.5 animate-spin inline-block ml-2 text-slate-400" />
              )}
            </div>
            <div className="inline-flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="inline-flex items-center gap-1 px-2.5 h-8 rounded-md ring-1 ring-slate-200 bg-white text-slate-700 font-medium hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="size-4" /> Prev
              </button>
              <PageButtons
                current={page}
                total={totalPages}
                onGo={(p) => setPage(p)}
                disabled={loading}
              />
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                className="inline-flex items-center gap-1 px-2.5 h-8 rounded-md ring-1 ring-slate-200 bg-white text-slate-700 font-medium hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
        </>
      )}

      {/* Small legend / helper */}
      <div className="mt-8 flex items-center gap-2 text-[12px] text-slate-500 justify-center">
        <Mail className="size-3.5" /> New leads land here in real-time. Click
        the message icon to read the enquiry body.
      </div>
    </div>
  );
}

// ─── Pagination number buttons ────────────────────────────────────────────
// Compact "1 … 4 [5] 6 … 12" pattern with ellipses. Bare-metal — no library.
function PageButtons({
  current,
  total,
  onGo,
  disabled,
}: {
  current: number;
  total: number;
  onGo: (page: number) => void;
  disabled?: boolean;
}) {
  if (total <= 1) return null;
  const pages = pageNumbers(current, total);
  return (
    <div className="hidden sm:inline-flex items-center gap-1 mx-1">
      {pages.map((p, i) =>
        p === "…" ? (
          <span key={`e-${i}`} className="px-1 text-slate-400">
            …
          </span>
        ) : (
          <button
            key={p}
            onClick={() => onGo(p)}
            disabled={disabled || p === current}
            className={
              "min-w-[32px] h-8 px-2 rounded-md text-[13px] font-medium transition-colors " +
              (p === current
                ? "bg-primary text-white cursor-default"
                : "ring-1 ring-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50")
            }
          >
            {p}
          </button>
        ),
      )}
    </div>
  );
}

function pageNumbers(current: number, total: number): (number | "…")[] {
  // Always show first, last, current, and one page either side. Fill with
  // ellipses for the rest.
  const s = new Set<number>([1, total, current, current - 1, current + 1]);
  const list = Array.from(s)
    .filter((n) => n >= 1 && n <= total)
    .sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  let prev: number | null = null;
  for (const n of list) {
    if (prev !== null && n - prev > 1) out.push("…");
    out.push(n);
    prev = n;
  }
  return out;
}
