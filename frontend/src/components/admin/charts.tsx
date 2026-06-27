// Inline SVG charts for the admin console. No external chart library.
// Visual goals: clean lines, soft gradients, subtle motion, professional palette.

import { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

// ----------------------------------------------------------------- shared
type Accent = "blue" | "green" | "amber" | "rose" | "slate" | "violet";

const ACCENT: Record<
  Accent,
  { card: string; iconBg: string; iconFg: string; bar: string; ring: string; text: string }
> = {
  blue: {
    card: "from-sky-50/80 via-white to-white",
    iconBg: "bg-sky-100",
    iconFg: "text-sky-600",
    bar: "from-sky-400 to-sky-600",
    ring: "ring-sky-100",
    text: "text-sky-700",
  },
  green: {
    card: "from-emerald-50/80 via-white to-white",
    iconBg: "bg-emerald-100",
    iconFg: "text-emerald-600",
    bar: "from-emerald-400 to-emerald-600",
    ring: "ring-emerald-100",
    text: "text-emerald-700",
  },
  amber: {
    card: "from-amber-50/80 via-white to-white",
    iconBg: "bg-amber-100",
    iconFg: "text-amber-600",
    bar: "from-amber-400 to-amber-600",
    ring: "ring-amber-100",
    text: "text-amber-700",
  },
  rose: {
    card: "from-rose-50/80 via-white to-white",
    iconBg: "bg-rose-100",
    iconFg: "text-rose-600",
    bar: "from-rose-400 to-rose-600",
    ring: "ring-rose-100",
    text: "text-rose-700",
  },
  slate: {
    card: "from-slate-50/80 via-white to-white",
    iconBg: "bg-slate-100",
    iconFg: "text-slate-600",
    bar: "from-slate-400 to-slate-600",
    ring: "ring-slate-100",
    text: "text-slate-700",
  },
  violet: {
    card: "from-violet-50/80 via-white to-white",
    iconBg: "bg-violet-100",
    iconFg: "text-violet-600",
    bar: "from-violet-400 to-violet-600",
    ring: "ring-violet-100",
    text: "text-violet-700",
  },
};

// ----------------------------------------------------------------- StatCard
export function StatCard({
  label,
  value,
  hint,
  icon,
  accent = "blue",
  trend,
  sparkline,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  accent?: Accent;
  trend?: { value: number; label?: string }; // pct change; positive = good
  sparkline?: number[];
}) {
  const a = ACCENT[accent];
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-br p-5 shadow-sm hover:shadow-md transition-shadow",
        a.card,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-600">
            {label}
          </div>
          <div className="mt-2 text-[28px] font-semibold text-slate-900 tabular-nums leading-none">
            {value}
          </div>
        </div>
        {icon && (
          <div
            className={cn(
              "size-9 rounded-xl flex items-center justify-center ring-1",
              a.iconBg,
              a.iconFg,
              a.ring,
            )}
          >
            {icon}
          </div>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="text-xs text-slate-600 min-w-0 truncate">{hint}</div>
        {trend && <TrendChip value={trend.value} label={trend.label} />}
      </div>
      {sparkline && sparkline.length > 1 && (
        <div className="mt-3 -mb-1 -mx-1">
          <Sparkline data={sparkline} height={36} color="currentColor" className={a.text} />
        </div>
      )}
      {/* decorative gradient blob */}
      <div
        className={cn(
          "pointer-events-none absolute -top-12 -right-10 size-32 rounded-full opacity-50 blur-2xl",
          a.iconBg,
        )}
        aria-hidden
      />
    </div>
  );
}

export function TrendChip({ value, label }: { value: number; label?: string }) {
  const up = value >= 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10.5px] font-semibold tabular-nums",
        up ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700",
      )}
    >
      {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
      {Math.abs(value).toFixed(1)}%
      {label && <span className="text-[10px] font-normal text-slate-500 ml-0.5">{label}</span>}
    </span>
  );
}

// ----------------------------------------------------------------- PercentBar
export function PercentBar({
  label,
  value,
  max = 100,
  tone,
  rightLabel,
}: {
  label: ReactNode;
  value: number;
  max?: number;
  tone?: "ok" | "warn" | "bad";
  rightLabel?: ReactNode;
}) {
  const pct = Math.max(0, Math.min(100, max ? (value / max) * 100 : 0));
  const auto: "ok" | "warn" | "bad" = pct < 70 ? "ok" : pct < 90 ? "warn" : "bad";
  const t = tone ?? auto;
  const colors = {
    ok: "from-emerald-400 to-emerald-600",
    warn: "from-amber-400 to-amber-600",
    bad: "from-rose-400 to-rose-600",
  } as const;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-700 font-semibold">{label}</span>
        <span className="font-mono text-slate-800 font-semibold">{rightLabel ?? `${pct.toFixed(1)}%`}</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden ring-1 ring-slate-100">
        <div
          className={cn(
            "h-full rounded-full bg-gradient-to-r transition-[width] duration-700 ease-out shadow-sm",
            colors[t],
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- BarChart
//
// Visual goals:
//  * cap individual bar width so 1-2 data points don't look balloon-fat
//  * always show value labels above each bar (no hover dance)
//  * proper Y-axis with quartile values + dashed grid lines aligned to them
//  * subtle gradient bars with a soft glow underneath
//  * gentle entrance animation (grow from baseline)
export function BarChart({
  data,
  height = 200,
  valueFormatter,
  accent = "blue",
  maxBarWidth = 56,
  yAxis = true,
}: {
  data: { label: string; value: number }[];
  height?: number;
  valueFormatter?: (v: number) => string;
  accent?: Accent;
  maxBarWidth?: number;
  yAxis?: boolean;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const fmt = valueFormatter ?? ((v) => String(v));
  const a = ACCENT[accent];

  // Pick "nice" Y-axis ticks (0, 25%, 50%, 75%, 100%) of niceMax.
  const niceMax = niceCeil(max);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(niceMax * f));
  // Reserved space for value labels above bars + axis labels below.
  const topPad = 22;
  const bottomLabelHeight = 22;
  const plotHeight = height - topPad - bottomLabelHeight;

  return (
    <div className="w-full">
      <div className="flex" style={{ height }}>
        {/* Y-axis labels */}
        {yAxis && (
          <div
            className="relative pr-2 text-[10.5px] font-semibold text-slate-500 tabular-nums select-none"
            style={{ width: 36 }}
          >
            <div
              className="absolute inset-x-0 flex flex-col-reverse justify-between"
              style={{ top: topPad, bottom: bottomLabelHeight }}
            >
              {ticks.map((t, i) => (
                <div key={i} className="text-right -translate-y-1/2 first:translate-y-0 last:-translate-y-full">
                  {abbrev(t)}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Plot area */}
        <div className="flex-1 min-w-0 relative">
          {/* Horizontal grid lines */}
          <div
            className="absolute inset-x-0 flex flex-col-reverse justify-between pointer-events-none"
            style={{ top: topPad, bottom: bottomLabelHeight }}
          >
            {ticks.map((_, i) => (
              <div
                key={i}
                className={i === 0 ? "border-t border-slate-200" : "border-t border-dashed border-slate-100"}
              />
            ))}
          </div>

          {/* Bars (centered, capped width) */}
          <div
            className="absolute inset-x-0 flex items-end justify-center"
            style={{
              top: topPad,
              bottom: bottomLabelHeight,
              gap: data.length > 8 ? 6 : 16,
            }}
          >
            {data.map((d, i) => {
              const h = (d.value / niceMax) * plotHeight;
              return (
                <div
                  key={i}
                  className="group flex flex-col items-center justify-end h-full"
                  style={{ flex: `0 1 ${maxBarWidth}px`, maxWidth: maxBarWidth }}
                >
                  {/* Value label above the bar */}
                  <div
                    className="text-[11.5px] font-semibold text-slate-800 tabular-nums leading-none mb-1.5"
                    style={{ opacity: d.value === 0 ? 0.5 : 1 }}
                  >
                    {fmt(d.value)}
                  </div>
                  <div className="relative w-full" style={{ height: Math.max(3, h) }}>
                    {/* soft glow under bar */}
                    <div
                      className={cn(
                        "absolute -inset-x-1 bottom-0 h-3 rounded-full blur-md opacity-50 bg-gradient-to-t",
                        a.bar,
                      )}
                      aria-hidden
                    />
                    {/* The bar itself */}
                    <div
                      className={cn(
                        "relative w-full h-full rounded-t-lg bg-gradient-to-t",
                        "shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_2px_8px_-2px_rgba(15,23,42,0.18)]",
                        "transition-all duration-700 ease-out group-hover:brightness-110",
                        a.bar,
                      )}
                      title={`${d.label}: ${fmt(d.value)}`}
                    >
                      {/* highlight stripe */}
                      <div className="absolute inset-x-1 top-0.5 h-1 rounded-full bg-white/30" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* X-axis labels */}
          <div
            className="absolute inset-x-0 bottom-0 flex items-end justify-center"
            style={{
              height: bottomLabelHeight,
              gap: data.length > 8 ? 6 : 16,
              paddingTop: 4,
            }}
          >
            {data.map((d, i) => (
              <div
                key={i}
                className="text-center text-[11px] font-semibold text-slate-600 truncate"
                style={{ flex: `0 1 ${maxBarWidth}px`, maxWidth: maxBarWidth }}
                title={d.label}
              >
                {d.label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Pick a "nice" rounded ceiling for the Y axis so the top tick isn't 19 or 23.
function niceCeil(n: number): number {
  if (n <= 5) return 5;
  if (n <= 10) return 10;
  const pow = Math.pow(10, Math.floor(Math.log10(n)));
  const f = n / pow;
  const m = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return m * pow;
}

function abbrev(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1) + "k";
  return String(n);
}

// ----------------------------------------------------------------- Sparkline
export function Sparkline({
  data,
  height = 50,
  color = "currentColor",
  className,
  fill = true,
}: {
  data: number[];
  height?: number;
  color?: string;
  className?: string;
  fill?: boolean;
}) {
  if (data.length === 0) return null;
  const w = 240;
  const h = height;
  const max = Math.max(1, ...data);
  const min = Math.min(0, ...data);
  const step = data.length > 1 ? w / (data.length - 1) : 0;
  const norm = (v: number) => h - ((v - min) / (max - min || 1)) * (h - 6) - 3;
  const pts = data.map((v, i) => [i * step, norm(v)] as const);
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  const id = `g-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <svg
      width="100%"
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={cn("overflow-visible", className)}
    >
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#${id})`} />}
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ----------------------------------------------------------------- DonutChart
export function DonutChart({
  segments,
  size = 140,
  thickness = 16,
  centerLabel,
  centerSub,
  legend = "side",
}: {
  segments: { label: string; value: number; color: string }[];
  size?: number;
  thickness?: number;
  centerLabel?: ReactNode;
  centerSub?: ReactNode;
  legend?: "side" | "bottom" | "none";
}) {
  const total = Math.max(1, segments.reduce((a, b) => a + b.value, 0));
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className={legend === "bottom" ? "flex flex-col items-center gap-3" : "flex items-center gap-5"}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="rgb(241 245 249)"
            strokeWidth={thickness}
          />
          {segments.map((s, i) => {
            const frac = s.value / total;
            const dash = c * frac;
            const gap = c - dash;
            const el = (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={thickness}
                strokeDasharray={`${dash} ${gap}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
              />
            );
            offset += dash;
            return el;
          })}
        </svg>
        {/* center label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {centerLabel && (
            <div className="text-2xl font-semibold text-slate-900 tabular-nums leading-none">
              {centerLabel}
            </div>
          )}
          {centerSub && <div className="mt-1 text-[11px] font-medium text-slate-600">{centerSub}</div>}
        </div>
      </div>
      {legend !== "none" && (
        <ul className={cn("space-y-1.5", legend === "bottom" ? "w-full max-w-xs" : "")}>
          {segments.map((s, i) => (
            <li key={i} className="flex items-center gap-2 text-[12.5px]">
              <span className="inline-block size-2.5 rounded-sm" style={{ background: s.color }} />
              <span className="text-slate-700 font-medium">{s.label}</span>
              <span className="ml-auto font-mono text-slate-900 tabular-nums font-semibold">{s.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ----------------------------------------------------------------- ProgressRing
export function ProgressRing({
  value,
  max = 100,
  size = 96,
  thickness = 10,
  label,
  sub,
  color = "#2563eb",
}: {
  value: number;
  max?: number;
  size?: number;
  thickness?: number;
  label?: ReactNode;
  sub?: ReactNode;
  color?: string;
}) {
  const pct = Math.max(0, Math.min(1, max ? value / max : 0));
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgb(241 245 249)"
          strokeWidth={thickness}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeDasharray={`${c * pct} ${c * (1 - pct)}`}
          strokeLinecap="round"
        />
      </svg>
      {/* Label / sub-label inherit color from the parent so the ring is
          legible on both dark heros (where parent is text-white) and white
          cards (where parent is text-slate-900). Sub gets reduced opacity. */}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {label && (
          <div className="text-base font-semibold tabular-nums leading-none">{label}</div>
        )}
        {sub && (
          <div className="text-[10.5px] opacity-70 mt-1 leading-tight">{sub}</div>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- Section
export function Section({
  title,
  icon,
  subtitle,
  children,
  action,
  className,
}: {
  title: ReactNode;
  icon?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-slate-200/80 bg-white shadow-sm hover:shadow-md transition-shadow p-5",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className="text-[14.5px] font-semibold text-slate-900 flex items-center gap-1.5">
            {icon && <span className="text-primary">{icon}</span>}
            {title}
          </div>
          {subtitle && <div className="text-[12px] text-slate-600 mt-0.5">{subtitle}</div>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
