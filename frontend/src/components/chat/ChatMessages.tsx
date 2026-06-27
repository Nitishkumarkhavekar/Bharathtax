import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowUpRight, BookOpen, Scale, User2 } from "lucide-react";
import { Markdown, normalizeMarkdown } from "@/lib/markdown";
import { ChatMessage } from "@/lib/chatStore";

interface ChatMessagesProps {
  messages: ChatMessage[];
  busy: boolean;
  // Index of the latest assistant message that should animate in word-by-word.
  // Set when a brand-new reply arrives; clear after the animation completes.
  streamingIdx: number | null;
  onStreamingDone?: () => void;
}

export default function ChatMessages({
  messages,
  busy,
  streamingIdx,
  onStreamingDone,
}: ChatMessagesProps) {
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-8 space-y-6">
      {messages.map((m, idx) => (
        <Message
          key={idx}
          msg={m}
          streaming={idx === streamingIdx}
          onStreamingDone={onStreamingDone}
        />
      ))}
      {busy && <ThinkingBubble />}
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
  streaming,
  onStreamingDone,
}: {
  msg: ChatMessage;
  streaming: boolean;
  onStreamingDone?: () => void;
}) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end animate-fade-up">
        <div className="max-w-[80%] rounded-2xl bg-primary text-primary-foreground px-4 py-2.5 shadow-sm whitespace-pre-wrap text-[15px] leading-relaxed">
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 animate-fade-up">
      <AssistantAvatar pulse={streaming} />
      <div className="min-w-0 flex-1 space-y-3">
        {msg.grounded === false ? (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 flex gap-3 text-amber-900">
            <AlertTriangle className="size-5 shrink-0 mt-0.5" />
            <p className="text-sm leading-relaxed">{msg.content}</p>
          </div>
        ) : streaming ? (
          <div className="rounded-2xl bg-white border border-slate-200 px-5 py-4 shadow-sm">
            <StreamingMarkdown text={msg.content} onDone={onStreamingDone} />
          </div>
        ) : (
          <div className="rounded-2xl bg-white border border-slate-200 px-5 py-4 shadow-sm">
            <Markdown text={msg.content} />
          </div>
        )}

        {msg.citations && msg.citations.length > 0 && !streaming && (
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
        {msg.meta && typeof msg.meta["retrieval"] === "string" && !streaming && (
          <div className="text-[11px] text-slate-400">
            via {String(msg.meta["retrieval"])}
          </div>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- StreamingMarkdown
// Reveals the assistant's answer word-by-word with a blinking caret. Once the
// full text is shown, calls onDone so the parent can clear `streamingIdx`.
function StreamingMarkdown({
  text,
  onDone,
  speedMs = 28,
  chunkSize = 1,
}: {
  text: string;
  onDone?: () => void;
  speedMs?: number;
  chunkSize?: number;
}) {
  // Normalize ONCE upfront, then stream the structured text. This way the
  // bullets / labelled lines appear in the correct layout as words arrive,
  // instead of reshuffling on every tick.
  const normalized = useMemo(() => normalizeMarkdown(text), [text]);
  const tokens = useMemo(() => normalized.split(/(\s+)/), [normalized]);
  const [count, setCount] = useState(0);
  const totalTokens = tokens.length;

  useEffect(() => {
    setCount(0);
  }, [normalized]);

  useEffect(() => {
    if (count >= totalTokens) {
      onDone?.();
      return;
    }
    const t = setTimeout(
      () => setCount((c) => Math.min(totalTokens, c + chunkSize)),
      speedMs,
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, totalTokens]);

  const shown = tokens.slice(0, count).join("");

  return (
    <div className="relative">
      <Markdown text={shown} preNormalized />
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
