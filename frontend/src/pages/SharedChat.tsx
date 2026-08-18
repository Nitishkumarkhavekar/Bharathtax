import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Scale, Loader2, AlertTriangle, ArrowRight, MessageSquarePlus } from "lucide-react";
import { api, ServerChatFull } from "../api";
import ChatMessages from "@/components/chat/ChatMessages";
import { ChatMessage } from "@/lib/chatStore";

// Read-only view of a chat shared via an internal link. The route is behind
// auth (App.tsx), so only signed-in BharatTax users who have the link get here.
export default function SharedChat() {
  const { shareId } = useParams();
  const navigate = useNavigate();
  const [chat, setChat] = useState<ServerChatFull | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [forking, setForking] = useState(false);
  const [forkErr, setForkErr] = useState<string | null>(null);

  useEffect(() => {
    if (!shareId) return;
    api
      .getSharedChat(shareId)
      .then(setChat)
      .catch((e: unknown) => setErr((e as Error)?.message ?? "This shared chat is unavailable."))
      .finally(() => setLoading(false));
  }, [shareId]);

  // "Continue this chat" — deep-copy the shared chat into the viewer's
  // account, stash the fork id in sessionStorage so Ask.tsx auto-selects
  // it on arrival, then navigate. If the viewer already owns the source
  // chat, the backend returns that same chat instead of duplicating.
  async function onContinue() {
    if (!shareId || forking) return;
    setForking(true);
    setForkErr(null);
    try {
      const fork = await api.forkSharedChat(shareId);
      try {
        sessionStorage.setItem("bt_open_chat_id", String(fork.id));
      } catch { /* */ }
      navigate("/ask");
    } catch (e) {
      setForkErr((e as Error)?.message ?? "Couldn't continue this chat. Please try again.");
      setForking(false);
    }
  }

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
          <div className="size-8 rounded-lg bg-white flex items-center justify-center ring-1 ring-slate-200 overflow-hidden">
            <img src="/favicon.png" alt="BharatTax" className="size-6 object-contain" draggable={false} />
          </div>
          <div className="leading-tight">
            <div className="text-[14px] font-semibold text-slate-900">BharatTax</div>
            <div className="text-[10.5px] text-slate-500 -mt-0.5">Shared conversation · read-only</div>
          </div>
        </div>
        <Link
          to="/ask"
          className="inline-flex items-center gap-1 text-[12.5px] font-medium text-primary hover:underline"
        >
          Open BharatTax <ArrowRight className="size-3.5" />
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
          <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 pt-6 pb-10">
            <h1 className="text-xl font-semibold text-slate-900">{chat?.title}</h1>
            <div className="text-[12px] text-slate-500 mb-2">
              Read-only · shared inside BharatTax
            </div>
            <ChatMessages messages={msgs} busy={false} />

            {/* "Continue this chat" — copies the conversation into the
                viewer's own account so they can pick up where the owner
                left off. Hidden when the viewer is already the owner
                (they can open their own copy directly). */}
            {chat && !chat.owned && (
              <div className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold text-slate-900">
                    Continue this conversation
                  </div>
                  <div className="text-[12.5px] text-slate-500 mt-0.5">
                    Add a copy to your BharathTax chats and keep asking follow-ups from where it left off.
                  </div>
                </div>
                <button
                  onClick={onContinue}
                  disabled={forking}
                  className="inline-flex items-center justify-center gap-1.5 shrink-0 h-10 px-4 rounded-lg bg-primary text-white text-[13.5px] font-semibold shadow-sm hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  {forking ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Continuing…
                    </>
                  ) : (
                    <>
                      <MessageSquarePlus className="size-4" /> Continue this chat
                    </>
                  )}
                </button>
              </div>
            )}
            {forkErr && (
              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 px-4 py-2 text-[13px]">
                {forkErr}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
