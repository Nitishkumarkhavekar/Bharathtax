import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  Menu,
  Sparkles,
  Scale,
  BookOpen,
  Calculator,
  Gavel,
  ShieldCheck,
  Landmark,
  ArrowUpRight,
  ScrollText,
} from "lucide-react";
import { ApiError, api } from "../api";
import { useAuth } from "../auth";
import {
  ChatThread,
  ChatMessage,
  deriveTitle,
  loadThreads,
  newThread,
  saveThreads,
} from "@/lib/chatStore";
import ChatSidebar from "@/components/chat/ChatSidebar";
import ChatMessages from "@/components/chat/ChatMessages";
import ChatComposer from "@/components/chat/ChatComposer";
import LicenseGate from "@/components/chat/LicenseGate";
import { cn } from "@/lib/utils";

type Suggestion = {
  text: string;
  category: string;
  icon: typeof BookOpen;
  tone: "blue" | "violet" | "emerald" | "amber" | "rose" | "sky";
};

const SUGGESTIONS: Suggestion[] = [
  {
    text: "What is the maximum deduction under section 80C?",
    category: "Deductions",
    icon: Calculator,
    tone: "blue",
  },
  {
    text: "Explain HRA exemption with a simple example",
    category: "Salary income",
    icon: BookOpen,
    tone: "violet",
  },
  {
    text: "When is an addition under section 68 sustainable?",
    category: "Assessment",
    icon: Gavel,
    tone: "rose",
  },
  {
    text: "Standard deduction for salaried individuals — new vs old regime",
    category: "Tax regime",
    icon: ScrollText,
    tone: "emerald",
  },
  {
    text: "Section 249(4) — condonation of delay in filing an appeal",
    category: "Appeals",
    icon: Landmark,
    tone: "amber",
  },
  {
    text: "TDS default under section 201 — burden of proof principles",
    category: "TDS",
    icon: ShieldCheck,
    tone: "sky",
  },
];

export default function Chat() {
  const { session } = useAuth();
  const username = session?.username ?? "guest";

  // Every visit to /ask (including via the "Chat" link from other pages)
  // starts on a fresh new-chat hero. Past chats remain in the rail and can be
  // re-opened by clicking them.
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [followups, setFollowups] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [module, setModule] = useState("");
  const [style, setStyle] = useState("explanatory");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  // Desktop chat-sidebar collapse — persisted so the preference survives
  // reloads. Default: expanded.
  const [chatSidebarCollapsed, setChatSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("bt_chat_sidebar_collapsed_v1") === "1";
    } catch {
      return false;
    }
  });
  const toggleChatSidebar = () => {
    setChatSidebarCollapsed((c) => {
      const nxt = !c;
      try {
        localStorage.setItem("bt_chat_sidebar_collapsed_v1", nxt ? "1" : "0");
      } catch {
        /* */
      }
      return nxt;
    });
  };
  // Index of the most recently arrived assistant message that should animate
  // in word-by-word. Cleared when the typewriter reaches the end.
  const [streamingIdx, setStreamingIdx] = useState<number | null>(null);

  // Persist a local cache on every change (fallback only).
  useEffect(() => {
    saveThreads(username, threads);
  }, [username, threads]);

  // Load chats from the SERVER (source of truth; syncs across devices). Falls
  // back to the local cache only if the server is unreachable.
  useEffect(() => {
    let alive = true;
    api
      .chatList()
      .then((chats) => {
        if (!alive) return;
        setThreads(
          chats.map((c) => ({
            id: `s_${c.id}`,
            serverId: c.id,
            title: c.title,
            createdAt: Date.parse(c.created_at ?? "") || Date.now(),
            updatedAt: Date.parse(c.updated_at ?? "") || Date.now(),
            messages: [],
          })),
        );
      })
      .catch(() => {
        if (alive) setThreads(loadThreads(username));
      });
    return () => {
      alive = false;
    };
  }, [username]);

  // When username changes (login/logout in same tab), reload threads and clear
  // the active selection so the user lands on the empty hero.
  const lastUser = useRef(username);
  useEffect(() => {
    if (lastUser.current !== username) {
      setActiveId(null);
      setInput("");
      setError(null);
      lastUser.current = username;
    }
  }, [username]);

  // Re-clicking the "Chat" link from another page (or this page) routes to
  // /ask again. react-router doesn't remount the component when the path is
  // the same, so listen on location.key — every navigation gets a new key.
  const loc = useLocation();
  useEffect(() => {
    startNew();
    // We intentionally only respond to navigation events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.key]);

  const active = useMemo(
    () => threads.find((t) => t.id === activeId) ?? null,
    [threads, activeId],
  );

  function startNew() {
    setActiveId(null);
    setInput("");
    setError(null);
    setMobileSidebar(false);
  }

  async function selectThread(id: string) {
    setActiveId(id);
    setError(null);
    setMobileSidebar(false);
    const t = threads.find((x) => x.id === id);
    if (t?.serverId != null && t.messages.length === 0) {
      try {
        const full = await api.chatGet(t.serverId);
        const msgs: ChatMessage[] = (full.messages || []).map((m) => ({
          role: (m.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
          content: m.content,
          citations: m.citations,
          grounded: (m.meta as { grounded?: boolean })?.grounded,
          meta: m.meta,
          ts: Date.parse(m.created_at ?? "") || Date.now(),
        }));
        setThreads((prev) => prev.map((x) => (x.id === id ? { ...x, messages: msgs } : x)));
      } catch {
        /* keep whatever we have */
      }
    }
  }

  function deleteThread(id: string) {
    const gone = threads.find((t) => t.id === id);
    if (gone?.serverId != null) {
      api.chatDelete(gone.serverId).catch(() => {});
    }
    setThreads((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (activeId === id) setActiveId(next[0]?.id ?? null);
      return next;
    });
  }

  function appendMessage(threadId: string, msg: ChatMessage) {
    setThreads((prev) =>
      prev.map((t) =>
        t.id === threadId
          ? { ...t, messages: [...t.messages, msg], updatedAt: Date.now() }
          : t,
      ),
    );
  }

  async function send(override?: string) {
    const text = (typeof override === "string" ? override : input).trim();
    if (!text || busy) return;
    setError(null);
    setFollowups([]);

    // 1. Ensure we have an active thread; create if not.
    let thread = active;
    if (!thread) {
      thread = newThread();
      thread.title = deriveTitle(text);
      thread.messages = [];
      setThreads((prev) => [thread!, ...prev]);
      setActiveId(thread.id);
    } else if (thread.messages.length === 0) {
      // Refine title from the very first message.
      const title = deriveTitle(text);
      setThreads((prev) =>
        prev.map((t) => (t.id === thread!.id ? { ...t, title } : t)),
      );
    }

    // 2. Optimistically add the user message.
    const userMsg: ChatMessage = { role: "user", content: text, ts: Date.now() };
    appendMessage(thread.id, userMsg);
    setInput("");
    setBusy(true);

    // 2b. Ensure a server-owned chat exists so this turn is persisted
    // server-side, isolated to this user. Best-effort — chat still works locally.
    let serverId = thread.serverId ?? null;
    if (serverId == null) {
      try {
        const sc = await api.chatCreate(deriveTitle(text));
        serverId = sc.id;
        const tid = thread.id;
        setThreads((prev) => prev.map((t) => (t.id === tid ? { ...t, serverId: sc.id } : t)));
      } catch {
        /* server persistence is best-effort */
      }
    }

    // 3. Call backend (chat_id -> server persists this turn).
    try {
      const res = await api.ask(text, module || undefined, style, serverId ?? undefined);
      const asstMsg: ChatMessage = {
        role: "assistant",
        content: res.answer,
        citations: res.citations,
        grounded: res.grounded,
        meta: res.meta,
        ts: Date.now(),
      };
      appendMessage(thread.id, asstMsg);
      // Mark the just-appended assistant message (it's now at the end of the
      // thread) for the typewriter animation. Refuses skip animation since
      // the message is short and shown in a different style.
      if (res.grounded !== false) {
        // index of the new assistant message = (count after user push) + 1 for itself - 1
        const newCount = thread.messages.length + 2; // user + assistant just added
        setStreamingIdx(newCount - 1);
      }
      // Topic-relevant follow-up suggestions (best-effort, non-blocking).
      api
        .askFollowups(text, res.answer, module || undefined)
        .then((f) => setFollowups(f.suggestions || []))
        .catch(() => {});
    } catch (err) {
      const detail = err instanceof ApiError ? err.message : "Request failed";
      // Don't append a fake assistant turn for transport errors — keep the
      // user message in place and show an inline error banner so the user can
      // simply retry on the same input.
      setError(detail);
    } finally {
      setBusy(false);
    }
  }

  const empty = !active || active.messages.length === 0;

  return (
    <LicenseGate>
    <div className="h-screen w-screen flex chat-bg overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden sm:flex h-full">
        <ChatSidebar
          threads={threads}
          activeThreadId={active?.id ?? null}
          onSelect={selectThread}
          onNew={startNew}
          onDelete={deleteThread}
          collapsed={chatSidebarCollapsed}
          onToggleCollapsed={toggleChatSidebar}
        />
      </div>

      {/* Mobile sidebar (drawer) */}
      {mobileSidebar && (
        <>
          <div
            className="sm:hidden fixed inset-0 z-40 bg-black/40"
            onClick={() => setMobileSidebar(false)}
          />
          <div className="sm:hidden fixed inset-y-0 left-0 z-50 w-80 max-w-[85%]">
            <ChatSidebar
              threads={threads}
              activeThreadId={active?.id ?? null}
              onSelect={selectThread}
              onNew={startNew}
              onDelete={deleteThread}
              onClose={() => setMobileSidebar(false)}
            />
          </div>
        </>
      )}

      {/* Main */}
      <div className="flex-1 min-w-0 h-full flex flex-col">
        {/* Mobile header */}
        <div className="sm:hidden h-14 shrink-0 border-b border-slate-200 bg-white/60 backdrop-blur flex items-center px-3 gap-2">
          <button
            className="p-2 rounded-md hover:bg-slate-100"
            onClick={() => setMobileSidebar(true)}
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </button>
          <div className="text-sm font-semibold">
            {active?.title ?? "New chat"}
          </div>
        </div>

        {empty ? (
          <EmptyHero
            input={input}
            onInputChange={setInput}
            onSubmit={send}
            busy={busy}
            module={module}
            onModuleChange={setModule}
            style={style}
            onStyleChange={setStyle}
            onPick={(s) => {
              setInput(s);
            }}
            displayName={session?.fullName || session?.username}
            error={error}
          />
        ) : (
          <ActiveChat
            messages={active!.messages}
            input={input}
            onInputChange={setInput}
            onSubmit={send}
            busy={busy}
            module={module}
            onModuleChange={setModule}
            style={style}
            onStyleChange={setStyle}
            error={error}
            streamingIdx={streamingIdx}
            onStreamingDone={() => setStreamingIdx(null)}
            followups={followups}
            onPickFollowup={(q) => { setFollowups([]); send(q); }}
          />
        )}
      </div>
    </div>
    </LicenseGate>
  );
}

function EmptyHero(props: {
  input: string;
  onInputChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
  module: string;
  onModuleChange: (v: string) => void;
  style: string;
  onStyleChange: (v: string) => void;
  onPick: (s: string) => void;
  displayName?: string;
  error: string | null;
}) {
  return (
    <div className="relative flex-1 min-h-0 overflow-y-auto chat-scrollbar">
      {/* Aurora canvas — layered radial gradients + subtle grid dots. */}
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
        <div className="absolute inset-0 bg-[radial-gradient(1100px_500px_at_92%_-10%,rgba(46,124,200,0.18),transparent_60%),radial-gradient(900px_500px_at_-10%_110%,rgba(99,102,241,0.14),transparent_60%),radial-gradient(600px_400px_at_50%_120%,rgba(37,99,235,0.10),transparent_60%),linear-gradient(180deg,#f4f8fd_0%,#eef3fb_100%)]" />
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgb(15 23 42) 1px, transparent 0)",
            backgroundSize: "26px 26px",
          }}
        />
        {/* Soft floating blobs */}
        <div className="absolute -top-20 -left-16 size-96 rounded-full bg-primary/10 blur-3xl animate-pulse [animation-duration:8s]" />
        <div className="absolute -bottom-20 right-0 size-[26rem] rounded-full bg-violet-300/25 blur-3xl animate-pulse [animation-duration:10s]" />
      </div>

      <div className="min-h-full flex items-center justify-center px-4 py-10 sm:py-16">
        <div className="w-full max-w-3xl space-y-8 animate-fade-up">
          {/* Logo mark with glow */}
          <div className="flex justify-center">
            <div className="relative">
              <div className="absolute -inset-6 rounded-full bg-gradient-to-r from-primary/30 via-sky-400/30 to-violet-500/30 blur-2xl animate-pulse [animation-duration:5s]" />
              <div className="relative size-14 rounded-2xl bg-gradient-to-br from-primary via-sky-500 to-violet-600 flex items-center justify-center shadow-lg shadow-primary/30 ring-4 ring-white">
                <Scale className="size-7 text-white" strokeWidth={2.2} />
              </div>
            </div>
          </div>

          <div className="text-center space-y-3">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/70 backdrop-blur ring-1 ring-primary/20 text-primary text-[11px] font-semibold tracking-wide shadow-sm">
              <Sparkles className="size-3" />
              Citation-grounded · primary Indian tax law
            </div>
            <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.05]">
              <span className="text-slate-900">
                {props.displayName
                  ? `Hello, ${capitalize(props.displayName)}.`
                  : "Ready when you are."}
              </span>
              <br />
              <span className="bg-gradient-to-r from-primary via-sky-500 to-violet-500 bg-clip-text text-transparent">
                What would you like to research today?
              </span>
            </h1>
            <p className="text-slate-600 text-[15px] max-w-xl mx-auto">
              Ask anything on the Income-tax Act, Rules, or CBDT circulars.
              Every answer is footnoted with its source.
            </p>
          </div>

          {/* Composer with animated gradient border */}
          <div className="relative">
            <div className="absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-primary/50 via-sky-400/50 to-violet-500/50 opacity-70 blur-md" />
            <div className="relative rounded-2xl bg-white ring-1 ring-slate-200 shadow-xl shadow-primary/5">
              <ChatComposer
                value={props.input}
                onChange={props.onInputChange}
                onSubmit={props.onSubmit}
                busy={props.busy}
                module={props.module}
                onModuleChange={props.onModuleChange}
                style={props.style}
                onStyleChange={props.onStyleChange}
              />
            </div>
          </div>

          {props.error && (
            <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
              {props.error}
            </div>
          )}

          {/* Suggestion cards — categorised, iconified, hover-lift */}
          <div>
            <div className="flex items-center gap-2 mb-3 px-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Suggested starters
              </div>
              <div className="flex-1 h-px bg-gradient-to-r from-slate-200 to-transparent" />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {SUGGESTIONS.map((s) => (
                <SuggestionCard
                  key={s.text}
                  s={s}
                  onPick={() => props.onPick(s.text)}
                />
              ))}
            </div>
          </div>

          {/* Feature strip — the "why trust this" reassurance row */}
          <FeatureStrip />
        </div>
      </div>
    </div>
  );
}

function SuggestionCard({
  s,
  onPick,
}: {
  s: Suggestion;
  onPick: () => void;
}) {
  const toneMap: Record<Suggestion["tone"], string> = {
    blue: "from-sky-500/15 to-blue-500/5 text-sky-700 ring-sky-500/20",
    violet: "from-violet-500/15 to-fuchsia-500/5 text-violet-700 ring-violet-500/20",
    emerald: "from-emerald-500/15 to-teal-500/5 text-emerald-700 ring-emerald-500/20",
    amber: "from-amber-500/20 to-orange-500/5 text-amber-700 ring-amber-500/20",
    rose: "from-rose-500/15 to-red-500/5 text-rose-700 ring-rose-500/20",
    sky: "from-cyan-500/15 to-sky-500/5 text-cyan-700 ring-cyan-500/20",
  };
  const Icon = s.icon;
  return (
    <button
      onClick={onPick}
      className="group relative overflow-hidden text-left rounded-2xl bg-white ring-1 ring-slate-200 hover:ring-primary/30 shadow-sm hover:shadow-lg hover:shadow-primary/10 transition-all duration-200 hover:-translate-y-0.5"
    >
      {/* soft gradient wash on hover */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-br from-primary/[0.03] to-transparent" />
      <div className="relative p-3.5 flex items-start gap-3">
        <div
          className={
            "shrink-0 size-9 rounded-xl bg-gradient-to-br ring-1 flex items-center justify-center " +
            toneMap[s.tone]
          }
        >
          <Icon className="size-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-0.5">
            {s.category}
          </div>
          <div className="text-[13.5px] text-slate-800 leading-snug">
            {s.text}
          </div>
        </div>
        <ArrowUpRight className="size-4 text-slate-300 group-hover:text-primary group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all shrink-0" />
      </div>
    </button>
  );
}

function FeatureStrip() {
  const items: { icon: typeof BookOpen; title: string; sub: string }[] = [
    {
      icon: BookOpen,
      title: "Every claim cited",
      sub: "Act · Rules · CBDT circulars",
    },
    {
      icon: Gavel,
      title: "Appeal drafting",
      sub: "6-module CIT(A) pipeline",
    },
    {
      icon: ShieldCheck,
      title: "Audit-logged",
      sub: "Seat-licensed · per-user tokens",
    },
  ];
  return (
    <div className="grid sm:grid-cols-3 gap-3 pt-4">
      {items.map((it) => (
        <div
          key={it.title}
          className="rounded-xl bg-white/70 backdrop-blur ring-1 ring-slate-200/80 p-3 flex items-center gap-3"
        >
          <div className="size-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center ring-1 ring-primary/15">
            <it.icon className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[12.5px] font-semibold text-slate-900 leading-tight">
              {it.title}
            </div>
            <div className="text-[11px] text-slate-500 truncate">{it.sub}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ActiveChat(props: {
  messages: ChatMessage[];
  input: string;
  onInputChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
  module: string;
  onModuleChange: (v: string) => void;
  style: string;
  onStyleChange: (v: string) => void;
  error: string | null;
  streamingIdx: number | null;
  onStreamingDone: () => void;
  followups: string[];
  onPickFollowup: (q: string) => void;
}) {
  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto chat-scrollbar">
        <ChatMessages
          messages={props.messages}
          busy={props.busy}
          streamingIdx={props.streamingIdx}
          onStreamingDone={props.onStreamingDone}
          followups={props.followups}
          onPickFollowup={props.onPickFollowup}
        />
      </div>
      <div className={cn("shrink-0 border-t border-slate-200 bg-white/60 backdrop-blur")}>
        <div className="mx-auto max-w-3xl w-full px-4 sm:px-6 py-3 space-y-2">
          {props.error && (
            <div className="text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2">
              {props.error}
            </div>
          )}
          <ChatComposer
            value={props.input}
            onChange={props.onInputChange}
            onSubmit={props.onSubmit}
            busy={props.busy}
            module={props.module}
            onModuleChange={props.onModuleChange}
            style={props.style}
            onStyleChange={props.onStyleChange}
            compact
          />
          <div className="text-center text-[10.5px] text-slate-400">
            BharathTax can make mistakes. Verify against the latest Act and CBDT circulars before acting.
          </div>
        </div>
      </div>
    </>
  );
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
