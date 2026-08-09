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
  Share2,
  Check,
} from "lucide-react";
import { ApiError, api } from "../api";
import { toast } from "@/lib/toast";
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
import ArchivedDialog from "@/components/chat/ArchivedDialog";
import { ServerChat } from "../api";
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

const STARTER_TONES: Suggestion["tone"][] = ["blue", "violet", "emerald", "amber", "rose", "sky"];

function toSuggestion(item: { category: string; text: string }, i: number): Suggestion {
  const k = (item.category || "").toLowerCase();
  let icon = ScrollText;
  if (/deduc|80c|80d|80g|chapter vi/.test(k)) icon = Calculator;
  else if (/salary|hra|allowance|perquisit/.test(k)) icon = BookOpen;
  else if (/assess|scrutin|reassess|search|survey|68/.test(k)) icon = Gavel;
  else if (/regime|slab|standard/.test(k)) icon = ScrollText;
  else if (/appeal|revision|itat|tribunal/.test(k)) icon = Landmark;
  else if (/tds|tcs|penal|prosecut|194|201/.test(k)) icon = ShieldCheck;
  else if (/capital|gain|property|54/.test(k)) icon = Calculator;
  else if (/international|dtaa|foreign|nri|transfer pric|fatca/.test(k)) icon = BookOpen;
  return { text: item.text, category: item.category, icon, tone: STARTER_TONES[i % STARTER_TONES.length] };
}

export default function Chat() {
  const { session } = useAuth();
  const username = session?.username ?? "guest";

  // Every visit to /ask (including via the "Chat" link from other pages)
  // starts on a fresh new-chat hero. Past chats remain in the rail and can be
  // re-opened by clicking them.
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [followups, setFollowups] = useState<string[]>([]);
  const [clarify, setClarify] = useState<{ question: string; options: string[] } | null>(null);
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
  // Live token-streaming: index of the assistant message being filled in real
  // time, and the current tool status shown before the first token arrives.
  const [liveIdx, setLiveIdx] = useState<number | null>(null);
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  // Aborts the in-flight stream when the user hits Stop.
  const abortRef = useRef<AbortController | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);

  // A chat restored from the Archived dialog re-enters the active list.
  function onUnarchived(c: ServerChat) {
    setThreads((prev) => {
      if (prev.some((t) => t.serverId === c.id)) return prev;
      return [
        {
          id: `s_${c.id}`,
          serverId: c.id,
          title: c.title,
          pinned: c.pinned,
          archived: false,
          createdAt: Date.parse(c.created_at ?? "") || Date.now(),
          updatedAt: Date.parse(c.updated_at ?? "") || Date.now(),
          messages: [],
        },
        ...prev,
      ];
    });
  }

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
            pinned: c.pinned,
            archived: c.archived,
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
      api.chatDelete(gone.serverId).catch(() =>
        toast.error("Couldn't delete the chat on the server"));
    }
    setThreads((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (activeId === id) setActiveId(next[0]?.id ?? null);
      return next;
    });
    toast.success("Chat deleted");
  }

  function renameThread(id: string, title: string) {
    setThreads((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)));
    const t = threads.find((x) => x.id === id);
    if (t?.serverId != null)
      api.chatPatch(t.serverId, { title })
        .then(() => toast.success("Chat renamed"))
        .catch(() => toast.error("Couldn't rename the chat"));
  }

  function togglePin(id: string) {
    const t = threads.find((x) => x.id === id);
    const next = !t?.pinned;
    setThreads((prev) => prev.map((x) => (x.id === id ? { ...x, pinned: next } : x)));
    if (t?.serverId != null)
      api.chatPatch(t.serverId, { pinned: next }).catch(() =>
        toast.error("Couldn't update pin"));
    toast.success(next ? "Pinned to top" : "Unpinned");
  }

  function archiveThread(id: string) {
    const t = threads.find((x) => x.id === id);
    if (t?.serverId != null)
      api.chatPatch(t.serverId, { archived: true }).catch(() =>
        toast.error("Couldn't archive the chat"));
    // Archived chats drop out of the active list.
    setThreads((prev) => {
      const next = prev.filter((x) => x.id !== id);
      if (activeId === id) setActiveId(null);
      return next;
    });
    toast.success("Chat archived");
  }

  // Stream an answer into the assistant message at `asstIdx` of thread `tid`.
  // Shared by send() (a new turn) and regenerate() (re-run in place). When
  // `persist` is false (regenerate) the turn is not written server-side, so a
  // reload shows the original — avoids duplicate answers in the server log.
  async function streamInto(
    tid: string,
    asstIdx: number,
    question: string,
    serverId: number | null,
    persist: boolean,
  ) {
    const patchAsst = (patch: Partial<ChatMessage>) =>
      setThreads((prev) =>
        prev.map((t) =>
          t.id === tid
            ? {
                ...t,
                messages: t.messages.map((m, i) => (i === asstIdx ? { ...m, ...patch } : m)),
                updatedAt: Date.now(),
              }
            : t,
        ),
      );

    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setLiveIdx(asstIdx);
    setLiveStatus("Thinking");
    const acc = { text: "" };
    const clarifyRef = { clarified: false };
    try {
      await api.askStream(
        question,
        { domain: module || undefined, style, chatId: persist ? serverId ?? undefined : undefined },
        {
          onStatus: (s) => setLiveStatus(s),
          onDelta: (d) => {
            acc.text += d;
            setLiveStatus(null);
            patchAsst({ content: acc.text });
          },
          onReset: () => {
            acc.text = "";
            patchAsst({ content: "" });
          },
          onError: (msg) => setError(msg),
          onDone: ({ grounded, citations, meta }) => {
            const c = (meta as Record<string, unknown> | undefined)?.["clarify"] as
              | { question: string; options: string[] }
              | undefined;
            clarifyRef.clarified = !!c;
            setClarify(c ?? null);
            patchAsst({ content: acc.text, grounded, citations, meta });
          },
        },
        controller.signal,
      );
      if (!clarifyRef.clarified)
        api
          .askFollowups(question, acc.text, module || undefined)
          .then((f) => setFollowups(f.suggestions || []))
          .catch(() => {});
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        // User hit Stop — keep the partial answer as-is.
        if (!acc.text) patchAsst({ content: "_(stopped)_" });
      } else {
        // Streaming failed before completing — fall back to the plain endpoint.
        try {
          const res = await api.ask(question, module || undefined, style, persist ? serverId ?? undefined : undefined);
          patchAsst({ content: res.answer, grounded: res.grounded, citations: res.citations, meta: res.meta });
          api
            .askFollowups(question, res.answer, module || undefined)
            .then((f) => setFollowups(f.suggestions || []))
            .catch(() => {});
        } catch (e) {
          setError(e instanceof ApiError ? e.message : "Request failed");
        }
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      setLiveIdx(null);
      setLiveStatus(null);
    }
  }

  function stopGenerating() {
    abortRef.current?.abort();
  }

  // Re-run the question that produced the assistant message at `idx`, streaming
  // the fresh answer into that same bubble.
  function regenerate(idx: number) {
    if (busy || !active) return;
    const userMsg = active.messages[idx - 1];
    if (!userMsg || userMsg.role !== "user") return;
    const tid = active.id;
    setError(null);
    setFollowups([]);
    setClarify(null);
    setThreads((prev) =>
      prev.map((t) =>
        t.id === tid
          ? {
              ...t,
              messages: t.messages.map((m, i) =>
                i === idx ? { ...m, content: "", citations: undefined, meta: undefined, grounded: undefined } : m,
              ),
            }
          : t,
      ),
    );
    void streamInto(tid, idx, userMsg.content, active.serverId ?? null, false);
  }

  // Edit the user prompt at `uidx` and regenerate the conversation from there.
  function editPrompt(uidx: number, content: string) {
    if (busy || !active) return;
    const um = active.messages[uidx];
    if (!um || um.role !== "user") return;
    const v = content.trim();
    if (!v) return;
    const tid = active.id;
    setError(null);
    setFollowups([]);
    setClarify(null);
    setThreads((prev) =>
      prev.map((x) => {
        if (x.id !== tid) return x;
        const msgs = x.messages.slice(0, uidx);
        msgs.push({ ...um, content: v });
        msgs.push({ role: "assistant", content: "", ts: Date.now() });
        return { ...x, messages: msgs };
      }),
    );
    void streamInto(tid, uidx + 1, v, active.serverId ?? null, false);
  }

  async function send(override?: string) {
    const text = (typeof override === "string" ? override : input).trim();
    if (!text || busy) return;
    setError(null);
    setFollowups([]);
    setClarify(null);

    // 1. Ensure we have an active thread; create if not.
    let thread = active;
    if (!thread) {
      thread = newThread();
      thread.title = deriveTitle(text);
      thread.messages = [];
      setThreads((prev) => [thread!, ...prev]);
      setActiveId(thread.id);
    } else if (thread.messages.length === 0) {
      const title = deriveTitle(text);
      setThreads((prev) => prev.map((t) => (t.id === thread!.id ? { ...t, title } : t)));
    }

    // 2. Optimistically add the user message + an empty assistant message that
    // the stream will fill in place. Its index is stable for the rest of send().
    const asstIdx = thread.messages.length + 1;
    const tid = thread.id;
    const userMsg: ChatMessage = { role: "user", content: text, ts: Date.now() };
    const asstMsg: ChatMessage = { role: "assistant", content: "", ts: Date.now() };
    setThreads((prev) =>
      prev.map((t) =>
        t.id === tid
          ? { ...t, messages: [...t.messages, userMsg, asstMsg], updatedAt: Date.now() }
          : t,
      ),
    );
    setInput("");

    // 3. Ensure a server-owned chat exists so this turn is persisted, then stream.
    let serverId = thread.serverId ?? null;
    if (serverId == null) {
      try {
        const sc = await api.chatCreate(deriveTitle(text));
        serverId = sc.id;
        setThreads((prev) => prev.map((t) => (t.id === tid ? { ...t, serverId: sc.id } : t)));
      } catch {
        /* server persistence is best-effort */
      }
    }
    await streamInto(tid, asstIdx, text, serverId, true);
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
          onRename={renameThread}
          onTogglePin={togglePin}
          onArchive={archiveThread}
          onOpenArchived={() => setArchivedOpen(true)}
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
              onRename={renameThread}
              onTogglePin={togglePin}
              onArchive={archiveThread}
              onOpenArchived={() => setArchivedOpen(true)}
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
            title={active!.title}
            serverId={active!.serverId ?? null}
            input={input}
            onInputChange={setInput}
            onSubmit={send}
            busy={busy}
            module={module}
            onModuleChange={setModule}
            style={style}
            onStyleChange={setStyle}
            error={error}
            liveIdx={liveIdx}
            liveStatus={liveStatus}
            followups={followups}
            onPickFollowup={(q) => { setFollowups([]); send(q); }}
            onStop={stopGenerating}
            onRegenerate={regenerate}
            onEditPrompt={editPrompt}
            onClarify={(txt) => send(txt)}
            clarify={clarify}
          />
        )}
      </div>
      <ArchivedDialog
        open={archivedOpen}
        onClose={() => setArchivedOpen(false)}
        onUnarchived={onUnarchived}
      />
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
  const [cards, setCards] = useState<Suggestion[]>(SUGGESTIONS);
  useEffect(() => {
    let alive = true;
    api
      .askStarters()
      .then((items) => {
        if (alive && Array.isArray(items) && items.length) setCards(items.map(toSuggestion));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return (
    <div className="relative flex-1 min-h-0 overflow-y-auto chat-scrollbar">
      <div className="min-h-full flex items-center justify-center px-4 py-10 sm:py-16">
        <div className="w-full max-w-3xl space-y-8 animate-fade-up">
          {/* Logo mark */}
          <div className="flex justify-center">
            <div className="size-14 rounded-2xl bg-primary flex items-center justify-center shadow-sm ring-1 ring-primary/20">
              <Scale className="size-7 text-white" strokeWidth={2.2} />
            </div>
          </div>

          <div className="text-center space-y-3">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent ring-1 ring-primary/15 text-accent-foreground text-[11px] font-semibold tracking-wide">
              <Sparkles className="size-3" />
              Citation-grounded · primary Indian tax law
            </div>
            <h1 className="font-serif text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.08]">
              <span className="text-slate-900">
                {props.displayName
                  ? `Hello, ${capitalize(props.displayName)}.`
                  : "Ready when you are."}
              </span>
              <br />
              <span className="text-primary">
                What would you like to research today?
              </span>
            </h1>
            <p className="text-slate-600 text-[15px] max-w-xl mx-auto">
              Ask anything on the Income-tax Act, Rules, or CBDT circulars.
              Every answer is footnoted with its source.
            </p>
          </div>

          {/* Composer */}
          <div className="relative">
            <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-md">
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
              <div className="flex-1 h-px bg-slate-200" />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {cards.map((s) => (
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
    blue: "bg-primary/[0.08] text-primary ring-primary/20",
    violet: "bg-primary/[0.08] text-primary ring-primary/20",
    emerald: "bg-primary/[0.08] text-primary ring-primary/20",
    amber: "bg-primary/[0.08] text-primary ring-primary/20",
    rose: "bg-primary/[0.08] text-primary ring-primary/20",
    sky: "bg-primary/[0.08] text-primary ring-primary/20",
  };
  const Icon = s.icon;
  return (
    <button
      onClick={onPick}
      className="group relative text-left rounded-2xl bg-white ring-1 ring-slate-200 hover:ring-primary/30 shadow-sm hover:shadow-md transition-all duration-200"
    >
      <div className="relative p-3.5 flex items-start gap-3">
        <div
          className={
            "shrink-0 size-9 rounded-xl ring-1 flex items-center justify-center " +
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

// Share = an internal read-only link. Only signed-in BharatTax users who have
// the link can open it. One click generates the link and copies it — the
// per-answer Copy button already covers copying text, so there's no copy here.
function ShareMenu({ serverId }: { serverId: number | null }) {
  const [state, setState] = useState<"idle" | "busy" | "copied" | "error">("idle");
  async function share() {
    if (serverId == null) {
      setState("error");
      setTimeout(() => setState("idle"), 2000);
      return;
    }
    setState("busy");
    try {
      const { share_id } = await api.chatShare(serverId);
      const url = `${window.location.origin}/shared/${share_id}`;
      await navigator.clipboard?.writeText(url);
      setState("copied");
      setTimeout(() => setState("idle"), 2200);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 2000);
    }
  }
  const label =
    state === "busy" ? "Creating…"
    : state === "copied" ? "Link copied"
    : state === "error" ? "Start a chat first"
    : "Share";
  return (
    <button
      onClick={share}
      disabled={state === "busy"}
      title="Copy a read-only link (only signed-in users can open it)"
      className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-slate-500 hover:text-slate-800 px-2.5 py-1.5 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-60"
    >
      {state === "copied" ? <Check className="size-3.5 text-emerald-600" /> : <Share2 className="size-3.5" />}
      {label}
    </button>
  );
}

function ActiveChat(props: {
  messages: ChatMessage[];
  title: string;
  serverId: number | null;
  input: string;
  onInputChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
  module: string;
  onModuleChange: (v: string) => void;
  style: string;
  onStyleChange: (v: string) => void;
  error: string | null;
  liveIdx: number | null;
  liveStatus: string | null;
  followups: string[];
  onPickFollowup: (q: string) => void;
  onStop: () => void;
  onRegenerate: (idx: number) => void;
  onEditPrompt: (idx: number, content: string) => void;
  onClarify: (text: string) => void;
  clarify: { question: string; options: string[] } | null;
}) {
  return (
    <>
      <div className="hidden sm:flex shrink-0 items-center justify-between h-12 px-5 border-b border-slate-200/70 bg-white/50 backdrop-blur">
        <div className="text-[13.5px] font-semibold text-slate-800 truncate">{props.title}</div>
        <ShareMenu serverId={props.serverId} />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto chat-scrollbar">
        <ChatMessages
          messages={props.messages}
          busy={props.busy}
          liveIdx={props.liveIdx}
          liveStatus={props.liveStatus}
          followups={props.followups}
          onPickFollowup={props.onPickFollowup}
          onRegenerate={props.onRegenerate}
          onEditPrompt={props.onEditPrompt}
          onClarify={props.onClarify}
        />
      </div>
      <div className={cn("shrink-0 border-t border-slate-200 bg-white/60 backdrop-blur")}>
        <div className="mx-auto max-w-3xl w-full px-4 sm:px-6 py-3 space-y-2">
          {props.error && (
            <div className="text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2">
              {props.error}
            </div>
          )}
          {/* Clarification options render inside the assistant message via
              ChatMessages' ClarifyPanel — no duplicate strip needed here. */}
          <ChatComposer
            value={props.input}
            onChange={props.onInputChange}
            onSubmit={props.onSubmit}
            busy={props.busy}
            module={props.module}
            onModuleChange={props.onModuleChange}
            style={props.style}
            onStyleChange={props.onStyleChange}
            onStop={props.onStop}
            compact
          />
          <div className="text-center text-[10.5px] text-slate-400">
            BharatTax can make mistakes. Verify against the latest Act and CBDT circulars before acting.
          </div>
        </div>
      </div>
    </>
  );
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
