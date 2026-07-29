// Shared modal + form primitives used across the admin console.
// Goals: gradient header band, icon-prefixed fields, soft entrance, consistent
// rhythm and footer styling so every modal feels like the same product.

import { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "primary" | "amber" | "rose" | "emerald" | "violet";

const HEADER_GRADIENT: Record<Tone, string> = {
  primary: "bg-primary",
  amber: "bg-amber-600",
  rose: "bg-rose-600",
  emerald: "bg-emerald-600",
  violet: "bg-primary",
};

// -------------------------------------------------------- ModalShell
export function ModalShell({
  open,
  onClose,
  title,
  subtitle,
  icon,
  tone = "primary",
  size = "md",
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  tone?: Tone;
  size?: "sm" | "md" | "lg";
  children: ReactNode;
  footer?: ReactNode;
}) {
  if (!open) return null;
  const widths = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" };
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-fade-up"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={cn(
          "relative w-full max-h-[90vh] flex flex-col overflow-hidden rounded-2xl bg-white shadow-2xl border border-slate-200",
          widths[size],
        )}
      >
        {/* Header band */}
        <div
          className={cn(
            "relative shrink-0 px-6 py-5 text-white",
            HEADER_GRADIENT[tone],
          )}
        >
          <div className="relative flex items-start gap-3">
            {icon && (
              <div className="size-10 rounded-xl bg-white/15 ring-1 ring-white/25 flex items-center justify-center shrink-0">
                {icon}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-base font-semibold tracking-tight text-white">{title}</div>
              {subtitle && (
                <div className="text-[12.5px] text-white/90 mt-0.5 leading-snug">{subtitle}</div>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-white/95 hover:bg-white/20 hover:text-white transition-colors shrink-0"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Body — sits cleanly below the header; the soft shadow under the
            white surface gives depth without the previous label-overlap bug. */}
        <div className="bg-white flex-1 min-h-0 overflow-y-auto">
          <div className="px-6 py-5 space-y-4">{children}</div>
        </div>

        {footer && (
          <div className="shrink-0 px-6 py-3 border-t border-slate-100 bg-slate-50/80 flex items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------- Field
export function Field({
  label,
  hint,
  required,
  rightSlot,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  required?: boolean;
  rightSlot?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[12.5px] font-semibold text-slate-800 flex items-center gap-1">
          {label}
          {required && <span className="text-rose-500">*</span>}
        </label>
        {rightSlot}
      </div>
      {children}
      {hint && <div className="mt-1.5 text-[11px] text-slate-600 leading-snug">{hint}</div>}
    </div>
  );
}

// -------------------------------------------------------- IconInput
export function IconInput({
  icon,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode }) {
  return (
    <div className="relative">
      {icon && (
        <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
          {icon}
        </div>
      )}
      <input
        {...props}
        className={cn(
          "w-full h-10 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 shadow-sm",
          "focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 placeholder:text-slate-400",
          "transition-shadow",
          icon ? "pl-10 pr-3" : "px-3",
          className,
        )}
      />
    </div>
  );
}

// -------------------------------------------------------- IconSelect
export function IconSelect({
  icon,
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { icon?: ReactNode }) {
  return (
    <div className="relative">
      {icon && (
        <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
          {icon}
        </div>
      )}
      <select
        {...props}
        className={cn(
          "w-full h-10 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 shadow-sm appearance-none",
          "focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20",
          "transition-shadow",
          icon ? "pl-10 pr-9" : "px-3 pr-9",
          className,
        )}
      >
        {children}
      </select>
      <svg
        viewBox="0 0 12 8"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 size-3 text-slate-500"
        fill="none"
        stroke="currentColor"
      >
        <path d="M1 1.5L6 6L11 1.5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

// -------------------------------------------------------- Textarea
export function FancyTextarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "w-full min-h-[88px] rounded-lg border border-slate-200 bg-white text-sm text-slate-900 px-3 py-2 shadow-sm",
        "focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 placeholder:text-slate-400",
        "transition-shadow",
        className,
      )}
    />
  );
}
