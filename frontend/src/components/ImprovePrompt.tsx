import { useState } from "react";
import { Wand2, Loader2, Undo2 } from "lucide-react";
import { api } from "../api";
import { Button } from "@/components/ui/button";

/**
 * "Improve prompt" affordance — refines the current text into a precise,
 * professional tax-research query via the LLM, in place, with one-click undo.
 * Mirrors the rewrite helper in Taxmann.AI and similar tools.
 */
export function ImprovePrompt({
  value,
  onChange,
  context = "ask",
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  context?: "ask" | "document";
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [prev, setPrev] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function improve() {
    const text = value.trim();
    if (!text || busy) return;
    setBusy(true); setNote(null);
    try {
      const r = await api.improvePrompt(text, context);
      if (r.changed) {
        setPrev(value);
        onChange(r.improved);
        setNote("Prompt improved");
      } else {
        setNote("Already clear — no change");
      }
    } catch {
      setNote("Couldn't improve prompt");
    } finally {
      setBusy(false);
    }
  }

  function undo() {
    if (prev == null) return;
    onChange(prev);
    setPrev(null);
    setNote(null);
  }

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" size="sm"
        onClick={improve} disabled={disabled || busy || !value.trim()}
        title="Refine your prompt to a precise, professional query">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
        Improve prompt
      </Button>
      {prev != null && (
        <Button type="button" variant="ghost" size="sm" onClick={undo} title="Revert to your original wording">
          <Undo2 className="size-4" /> Undo
        </Button>
      )}
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
    </div>
  );
}
