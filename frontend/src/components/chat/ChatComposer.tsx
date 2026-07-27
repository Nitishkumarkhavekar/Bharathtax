import { FormEvent, KeyboardEvent, useEffect, useRef } from "react";
import { ArrowUp, Loader2, Sparkles } from "lucide-react";
import { ImprovePrompt } from "@/components/ImprovePrompt";
import { cn } from "@/lib/utils";

const MODULES = [
  { value: "", label: "All modules" },
  { value: "income_tax", label: "Income Tax" },
  { value: "gst", label: "GST (soon)" },
  { value: "customs", label: "Customs (soon)" },
];
const STYLES = [
  { value: "explanatory", label: "Explanatory" },
  { value: "concise", label: "Concise" },
];

interface ChatComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
  module: string;
  onModuleChange: (v: string) => void;
  style: string;
  onStyleChange: (v: string) => void;
  compact?: boolean; // bottom-docked mode
}

export default function ChatComposer({
  value,
  onChange,
  onSubmit,
  busy,
  module,
  onModuleChange,
  style,
  onStyleChange,
  compact,
}: ChatComposerProps) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // auto-grow
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, compact ? 200 : 260) + "px";
  }, [value, compact]);

  // Keep the cursor ready in the box: focus on mount and every time we return
  // to idle after an answer (the textarea is disabled while busy, which drops
  // focus). So the officer can just start typing the next question — no click.
  useEffect(() => {
    if (!busy) taRef.current?.focus();
  }, [busy]);

  function handleSubmit(e?: FormEvent) {
    e?.preventDefault();
    if (!value.trim() || busy) return;
    onSubmit();
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        "composer-shell w-full",
        compact ? "px-3 py-2.5" : "px-4 py-3.5",
      )}
    >
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKey}
        placeholder="Ask a tax-law question — e.g. when is an addition under s.68 sustainable?"
        rows={1}
        disabled={busy}
        className={cn(
          "block w-full resize-none border-0 bg-transparent focus:outline-none placeholder:text-slate-400",
          compact ? "text-[14.5px] leading-6 min-h-[28px]" : "text-[15px] leading-7 min-h-[36px]",
        )}
      />
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <ImprovePrompt value={value} onChange={onChange} context="ask" disabled={busy} />
        <select
          className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary/30"
          value={module}
          onChange={(e) => onModuleChange(e.target.value)}
          disabled={busy}
        >
          {MODULES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <select
          className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary/30"
          value={style}
          onChange={(e) => onStyleChange(e.target.value)}
          disabled={busy}
        >
          {STYLES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-2">
          {!compact && (
            <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-slate-400">
              <Sparkles className="size-3" /> citation-grounded
            </span>
          )}
          <button
            type="submit"
            disabled={busy || !value.trim()}
            className={cn(
              "inline-flex items-center justify-center rounded-full transition-all",
              "size-9 bg-primary text-white shadow-sm",
              "hover:bg-primary/90 active:scale-95",
              "disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none disabled:cursor-not-allowed",
            )}
            aria-label="Send"
            title="Send (Enter)"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
          </button>
        </div>
      </div>
    </form>
  );
}
