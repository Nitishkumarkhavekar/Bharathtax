import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Menu, Sparkles } from "lucide-react";
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

const SUGGESTIONS = [
  "What is the maximum deduction under section 80C?",
  "Explain HRA exemption with a simple example",
  "When is an addition under section 68 sustainable?",
  "Standard deduction for salaried individuals — new vs old regime",
];

export default function Chat() {
  const { session } = useAuth();
  const username = session?.username ?? "guest";

  // Every visit to /ask (including via the "Ask Bot" link from other pages)
  // starts on a fresh new-chat hero. Past chats remain in the rail and can be
  // re-opened by clicking them.
  const [threads, setThreads] = useState<ChatThread[]>(() => loadThreads(username));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [module, setModule] = useState("");
  const [style, setStyle] = useState("explanatory");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  // Index of the most recently arrived assistant message that should animate
  // in word-by-word. Cleared when the typewriter reaches the end.
  const [streamingIdx, setStreamingIdx] = useState<number | null>(null);

  // Persist on every change.
  useEffect(() => {
    saveThreads(username, threads);
  }, [username, threads]);

  // When username changes (login/logout in same tab), reload threads and clear
  // the active selection so the user lands on the empty hero.
  const lastUser = useRef(username);
  useEffect(() => {
    if (lastUser.current !== username) {
      setThreads(loadThreads(username));
      setActiveId(null);
      setInput("");
      setError(null);
      lastUser.current = username;
    }
  }, [username]);

  // Re-clicking the "Ask Bot" link from another page (or this page) routes to
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

  function selectThread(id: string) {
    setActiveId(id);
    setError(null);
    setMobileSidebar(false);
  }

  function deleteThread(id: string) {
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

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setError(null);

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

    // 3. Call backend.
    try {
      const res = await api.ask(text, module || undefined, style);
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
            displayName={session?.username}
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
    <div className="flex-1 min-h-0 flex items-center justify-center px-4">
      <div className="w-full max-w-2xl -mt-10 space-y-7 animate-fade-up">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-medium">
            <Sparkles className="size-3" />
            Citation-grounded · primary Indian tax law
          </div>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-foreground">
            {props.displayName ? `Hello, ${capitalize(props.displayName)}.` : "Ready when you are."}
          </h1>
          <p className="text-slate-500">
            Ask anything about Indian income tax. I cite the section, rule, or circular.
          </p>
        </div>

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

        {props.error && (
          <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
            {props.error}
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-2.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => props.onPick(s)}
              className="text-left text-[13.5px] text-slate-700 rounded-xl border border-slate-200 bg-white px-3.5 py-3 hover:border-primary/40 hover:bg-primary/[0.03] transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
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
}) {
  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto chat-scrollbar">
        <ChatMessages
          messages={props.messages}
          busy={props.busy}
          streamingIdx={props.streamingIdx}
          onStreamingDone={props.onStreamingDone}
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
