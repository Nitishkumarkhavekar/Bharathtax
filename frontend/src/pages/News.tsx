import { useEffect, useMemo, useState } from "react";
import {
  Newspaper, ExternalLink, RefreshCw, Search, X, Filter, Calendar as CalendarIcon,
} from "lucide-react";
import { api } from "../api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import PageHelp from "@/components/PageHelp";

type NewsItem = {
  id: number;
  title: string;
  url: string;
  snippet: string | null;
  source_name: string;
  source_category: string | null;
  published_at: string;
  first_seen_at: string;
};

// Short "5 min ago" / "2 h ago" / "3 d ago" — the header of every card.
function relTime(iso: string): string {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} d ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// Hide the aggregator provenance ("Google Alerts", "Google News — CBDT …")
// from user-facing labels — the reader should see the actual publisher.
function isAggregatorName(name: string | undefined | null): boolean {
  if (!name) return true;
  const low = name.toLowerCase();
  return low.startsWith("google alert") || low.startsWith("google news");
}

// Best-effort publisher: prefer the stored source_name if it isn't an
// aggregator, otherwise fall back to the URL's hostname.
function publisher(item: { source_name: string; url: string }): string {
  if (item.source_name && !isAggregatorName(item.source_name)) return item.source_name;
  return hostname(item.url);
}

const CATEGORY_TONE: Record<string, string> = {
  General: "bg-slate-50 text-slate-700 ring-slate-200",
  CBDT: "bg-blue-50 text-blue-700 ring-blue-200",
  "Case law": "bg-violet-50 text-violet-700 ring-violet-200",
  GST: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  Customs: "bg-cyan-50 text-cyan-700 ring-cyan-200",
  "Transfer Pricing": "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200",
  "International Tax": "bg-indigo-50 text-indigo-700 ring-indigo-200",
  "TDS/TCS": "bg-orange-50 text-orange-700 ring-orange-200",
  Budget: "bg-rose-50 text-rose-700 ring-rose-200",
};

export default function News() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [categories, setCategories] = useState<{ name: string; count: number }[]>([]);
  const [sort, setSort] = useState<"latest" | "trending">("latest");
  const [total, setTotal] = useState(0);
  // Date filter — preset chip ("all" | "today" | "7d" | "30d" | "custom")
  // and, when preset === "custom", explicit from/to YYYY-MM-DD strings.
  const [datePreset, setDatePreset] = useState<"all" | "today" | "7d" | "30d" | "custom">("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [customOpen, setCustomOpen] = useState(false);

  // Debounce free-text search so we're not hammering the API on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  // Map the preset chip → API params. "custom" defers to explicit fromDate/toDate.
  const dateParams = useMemo(() => {
    if (datePreset === "today") return { sinceDays: 1 };
    if (datePreset === "7d") return { sinceDays: 7 };
    if (datePreset === "30d") return { sinceDays: 30 };
    if (datePreset === "custom") {
      return {
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
      };
    }
    return {};
  }, [datePreset, fromDate, toDate]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.news({
        q: debouncedQ || undefined,
        category: category || undefined,
        sort,
        limit: 60,
        ...dateParams,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      toast.error("Couldn't load news");
    } finally {
      setLoading(false);
    }
  };

  const loadCategories = async () => {
    try {
      const res = await api.newsCategories();
      setCategories(res.categories);
    } catch {
      setCategories([]);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ, category, sort, datePreset, fromDate, toDate]);

  useEffect(() => {
    loadCategories();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      const r = await api.newsRefresh();
      if (r.inserted > 0) {
        toast.success(`${r.inserted} new stor${r.inserted === 1 ? "y" : "ies"} added`);
      } else {
        toast.success("Feeds up to date");
      }
      await Promise.all([load(), loadCategories()]);
    } catch (e) {
      toast.error("Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  const grouped = useMemo(() => {
    // Bucket by day so "TODAY / YESTERDAY / THIS WEEK / EARLIER" reads
    // naturally, like an editorial feed rather than a raw list.
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const weekAgo = new Date(today); weekAgo.setDate(today.getDate() - 7);
    const buckets: Record<string, NewsItem[]> = {
      "Today": [], "Yesterday": [], "This week": [], "Earlier": [],
    };
    for (const it of items) {
      const d = new Date(it.published_at);
      if (d >= today) buckets["Today"].push(it);
      else if (d >= yesterday) buckets["Yesterday"].push(it);
      else if (d >= weekAgo) buckets["This week"].push(it);
      else buckets["Earlier"].push(it);
    }
    return buckets;
  }, [items]);

  return (
    <div className="mx-auto max-w-5xl px-4 md:px-6 py-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Newspaper className="size-5 text-primary" />
            <h1 className="text-xl font-bold text-slate-900">Latest tax news</h1>
          </div>
          <p className="text-[13px] text-slate-500 mt-0.5">
            Real-time headlines across Indian taxation — Income-tax, GST, Customs,
            Transfer Pricing, International Tax and more — curated from verified
            publishers. {total.toLocaleString("en-IN")} stor{total === 1 ? "y" : "ies"} in the feed.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={refreshing}
            title="Poll all sources now"
          >
            <RefreshCw className={cn("size-4 mr-1.5", refreshing && "animate-spin")} />
            Refresh
          </Button>
          <PageHelp id="news" />
        </div>
      </div>

      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="size-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search headlines — e.g. Section 148A, GST, budget…"
            className="pl-9 pr-9 h-9"
          />
          {q && (
            <button
              onClick={() => setQ("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 rounded-lg ring-1 ring-slate-200 p-0.5 bg-white">
          <button
            onClick={() => setSort("latest")}
            className={cn(
              "text-[12px] font-medium px-2.5 h-7 rounded-md transition-colors",
              sort === "latest" ? "bg-primary text-white" : "text-slate-600 hover:bg-slate-100",
            )}
          >Latest</button>
          <button
            onClick={() => setSort("trending")}
            className={cn(
              "text-[12px] font-medium px-2.5 h-7 rounded-md transition-colors",
              sort === "trending" ? "bg-primary text-white" : "text-slate-600 hover:bg-slate-100",
            )}
          >Trending</button>
        </div>

        {/* Date preset chips + optional custom range. Compact — mirrors the
            Latest/Trending pill style so the whole filter bar reads as one
            row of controls. */}
        <div className="relative">
          <div className="flex items-center gap-1.5 rounded-lg ring-1 ring-slate-200 p-0.5 bg-white">
            <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1 pl-1.5 pr-0.5">
              <CalendarIcon className="size-3" /> Date
            </span>
            {([
              ["all", "Any"],
              ["today", "Today"],
              ["7d", "7d"],
              ["30d", "30d"],
              ["custom", "Custom"],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => {
                  setDatePreset(key);
                  if (key === "custom") {
                    setCustomOpen(true);
                  } else {
                    setCustomOpen(false);
                    setFromDate("");
                    setToDate("");
                  }
                }}
                className={cn(
                  "text-[12px] font-medium px-2.5 h-7 rounded-md transition-colors",
                  datePreset === key
                    ? "bg-primary text-white"
                    : "text-slate-600 hover:bg-slate-100",
                )}
              >{label}</button>
            ))}
          </div>
          {datePreset === "custom" && customOpen && (
            <div className="absolute right-0 z-20 mt-2 w-72 rounded-lg ring-1 ring-slate-200 bg-white shadow-lg p-3">
              <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-2">
                Custom range
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[11px] text-slate-500">From</span>
                  <Input
                    type="date"
                    value={fromDate}
                    max={toDate || undefined}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="h-8 text-[12.5px] mt-0.5"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] text-slate-500">To</span>
                  <Input
                    type="date"
                    value={toDate}
                    min={fromDate || undefined}
                    onChange={(e) => setToDate(e.target.value)}
                    className="h-8 text-[12.5px] mt-0.5"
                  />
                </label>
              </div>
              <div className="mt-3 flex justify-between items-center">
                <button
                  onClick={() => { setFromDate(""); setToDate(""); }}
                  className="text-[12px] text-slate-500 hover:text-slate-700"
                  disabled={!fromDate && !toDate}
                >Clear</button>
                <button
                  onClick={() => setCustomOpen(false)}
                  className="text-[12px] font-medium text-white bg-primary hover:bg-primary/90 px-3 h-7 rounded-md"
                >Apply</button>
              </div>
            </div>
          )}
        </div>

        {categories.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1">
              <Filter className="size-3" /> Category
            </span>
            <button
              onClick={() => setCategory(null)}
              className={cn(
                "text-[12px] font-medium px-2.5 h-7 rounded-md ring-1 transition-colors",
                category === null
                  ? "bg-primary text-white ring-primary"
                  : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-100",
              )}
            >All</button>
            {categories.map((c) => (
              <button
                key={c.name}
                onClick={() => setCategory(c.name === category ? null : c.name)}
                className={cn(
                  "text-[12px] font-medium px-2.5 h-7 rounded-md ring-1 transition-colors",
                  c.name === category
                    ? "bg-primary text-white ring-primary"
                    : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-100",
                )}
              >{c.name} <span className="opacity-60 tabular-nums">{c.count}</span></button>
            ))}
          </div>
        )}
      </div>

      {/* List */}
      {loading ? (
        <SkeletonRows rows={6} />
      ) : items.length === 0 ? (
        <div className="rounded-xl ring-1 ring-slate-200 bg-white p-10 text-center">
          <Newspaper className="size-8 text-slate-300 mx-auto mb-3" />
          <div className="text-sm font-semibold text-slate-700">No news yet</div>
          <p className="text-[13px] text-slate-500 mt-1">
            The feed poll runs every 30 minutes. Click <b>Refresh</b> to pull now.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {(["Today", "Yesterday", "This week", "Earlier"] as const).map((bucket) => {
            const bucketItems = grouped[bucket];
            if (!bucketItems.length) return null;
            return (
              <section key={bucket}>
                <h2 className="text-[11px] uppercase tracking-widest text-slate-400 font-semibold mb-2">
                  {bucket} · {bucketItems.length}
                </h2>
                <ul className="space-y-2">
                  {bucketItems.map((it) => {
                    const catTone = it.source_category
                      ? CATEGORY_TONE[it.source_category] || "bg-slate-50 text-slate-700 ring-slate-200"
                      : "bg-slate-50 text-slate-700 ring-slate-200";
                    return (
                      <li key={it.id}>
                        <a
                          href={it.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="group block rounded-xl ring-1 ring-slate-200 bg-white hover:ring-primary/40 hover:shadow-sm transition-all p-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <h3 className="font-semibold text-[15px] text-slate-900 group-hover:text-primary leading-snug">
                              {it.title}
                            </h3>
                            <ExternalLink className="size-4 shrink-0 mt-0.5 text-slate-300 group-hover:text-primary" />
                          </div>
                          {it.snippet && (
                            <p className="mt-1.5 text-[13px] text-slate-600 leading-relaxed line-clamp-2">
                              {it.snippet}
                            </p>
                          )}
                          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11.5px]">
                            {it.source_category && (
                              <span className={cn(
                                "px-2 py-0.5 rounded-full font-medium ring-1",
                                catTone,
                              )}>{it.source_category}</span>
                            )}
                            <span className="text-slate-500 truncate max-w-[220px]">
                              <span className="font-medium text-slate-700">{publisher(it)}</span>
                            </span>
                            <span className="text-slate-300">·</span>
                            <span className="text-slate-500 tabular-nums">{relTime(it.published_at)}</span>
                          </div>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
