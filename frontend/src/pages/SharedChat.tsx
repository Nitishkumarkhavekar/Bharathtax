import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Scale, Loader2, AlertTriangle, ArrowRight } from "lucide-react";
import { api, ServerChatFull } from "../api";
import ChatMessages from "@/components/chat/ChatMessages";
import { ChatMessage } from "@/lib/chatStore";

// Read-only view of a chat shared via an internal link. The route is behind
// auth (App.tsx), so only signed-in BharathTax users who have the link get here.
export default function SharedChat() {
  const { shareId } = useParams();
  const [chat, setChat] = useState<ServerChatFull | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!shareId) return;
    api
      .getSharedChat(shareId)
      .then(setChat)
      .catch((e: unknown) => setErr((e as Error)?.message ?? "This shared chat is unavailable."))
      .finally(() => setLoading(false));
  }, [shareId]);

  const msgs: ChatMessage[] = (chat?.messages || []).map((m) => ({
    role: (m.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
    content: m.content,
    citations: m.citations,
    grounded: (m.meta as { grounded?: boolean })?.grounded,
    meta: m.meta,
    ts: Date.parse(m.created_at ?? "") || Date.now(),
  }));

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="h-14 shrink-0 border-b border-slate-200 bg-white/70 backdrop-blur flex items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <div className="size-8 rounded-lg bg-primary flex items-center justify-center ring-1 ring-primary/30">
            <Scale className="size-4 text-white" strokeWidth={2.2} />
          </div>
          <div className="leading-tight">
            <div className="text-[14px] font-semibold text-slate-900">BharathTax</div>
            <div className="text-[10.5px] text-slate-500 -mt-0.5">Shared conversation · read-only</div>
          </div>
        </div>
        <Link
          to="/ask"
          className="inline-flex items-center gap-1 text-[12.5px] font-medium text-primary hover:underline"
        >
          Open BharathTax <ArrowRight className="size-3.5" />
        </Link>
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-24 text-slate-500 gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : err ? (
          <div className="max-w-md mx-auto mt-20 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 px-5 py-4 flex items-start gap-3">
            <AlertTriangle className="size-5 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-sm">Shared chat unavailable</div>
              <div className="text-[13px] mt-0.5">
                The link may have been revoked, or it’s incorrect.
              </div>
            </div>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 pt-6">
            <h1 className="text-xl font-semibold text-slate-900">{chat?.title}</h1>
            <div className="text-[12px] text-slate-500 mb-2">
              Read-only · shared inside BharathTax
            </div>
            <ChatMessages messages={msgs} busy={false} />
          </div>
        )}
      </main>
    </div>
  );
}
