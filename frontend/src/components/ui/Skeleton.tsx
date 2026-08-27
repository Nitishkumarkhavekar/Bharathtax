import { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/**
 * Loading placeholder primitive. A soft, pulsing block that stands in for
 * content while it loads — used across the app so every page's loading state
 * has the same calm, consistent feel instead of a bare "Loading…" line.
 */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div aria-hidden style={style} className={cn("animate-pulse rounded-md bg-slate-200/70", className)} />;
}

/**
 * A stack of placeholder list rows, shaped like a title + subtitle line with a
 * trailing pill — matches the app's list pages (dashboard, matters, drafts…).
 */
export function SkeletonRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("divide-y divide-slate-100", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5" style={{ width: `${55 - (i % 3) * 8}%` }} />
            <Skeleton className="h-2.5 w-1/3" />
          </div>
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/**
 * A grid of placeholder cards for card/tile layouts (templates, rulings…).
 */
export function SkeletonCards({ count = 6, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-3", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-2xl bg-white ring-1 ring-slate-200 p-4 space-y-3">
          <div className="flex items-center gap-2.5">
            <Skeleton className="size-9 rounded-lg" />
            <Skeleton className="h-3.5 w-1/2" />
          </div>
          <Skeleton className="h-2.5 w-full" />
          <Skeleton className="h-2.5 w-4/5" />
        </div>
      ))}
    </div>
  );
}
