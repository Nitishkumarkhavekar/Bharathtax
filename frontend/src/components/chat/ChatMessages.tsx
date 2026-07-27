import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowUpRight, BookOpen, Brain, Check, Copy, Globe, Languages, Loader2, RotateCcw, Scale, Square, ThumbsDown, ThumbsUp, User2, Volume2 } from "lucide-react";
import { StarRating } from "../ui/StarRating";
import { Markdown } from "@/lib/markdown";
import { ChatMessage } from "@/lib/chatStore";
import { api } from "@/api";
import { useAuth } from "@/auth";
import { useSpeech, ttsSupported } from "@/lib/tts";
import { cn } from "@/lib/utils";

interface ChatMessagesProps {
  messages: ChatMessage[];
  busy: boolean;
  // Index of the assistant message being filled by a LIVE token stream, and the
  // current tool status shown before its first token arrives.
  liveIdx?: number | null;
  liveStatus?: string | null;
  // Topic follow-up suggestions for the latest answer (rendered under it).
  followups?: string[];
  onPickFollowup?: (q: string) => void;
  // Re-run the question that produced the assistant message at `idx`.
  onRegenerate?: (idx: number) => void;
}

export default function ChatMessages({
  messages,
  busy,
  liveIdx,
  liveStatus,
  followups,
  onPickFollowup,
  onRegenerate,
}: ChatMessagesProps) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const speech = useSpeech();
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-8 space-y-6">
      {messages.map((m, idx) => (
        <Message
          key={idx}
          msg={m}
          question={idx > 0 && messages[idx - 1].role === "user" ? messages[idx - 1].content : undefined}
          live={idx === liveIdx}
          liveStatus={liveStatus ?? null}
          speaking={speech.speakingId === `m${idx}`}
          onToggleSpeak={(text: string) => speech.toggle(`m${idx}`, text)}
          onRegenerate={!busy && onRegenerate ? () => onRegenerate(idx) : undefined}
        />
      ))}
      {/* Fallback "thinking" bubble only when NOT live-streaming (the live path
          shows its own status inside the streaming assistant bubble). */}
      {busy && (liveIdx === null || liveIdx === undefined) && <ThinkingBubble />}
      {!busy && onPickFollowup && followups && followups.length > 0 && (
        <div className="flex flex-wrap gap-1.5 sm:pl-11">
          {followups.map((q, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onPickFollowup(q)}
              className="inline-flex items-center gap-1 text-[12.5px] text-slate-600 bg-white ring-1 ring-slate-200 rounded-full px-3 py-1.5 hover:ring-primary/40 hover:text-primary transition-colors text-left animate-fade-up"
            >
              <span className="text-primary font-semibold">+</span> {q}
            </button>
          ))}
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}

// ----------------------------------------------------------------- ThinkingBubble
// Rotates through professional, in-character status phrases while the model
// is generating. The assistant avatar on the left gets a soft pulsing glow.
const STATUS_PHRASES = [
  "Searching primary sources",
  "Reading the Income-Tax Act",
  "Cross-referencing sections",
  "Checking CBDT circulars",
  "Composing your answer",
  "Polishing citations",
];

function ThinkingBubble() {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(
      () => setIdx((i) => (i + 1) % STATUS_PHRASES.length),
      1700,
    );
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex gap-3 animate-fade-up">
      <AssistantAvatar pulse />
      <div className="rounded-2xl bg-white border border-slate-200 px-4 py-3 shadow-sm min-w-[260px]">
        <div className="flex items-center gap-1.5">
          <span className="typing-dot" />
          <span className="typing-dot" />
          <span className="typing-dot" />
          <span
            key={idx}
            className="ml-2 text-[12.5px] font-medium text-slate-600 status-phrase"
          >
            {STATUS_PHRASES[idx]}…
          </span>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- Message
function Message({
  msg,
  question,
  live,
  liveStatus,
  speaking,
  onToggleSpeak,
  onRegenerate,
}: {
  msg: ChatMessage;
  question?: string;
  live?: boolean;
  liveStatus?: string | null;
  speaking?: boolean;
  onToggleSpeak?: (text: string) => void;
  onRegenerate?: () => void;
}) {
  // On-demand translation of THIS answer (null = original English).
  const [xlate, setXlate] = useState<{ lang: string; text: string } | null>(null);
  const [xbusy, setXbusy] = useState(false);

  if (msg.role === "user") {
    return (
      <div className="flex justify-end animate-fade-up">
        <div className="max-w-[80%] rounded-2xl bg-primary text-primary-foreground px-4 py-2.5 shadow-sm whitespace-pre-wrap text-[15px] leading-relaxed">
          {msg.content}
        </div>
      </div>
    );
  }

  // Extras (citations, source chips, feedback) only once the turn has settled.
  const settled = !live;
  const shownText = xlate?.text ?? msg.content;

  async function translateTo(lang: string) {
    if (!lang || lang === "English") {
      setXlate(null);
      return;
    }
    setXbusy(true);
    try {
      const text = await api.translate(msg.content, lang);
      setXlate({ lang, text });
    } catch {
      /* keep original */
    } finally {
      setXbusy(false);
    }
  }

  return (
    <div className="flex gap-3 animate-fade-up">
      <AssistantAvatar pulse={!!live} />
      <div className="min-w-0 flex-1 space-y-3">
        {msg.grounded === false ? (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 flex gap-3 text-amber-900">
            <AlertTriangle className="size-5 shrink-0 mt-0.5" />
            <p className="text-sm leading-relaxed">{msg.content}</p>
          </div>
        ) : live ? (
          msg.content ? (
            // Tokens are arriving — render what we have so far, growing live.
            <div className="rounded-2xl bg-white border border-slate-200 px-5 py-4 shadow-sm">
              <Markdown text={msg.content} />
            </div>
          ) : (
            // Tool phase, before the first token: show the real status.
            <div className="rounded-2xl bg-white border border-slate-200 px-4 py-3 shadow-sm min-w-[260px]">
              <div className="flex items-center gap-1.5">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="ml-2 text-[12.5px] font-medium text-slate-600">
                  {(liveStatus || "Thinking").replace(/…$/, "")}…
                </span>
              </div>
            </div>
          )
        ) : (
          <div className="rounded-2xl bg-white border border-slate-200 px-5 py-4 shadow-sm">
            <Markdown text={shownText} />
            {xlate && (
              <div className="mt-2 pt-2 border-t border-slate-100 flex items-center gap-2 text-[11.5px] text-slate-400">
                <Languages className="size-3.5" /> Translated to {xlate.lang}
                <button onClick={() => setXlate(null)} className="text-primary hover:underline">Show original</button>
              </div>
            )}
          </div>
        )}

        {msg.citations && msg.citations.length > 0 && settled && (
          <div>
            <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-slate-600">
              <BookOpen className="size-3.5 text-primary" />
              Sources ({msg.citations.length})
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              {msg.citations.map((c) => (
                <div
                  key={c.n}
                  className="rounded-lg bg-white border border-slate-200 px-3 py-2 hover:border-primary/40 transition-colors"
                >
                  <div className="flex items-start gap-2">
                    <span className="inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded-full bg-primary/10 text-primary text-[0.72rem] font-semibold">
                      {c.n}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium leading-snug truncate">
                        {c.breadcrumb}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                        {c.section_number && (
                          <span className="font-mono">§ {c.section_number}</span>
                        )}
                        {c.source_url && (
                          <a
                            href={c.source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary hover:underline inline-flex items-center gap-0.5"
                          >
                            source <ArrowUpRight className="size-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {settled &&
          Array.isArray(msg.meta?.["web_sources"]) &&
          (msg.meta["web_sources"] as unknown[]).length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-slate-400 mr-0.5">Sources</span>
              {(msg.meta["web_sources"] as { title?: string; url?: string }[])
                .slice(0, 8)
                .map((src, i) => {
                  const domain = (src.title || "")
                    .replace(/^https?:\/\//, "")
                    .replace(/\/.*$/, "")
                    .trim();
                  if (!domain) return null;
                  return (
                    <a
                      key={i}
                      href={src.url || `https://${domain}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={domain}
                      className="inline-flex items-center gap-1 rounded-full bg-slate-100 hover:bg-slate-200 px-2 py-0.5 text-[11px] text-slate-600 transition-colors"
                    >
                      {/* Local icon instead of Google's favicon service — a
                          self-hosted product must not leak visited source
                          domains to a third party. */}
                      <Globe className="size-3.5 text-slate-400 shrink-0" />
                      <span className="max-w-[150px] truncate">{domain}</span>
                    </a>
                  );
                })}
            </div>
          )}
        {settled && Array.isArray(msg.meta?.["memory_added"]) &&
          (msg.meta["memory_added"] as unknown[]).length > 0 && (
            <MemoryCue items={msg.meta["memory_added"] as { id: number; content: string }[]} />
          )}
        {settled && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5">
            <MessageActions
              text={shownText}
              speaking={speaking}
              onToggleSpeak={onToggleSpeak ? () => onToggleSpeak(shownText) : undefined}
              onRegenerate={onRegenerate}
            />
            <LanguageMenu current={xlate?.lang ?? "English"} busy={xbusy} onPick={translateTo} />
            {msg.grounded !== false && (
              <>
                <span className="hidden sm:block w-px h-4 bg-slate-200 mx-0.5" />
                <FeedbackRow question={question} answer={msg.content} />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// One-tap actions under an answer: copy, read aloud, regenerate.
function MessageActions({
  text,
  speaking,
  onToggleSpeak,
  onRegenerate,
}: {
  text: string;
  speaking?: boolean;
  onToggleSpeak?: () => void;
  onRegenerate?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  const btn =
    "inline-flex items-center justify-center size-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors";
  return (
    <div className="flex items-center gap-0.5">
      <button onClick={copy} className={btn} title="Copy" aria-label="Copy answer">
        {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
      </button>
      {ttsSupported() && onToggleSpeak && (
        <button
          onClick={onToggleSpeak}
          className={cn(btn, speaking && "text-primary bg-primary/10 hover:text-primary")}
          title={speaking ? "Stop" : "Read aloud"}
          aria-label={speaking ? "Stop reading" : "Read aloud"}
        >
          {speaking ? <Square className="size-3.5" /> : <Volume2 className="size-4" />}
        </button>
      )}
      {onRegenerate && (
        <button onClick={onRegenerate} className={btn} title="Regenerate" aria-label="Regenerate answer">
          <RotateCcw className="size-4" />
        </button>
      )}
    </div>
  );
}

// The 22 scheduled languages of India + English. On-demand translation of the
// displayed answer (Gemini); read-aloud then reads whatever is shown.
const LANGUAGES = [
  "English", "Hindi", "Bengali", "Marathi", "Telugu", "Tamil", "Gujarati",
  "Urdu", "Kannada", "Odia", "Malayalam", "Punjabi", "Assamese", "Maithili",
  "Santali", "Kashmiri", "Nepali", "Konkani", "Sindhi", "Dogri", "Manipuri",
  "Bodo", "Sanskrit",
];

function LanguageMenu({ current, busy, onPick }: {
  current: string;
  busy?: boolean;
  onPick: (lang: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const translated = current !== "English";
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        title="Translate this answer"
        className={cn(
          "inline-flex items-center gap-1 h-8 px-2 rounded-lg text-[12px] transition-colors disabled:opacity-60",
          translated ? "text-primary bg-primary/10" : "text-slate-400 hover:text-slate-700 hover:bg-slate-100",
        )}
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Languages className="size-3.5" />}
        <span className="hidden sm:inline">{translated ? current : "Translate"}</span>
      </button>
      {open && (
        <div className="absolute left-0 bottom-9 z-20 w-40 max-h-64 overflow-y-auto chat-scrollbar rounded-lg bg-white ring-1 ring-slate-200 shadow-lg py-1 animate-fade-up">
          {LANGUAGES.map((l) => (
            <button
              key={l}
              onClick={() => { setOpen(false); onPick(l); }}
              className={cn(
                "w-full flex items-center justify-between px-3 py-1.5 text-[13px] text-left hover:bg-slate-100",
                l === current ? "text-primary font-medium" : "text-slate-700",
              )}
            >
              {l}
              {l === current && <Check className="size-3.5" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MemoryCue({ items }: { items: { id: number; content: string }[] }) {
  const [undone, setUndone] = useState<Record<number, boolean>>({});
  const live = items.filter((i) => !undone[i.id]);
  if (live.length === 0)
    return <div className="mt-2 text-[11.5px] text-slate-400">Memory update undone.</div>;
  async function undo(id: number) {
    setUndone((u) => ({ ...u, [id]: true }));
    try {
      await api.deleteMemory(id);
    } catch {
      /* best-effort */
    }
  }
  return (
    <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-primary/[0.07] text-primary px-3 py-1 text-[11.5px] font-medium">
      <Brain className="size-3.5" />
      Memory updated
      {live.length === 1 && (
        <button type="button" onClick={() => undo(live[0].id)} className="text-slate-500 hover:text-rose-600 underline underline-offset-2">
          Undo
        </button>
      )}
    </div>
  );
}


function FeedbackRow({ question, answer }: { question?: string; answer: string }) {
  const { session } = useAuth();
  const [sent, setSent] = useState<"up" | "down" | null>(null);
  const [stars, setStars] = useState(0);
  async function send(rating: "up" | "down") {
    setSent(rating);
    try {
      await api.feedback({ question, answer, rating });
    } catch {
      /* feedback is best-effort */
    }
  }
  async function rate(n: number) {
    setStars(n);
    try {
      await api.rate({ target_type: "chat", question, answer, stars: n });
    } catch {
      /* best-effort */
    }
  }
  const raw = session?.username || "";
  const name = raw ? raw[0].toUpperCase() + raw.slice(1) : "";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-400">
      {sent ? (
        <span className="text-[11px]">
          {name ? `Thanks ${name} — your feedback helps improve answers.` : "Thanks — your feedback helps improve answers."}
        </span>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-[11px]">Was this helpful?</span>
          <button onClick={() => send("up")} className="hover:text-emerald-600 transition-colors" title="Helpful">
            <ThumbsUp className="size-4" />
          </button>
          <button onClick={() => send("down")} className="hover:text-rose-600 transition-colors" title="Not helpful">
            <ThumbsDown className="size-4" />
          </button>
        </div>
      )}
      <div className="flex items-center gap-1">
        <span className="text-[11px]">Rate:</span>
        <StarRating value={stars} onRate={rate} size={15} disabled={stars > 0} />
        {stars > 0 ? <span className="text-[11px] text-amber-500">{stars}/5</span> : null}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- AssistantAvatar
function AssistantAvatar({ pulse }: { pulse?: boolean }) {
  return (
    <div
      className={
        "size-8 shrink-0 rounded-lg bg-primary/10 ring-1 ring-primary/30 flex items-center justify-center" +
        (pulse ? " avatar-pulse" : "")
      }
    >
      <Scale className="size-4 text-primary" />
    </div>
  );
}

// Keep User2 referenced for downstream stories that may want a user avatar.
void User2;
