// Calculator history — per-user, per-browser, kept in localStorage.
// Stored as newest-first, capped at MAX so a heavy user's history never
// explodes the LS quota. Every calculator writes one entry on Compute; the
// history drawer reads/paginates and restores an entry into the calculator
// when clicked.
//
// Storage is deliberately local — these are working figures, not shared,
// and users often prefer them not to leave the device. If we later want
// cross-device sync we can add a /calculators/history backend without
// changing the calculator components.

import { useCallback, useEffect, useState } from "react";

const KEY = "bharattax_calc_history_v1";
const MAX = 100;

export type CalcTab =
  | "interest" | "234c" | "tds" | "recovery" | "trust" | "peak" | "alp"
  | "bbe" | "slab" | "capgains" | "penalty";

export interface CalcHistoryEntry {
  id: string;
  tab: CalcTab;
  // Inputs snapshot — free-shape so each calculator stores what it needs.
  // Never contains anything sensitive; every calc keeps only user-entered
  // numbers + dropdown selections.
  inputs: Record<string, unknown>;
  // Short human-readable summary of the result — shown on the history
  // row so the user recognises the entry without re-computing.
  summary: string;
  at: number; // epoch ms
}

function read(): CalcHistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e) => e && typeof e.id === "string");
  } catch {
    return [];
  }
}

function write(entries: CalcHistoryEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX)));
  } catch {
    /* quota exceeded → silently drop */
  }
}

// Cross-tab sync — if the same user has two tabs open and computes on
// one, the other picks up the new entry on window focus / storage event.
function subscribe(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) cb(); };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

export function useCalcHistory() {
  const [entries, setEntries] = useState<CalcHistoryEntry[]>(() => read());

  useEffect(() => subscribe(() => setEntries(read())), []);

  const push = useCallback((
    tab: CalcTab, inputs: Record<string, unknown>, summary: string,
  ) => {
    const entry: CalcHistoryEntry = {
      id: (crypto.randomUUID?.() ?? String(Math.random()).slice(2)),
      tab, inputs, summary,
      at: Date.now(),
    };
    setEntries((prev) => {
      // De-dup: if the previous entry has the same tab + inputs, replace it
      // instead of piling identical rows. A user hitting Compute twice with
      // no changes shouldn't create two history rows.
      const first = prev[0];
      const sameShape = first && first.tab === tab &&
        JSON.stringify(first.inputs) === JSON.stringify(inputs);
      const next = sameShape
        ? [{ ...entry, id: first.id }, ...prev.slice(1)]
        : [entry, ...prev];
      const capped = next.slice(0, MAX);
      write(capped);
      return capped;
    });
    return entry;
  }, []);

  const remove = useCallback((id: string) => {
    setEntries((prev) => {
      const next = prev.filter((e) => e.id !== id);
      write(next);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setEntries([]);
    write([]);
  }, []);

  return { entries, push, remove, clearAll };
}
