import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  Menu,
  Sparkles,
  BookOpen,
  Calculator,
  Gavel,
  ShieldCheck,
  Landmark,
  ArrowUpRight,
  ScrollText,
  Share2,
  Check,
  X,
} from "lucide-react";
import { ApiError, api } from "../api";
import { toast } from "@/lib/toast";
import { useAuth } from "../auth";
import { resolveStarters } from "../lib/workspaceProfiles";
import TodayBriefing from "@/components/TodayBriefing";
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
import ChatComposer, { ComposerAttachment } from "@/components/chat/ChatComposer";
import LicenseGate from "@/components/chat/LicenseGate";
import ArchivedDialog from "@/components/chat/ArchivedDialog";
import { ServerChat } from "../api";
import { cn } from "@/lib/utils";
import PageHelp from "@/components/PageHelp";

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
  // Prompt queue — while the assistant is generating an answer, a new
  // Send doesn't try to fire immediately (that would either interrupt
  // the stream or race the abort logic). Instead we stash the text +
  // attachments here, show a small banner, and auto-fire when `busy`
  // flips false. The user can edit or cancel the queued prompt before
  // it goes out.
  type QueuedPrompt = { text: string; attachments: ComposerAttachment[] };
  const [queued, setQueued] = useState<QueuedPrompt | null>(null);
  const queuedRef = useRef<QueuedPrompt | null>(null);
  useEffect(() => { queuedRef.current = queued; }, [queued]);
  // Auto-fire the queued prompt the moment the assistant becomes idle
  // (busy flips false). We check queuedRef inside a microtask so we
  // don't race any state updates the streamInto tail is committing.
  useEffect(() => {
    if (busy) return;
    const q = queuedRef.current;
    if (!q) return;
    setQueued(null);
    // Fire on next tick so React commits the "cleared queue" state
    // before the new turn adds messages.
    setTimeout(() => { void send(q.text, q.attachments); }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

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

  // Abort any in-flight answer stream when leaving the page, so the SSE reader
  // stops and we don't setState on an unmounted component.
  useEffect(() => () => abortRef.current?.abort(), []);

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
  // BUT: when the user just clicked "Continue this chat" from a shared view,
  // we DON'T want to reset — SharedChat stashes the forked chat id in
  // sessionStorage and the effect below picks it up. Only reset when there
  // is no pending chat to open.
  const loc = useLocation();
  useEffect(() => {
    try {
      if (sessionStorage.getItem("bt_open_chat_id")) return;
    } catch { /* */ }
    startNew();
    // Pre-fill the composer when the URL carries a ?q= param — used when
    // the user re-opens a past question from the History page. Runs after
    // startNew() so the fresh thread is created before we drop text in.
    try {
      const q = new URLSearchParams(loc.search).get("q");
      if (q) setInput(q);
    } catch { /* URLSearchParams unavailable */ }
    // We intentionally only respond to navigation events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.key]);

  // If we arrived here via "Continue this chat" on the shared view (or any
  // other flow that stashed a target chat id in sessionStorage), open that
  // chat once the server-side chat list has been fetched. The storage key
  // is consumed exactly once — subsequent navigations behave normally.
  useEffect(() => {
    let openId: string | null = null;
    try {
      openId = sessionStorage.getItem("bt_open_chat_id");
    } catch { /* */ }
    if (!openId) return;
    const target = threads.find((t) => t.serverId != null && String(t.serverId) === openId);
    if (!target) return;
    try { sessionStorage.removeItem("bt_open_chat_id"); } catch { /* */ }
    void selectThread(target.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads]);

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
        const msgs: ChatMessage[] = (full.messages || []).map((m) => {
          const meta = (m.meta ?? {}) as {
            grounded?: boolean;
            attachments?: import("@/lib/chatStore").ChatAttachment[];
          };
          return {
            role: (m.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
            content: m.content,
            citations: m.citations,
            grounded: meta.grounded,
            // Rehydrate the composer chip on reload: the server stored the
            // attachment metadata on the user message's meta.attachments
            // (see /ask persist path). Hoist it back onto the top-level
            // field the renderer reads.
            ...(meta.attachments && Array.isArray(meta.attachments) && meta.attachments.length
              ? { attachments: meta.attachments }
              : {}),
            meta: m.meta,
            ts: Date.parse(m.created_at ?? "") || Date.now(),
          };
        });
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

  // Generate (or re-use) the server-side share token for this chat and
  // copy the resulting URL to the clipboard. Any signed-in BharathTax
  // user with the link can then open a read-only view of the chat and
  // click "Continue this chat" to fork it into their own account.
  async function shareThread(id: string) {
    const t = threads.find((x) => x.id === id);
    if (!t?.serverId) {
      // Purely local chat with no server row yet — persist it first so
      // it has a stable id to share.
      toast.info("Save at least one message before sharing.");
      return;
    }
    try {
      const { share_id } = await api.chatShare(t.serverId);
      const url = `${window.location.origin}/shared/${share_id}`;
      try {
        await navigator.clipboard.writeText(url);
        toast.success("Share link copied to clipboard.");
      } catch {
        // Clipboard blocked (permissions / non-HTTPS) — fall back to
        // showing the URL so the user can copy it manually.
        window.prompt("Copy this share link:", url);
      }
    } catch (e) {
      toast.error((e as Error)?.message || "Couldn't create a share link.");
    }
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
    attachedDocumentIds?: number[],
    attachmentsMeta?: Array<Record<string, unknown>>,
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
    // When the user attached a file, the server does OCR / chunking on
    // demand (we deferred it from upload-time so upload feels instant).
    // Tell the user what's happening so a 20-60 s wait on a scanned PDF
    // doesn't look like the app is hung under a bland "Thinking" label.
    setLiveStatus(
      attachedDocumentIds && attachedDocumentIds.length
        ? "Reading your document…"
        : "Thinking",
    );
    const acc = { text: "" };
    const clarifyRef = { clarified: false };
    try {
      await api.askStream(
        question,
        {
          domain: module || undefined,
          style,
          chatId: persist ? serverId ?? undefined : undefined,
          attachedDocumentIds: attachedDocumentIds && attachedDocumentIds.length ? attachedDocumentIds : undefined,
          attachmentsMeta: attachmentsMeta && attachmentsMeta.length ? attachmentsMeta : undefined,
        },
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
          onClarify: (c) => {
            // Render option buttons the INSTANT the backend ships them
            // (before the DB persist + terminal `done`). onDone still
            // sets the same state as a safety-net for older backends
            // that only put clarify in done.meta.
            clarifyRef.clarified = true;
            setClarify(c);
          },
          onError: (msg) => setError(msg),
          onDone: ({ grounded, citations, meta }) => {
            const c = (meta as Record<string, unknown> | undefined)?.["clarify"] as
              | { question: string; options: string[] }
              | undefined;
            if (c) {
              clarifyRef.clarified = true;
              setClarify(c);
            }
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
          const res = await api.ask(question, module || undefined, style, persist ? serverId ?? undefined : undefined, attachedDocumentIds, attachmentsMeta);
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

  async function send(
    overrideOrAttachments?: string | ComposerAttachment[],
    attachedFromSuggestion?: ComposerAttachment[],
  ) {
    // The composer calls send(attachments) — an array means "use current
    // input, attach these files". A string means "send this override
    // text (e.g. from a suggestion chip)".
    let override: string | undefined;
    let att: ComposerAttachment[] | undefined;
    if (Array.isArray(overrideOrAttachments)) {
      att = overrideOrAttachments;
    } else {
      override = overrideOrAttachments;
      att = attachedFromSuggestion;
    }
    const docIds = (att ?? [])
      .map((a) => a.docId)
      .filter((n): n is number => typeof n === "number");
    let text = (typeof override === "string" ? override : input).trim();
    // Allow send with only attachments (no text) — the agent will
    // summarise / analyse the attached files.
    if (!text && docIds.length === 0) return;
    if (!text && docIds.length) {
      // No question typed, only files attached — ask for a full analysis.
      text = docIds.length === 1
        ? "Please analyse the attached document and give a full summary, key findings, and any Income-tax implications."
        : "Please analyse the attached documents and give a combined summary, key findings, and any Income-tax implications.";
    }
    // If a generation is in flight, don't fire — queue the prompt (and
    // its attachments) so the user can continue working. The
    // auto-fire-on-idle effect below will send it as soon as the
    // current turn finishes.
    if (busy) {
      setQueued({ text, attachments: att ?? [] });
      setInput("");
      return;
    }
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
    // Snapshot the attachments onto the user message so the chip renders
    // in the bubble (and survives a reload from server-side messages —
    // see the "meta.attachments" round-trip in the persist path).
    const userAttachments = (att ?? []).map((a) => ({
      docId: a.docId,
      filename: a.filename,
      contentType: a.contentType,
      size: a.size,
      previewDataUrl: a.previewDataUrl,
    }));
    const userMsg: ChatMessage = {
      role: "user",
      content: text,
      ts: Date.now(),
      ...(userAttachments.length ? { attachments: userAttachments } : {}),
    };
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
    // Same payload we stamp on the local user message — send it to the
    // server so it can be persisted on the ChatMessage.meta and re-appear
    // as a chip when the user switches chats and comes back.
    const attachmentsMetaPayload = userAttachments.length ? userAttachments : undefined;
    await streamInto(tid, asstIdx, text, serverId, true, docIds, attachmentsMetaPayload);
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
          onShare={shareThread}
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
            queued={queued}
            onEditQueued={() => {
              if (!queued) return;
              setInput(queued.text);
              setQueued(null);
            }}
            onCancelQueued={() => setQueued(null)}
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
            queued={queued}
            onEditQueued={() => {
              if (!queued) return;
              setInput(queued.text);
              setQueued(null);
            }}
            onCancelQueued={() => setQueued(null)}
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
  onSubmit: (attachments: ComposerAttachment[]) => void;
  busy: boolean;
  module: string;
  onModuleChange: (v: string) => void;
  style: string;
  onStyleChange: (v: string) => void;
  onPick: (s: string) => void;
  displayName?: string;
  error: string | null;
  queued: { text: string; attachments: ComposerAttachment[] } | null;
  onEditQueued: () => void;
  onCancelQueued: () => void;
}) {
  // Wing-aware starters: an officer with a chosen function sees the prompts of
  // their own desk (instant + stable); "all"/unset users get the global
  // trending starters as before.
  const { session } = useAuth();
  const wingStarters = useMemo(
    () => resolveStarters(session?.workspaceProfile, session?.workspaceWings),
    [session?.workspaceProfile, session?.workspaceWings],
  );
  const [cards, setCards] = useState<Suggestion[]>(SUGGESTIONS);
  useEffect(() => {
    if (wingStarters.length) {
      setCards(wingStarters.map(toSuggestion));
      return;
    }
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
  }, [wingStarters]);
  return (
    <div className="relative flex-1 min-h-0 overflow-y-auto chat-scrollbar">
      <div className="min-h-full flex items-center justify-center px-4 py-10 sm:py-16">
        <div className="w-full max-w-3xl space-y-8 animate-fade-up">
          {/* Daily hook — what needs the officer today (deadlines), shown only
              when something is due. The reason to open BharatTax each morning. */}
          <TodayBriefing />
          {/* Logo mark — the BharatTax "h" mark from /favicon.png. White
              background lets the logo's own navy/orange/green show cleanly. */}
          <div className="flex justify-center">
            <div className="size-14 rounded-2xl bg-white flex items-center justify-center shadow-sm ring-1 ring-slate-200 overflow-hidden">
              <img src="/favicon.png" alt="BharatTax" className="size-11 object-contain" draggable={false} />
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
            <div className="flex justify-center pt-1">
              <PageHelp id="chat" />
            </div>
          </div>

          {/* Composer */}
          <div className="relative">
            {props.queued && (
              <QueuedBanner
                queued={props.queued}
                onEdit={props.onEditQueued}
                onCancel={props.onCancelQueued}
              />
            )}
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
  onSubmit: (attachments: ComposerAttachment[]) => void;
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
  queued: { text: string; attachments: ComposerAttachment[] } | null;
  onEditQueued: () => void;
  onCancelQueued: () => void;
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
          {props.queued && (
            <QueuedBanner
              queued={props.queued}
              onEdit={props.onEditQueued}
              onCancel={props.onCancelQueued}
            />
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

/** Small banner shown ABOVE the composer while a follow-up prompt is
 *  queued. Displays the queued text (truncated to 2 lines), the count
 *  of any attached files, and two actions:
 *    - Edit  : pull the text back into the composer input for changes.
 *    - Delete: discard the queued prompt entirely.
 *  The prompt auto-fires when the assistant becomes idle; this banner
 *  is purely informational + gives the user control before that happens.
 */
function QueuedBanner({
  queued,
  onEdit,
  onCancel,
}: {
  queued: { text: string; attachments: ComposerAttachment[] };
  onEdit: () => void;
  onCancel: () => void;
}) {
  const attCount = queued.attachments?.length ?? 0;
  return (
    <div className="mb-2 rounded-xl border border-primary/25 bg-primary/[0.06] px-3 py-2 flex items-start gap-3 animate-fade-up">
      <div className="mt-0.5 size-6 shrink-0 rounded-full bg-primary/15 text-primary flex items-center justify-center">
        <Sparkles className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11.5px] font-semibold uppercase tracking-wide text-primary/80">
          Queued · will send after this answer
          {attCount > 0 && (
            <span className="ml-1.5 text-slate-500 normal-case tracking-normal font-medium">
              · {attCount} file{attCount === 1 ? "" : "s"} attached
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[13px] text-slate-800 line-clamp-2 leading-snug">
          {queued.text}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={onEdit}
          title="Edit before sending"
          className="text-[12px] px-2 py-1 rounded-md text-primary hover:bg-primary/10 font-medium transition-colors"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={onCancel}
          title="Discard queued message"
          aria-label="Cancel queued message"
          className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}


function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
