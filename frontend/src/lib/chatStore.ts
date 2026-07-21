// Per-user chat persistence in localStorage.
//
// We use the existing /history backend for audit, but threads (i.e. the
// multi-turn ChatGPT-style transcript with a sidebar list) are a UX layer that
// the API doesn't model yet — so we persist them client-side, scoped to the
// logged-in user so multiple accounts on the same browser don't collide.

import { Citation } from "../api";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  // Assistant-only metadata
  citations?: Citation[];
  grounded?: boolean;
  meta?: Record<string, unknown>;
  ts: number;
}

export interface ChatThread {
  id: string;
  serverId?: number; // id of the owning server-side chat row (if persisted)
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

const STORAGE_PREFIX = "bharathtax_chats_v1:";

function key(username: string): string {
  return STORAGE_PREFIX + username;
}

export function loadThreads(username: string): ChatThread[] {
  try {
    const raw = localStorage.getItem(key(username));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatThread[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveThreads(username: string, threads: ChatThread[]): void {
  try {
    localStorage.setItem(key(username), JSON.stringify(threads));
  } catch {
    /* localStorage full / private mode — accept the loss */
  }
}

export function newThread(): ChatThread {
  const now = Date.now();
  return {
    id: `t_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    title: "New chat",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

// Build a short, presentable title from the first user message.
export function deriveTitle(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 48) return cleaned || "New chat";
  // Try to cut at a word boundary near 48 chars.
  const cut = cleaned.slice(0, 48);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 24 ? cut.slice(0, lastSpace) : cut) + "…";
}

export function groupByRecency(threads: ChatThread[]): {
  label: string;
  threads: ChatThread[];
}[] {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const today: ChatThread[] = [];
  const yesterday: ChatThread[] = [];
  const week: ChatThread[] = [];
  const earlier: ChatThread[] = [];
  for (const t of [...threads].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const age = now - t.updatedAt;
    if (age < dayMs) today.push(t);
    else if (age < 2 * dayMs) yesterday.push(t);
    else if (age < 7 * dayMs) week.push(t);
    else earlier.push(t);
  }
  return [
    { label: "Today", threads: today },
    { label: "Yesterday", threads: yesterday },
    { label: "Previous 7 days", threads: week },
    { label: "Earlier", threads: earlier },
  ].filter((g) => g.threads.length > 0);
}
