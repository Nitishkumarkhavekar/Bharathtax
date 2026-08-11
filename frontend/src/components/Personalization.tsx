import { FormEvent, useEffect, useState } from "react";
import {
  Sparkles,
  Brain,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Pin,
  PinOff,
  Trash2,
  Plus,
  MapPin,
  Volume2,
  Play,
} from "lucide-react";
import { api, MemoryItem, Personalization } from "../api";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import {
  useVoices,
  ttsSupported,
  loadVoicePrefs,
  saveVoicePrefs,
  VoicePrefs,
} from "@/lib/tts";

type Style = Record<string, unknown>;

const STYLE_TOGGLES: { key: string; label: string; on: unknown; hint: string }[] = [
  { key: "concise", label: "Keep answers concise", on: true, hint: "Short, to the point" },
  { key: "tables", label: "Use tables where helpful", on: true, hint: "Structured comparisons" },
  { key: "citation_density", label: "Cite provisions generously", on: "high", hint: "More inline [n] citations" },
  { key: "standpoint", label: "Answer from the officer's standpoint", on: "officer", hint: "Departmental/adjudicator view" },
];

export function PersonalizationTab() {
  const [p, setP] = useState<Personalization | null>(null);
  const [mems, setMems] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.personalization(), api.listMemory()])
      .then(([pp, mm]) => {
        setP(pp);
        setMems(mm);
      })
      .catch((e: any) => setLoadErr(e?.message ?? "Failed to load personalization"))
      .finally(() => setLoading(false));
  }, []);

  if (loading)
    return (
      <div className="text-sm text-slate-600 py-10 inline-flex items-center gap-2">
        <Loader2 className="size-4 animate-spin" /> Loading personalization…
      </div>
    );
  if (loadErr || !p)
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-sm px-4 py-3 flex items-start gap-2">
        <AlertCircle className="size-4 mt-0.5 shrink-0" /> {loadErr ?? "No data"}
      </div>
    );

  return (
    <div className="grid gap-4 lg:grid-cols-2 items-start">
      <ProfileForAiCard p={p} onSaved={setP} />
      <MemoryCard
        mems={mems}
        setMems={setMems}
        enabled={p.memory_enabled}
        onToggleEnabled={async (v) => {
          try {
            const up = await api.updatePersonalization({ memory_enabled: v });
            setP(up);
            toast.success(v ? "Memory turned on" : "Memory turned off");
          } catch (e: any) {
            toast.error(e?.message ?? "Couldn't update memory setting");
          }
        }}
      />
      <VoiceCard />
    </div>
  );
}

// Read-aloud voice picker. Voices come from the OS/browser (Web Speech API) and
// differ per machine, so the choice is stored per-device (localStorage), not on
// the server. Speech runs entirely on this machine — nothing is sent anywhere.
function VoiceCard() {
  const voices = useVoices();
  const supported = ttsSupported();
  const [prefs, setPrefs] = useState<VoicePrefs>(() => loadVoicePrefs());

  function update(patch: Partial<VoicePrefs>) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    saveVoicePrefs(next);
  }
  function test() {
    if (!supported) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(
      "This is how BharatTax will read answers aloud.",
    );
    if (prefs.voiceURI) {
      const v = voices.find((x) => x.voiceURI === prefs.voiceURI);
      if (v) u.voice = v;
    }
    u.rate = prefs.rate;
    u.pitch = prefs.pitch;
    synth.speak(u);
  }

  const sorted = [...voices].sort((a, b) => {
    const ae = a.lang.toLowerCase().startsWith("en") ? 0 : 1;
    const be = b.lang.toLowerCase().startsWith("en") ? 0 : 1;
    return ae - be || a.name.localeCompare(b.name);
  });

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <div className="size-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          <Volume2 className="size-4" />
        </div>
        <div className="font-semibold text-slate-900">Read aloud</div>
      </div>
      <p className="text-[12.5px] text-slate-500 mb-4">
        Pick the voice for the “Read aloud” button on answers. Voices come from
        your device and are set per-machine; reading happens on your computer —
        no audio leaves it.
      </p>

      {!supported ? (
        <div className="text-[13px] text-slate-500 bg-slate-50 rounded-lg px-3 py-2.5">
          This browser doesn’t support text-to-speech.
        </div>
      ) : voices.length === 0 ? (
        <div className="text-[13px] text-slate-500 bg-slate-50 rounded-lg px-3 py-2.5">
          No voices detected yet — they may still be loading, or your OS has none
          installed. Add voices in your system settings.
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="text-[12.5px] font-semibold text-slate-800 mb-1 block">Voice</label>
            <select
              value={prefs.voiceURI ?? ""}
              onChange={(e) => update({ voiceURI: e.target.value || null })}
              className="w-full h-10 rounded-md border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            >
              <option value="">System default</option>
              {sorted.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[12.5px] font-semibold text-slate-800 mb-1 flex justify-between">
              <span>Speed</span>
              <span className="text-slate-400 tabular-nums">{prefs.rate.toFixed(1)}×</span>
            </label>
            <input
              type="range" min={0.5} max={2} step={0.1} value={prefs.rate}
              onChange={(e) => update({ rate: parseFloat(e.target.value) })}
              className="w-full accent-primary"
            />
          </div>
          <div>
            <label className="text-[12.5px] font-semibold text-slate-800 mb-1 flex justify-between">
              <span>Pitch</span>
              <span className="text-slate-400 tabular-nums">{prefs.pitch.toFixed(1)}</span>
            </label>
            <input
              type="range" min={0} max={2} step={0.1} value={prefs.pitch}
              onChange={(e) => update({ pitch: parseFloat(e.target.value) })}
              className="w-full accent-primary"
            />
          </div>
          <Button variant="outline" size="sm" onClick={test}>
            <Play className="size-4" /> Test voice
          </Button>
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------- profile-for-AI
function ProfileForAiCard({ p, onSaved }: { p: Personalization; onSaved: (p: Personalization) => void }) {
  const [charge, setCharge] = useState(p.charge ?? "");
  const [instructions, setInstructions] = useState(p.custom_instructions ?? "");
  const [about, setAbout] = useState(p.about_me ?? "");
  const [style, setStyle] = useState<Style>(p.style ?? {});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function toggle(key: string, on: unknown) {
    setStyle((s) => {
      const next = { ...s };
      if (next[key]) delete next[key];
      else next[key] = on;
      return next;
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const up = await api.updatePersonalization({
        charge,
        custom_instructions: instructions,
        about_me: about,
        style,
      });
      onSaved(up);
      setMsg({ kind: "ok", text: "Saved — it'll apply to your next question." });
      setTimeout(() => setMsg(null), 2600);
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message ?? "Save failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
          <Sparkles className="size-4 text-primary" /> How BharatTax answers you
        </div>
        {msg && (
          <span className={"inline-flex items-center gap-1 text-[12px] font-medium " + (msg.kind === "ok" ? "text-emerald-700" : "text-rose-700")}>
            {msg.kind === "ok" ? <CheckCircle2 className="size-3.5" /> : <AlertCircle className="size-3.5" />}
            {msg.text}
          </span>
        )}
      </div>

      <div>
        <label className="text-[12.5px] font-semibold text-slate-800 mb-1.5 block">Your charge / posting</label>
        <div className="relative">
          <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            <MapPin className="size-4" />
          </div>
          <input
            value={charge}
            onChange={(e) => setCharge(e.target.value)}
            placeholder="e.g. Ward 28(1), Delhi"
            className="w-full h-10 rounded-md border border-slate-200 bg-white pl-10 pr-3 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="mt-1.5 text-[11px] text-slate-600">
          Used to tailor answers and pre-fill order/notice headers. Your role is <b className="capitalize">{(p.designation || p.role).replace("_", " ")}</b>.
        </div>
      </div>

      <div>
        <label className="text-[12.5px] font-semibold text-slate-800 mb-1.5 block">Custom instructions</label>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={3}
          placeholder="How should BharatTax respond? e.g. 'Always give the governing section first, then the reasoning.'"
          className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
      </div>

      <div>
        <label className="text-[12.5px] font-semibold text-slate-800 mb-1.5 block">About your work</label>
        <textarea
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          rows={2}
          placeholder="Anything BharatTax should know — e.g. 'I mostly handle 69A/68 additions and 147 reassessments.'"
          className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
      </div>

      <div>
        <label className="text-[12.5px] font-semibold text-slate-800 mb-2 block">Response style</label>
        <div className="grid sm:grid-cols-2 gap-2">
          {STYLE_TOGGLES.map((t) => (
            <label
              key={t.key}
              className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 cursor-pointer hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={!!style[t.key]}
                onChange={() => toggle(t.key, t.on)}
                className="mt-0.5 size-4 accent-primary"
              />
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-slate-800 leading-snug">{t.label}</div>
                <div className="text-[11px] text-slate-500">{t.hint}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="flex justify-end pt-1">
        <Button type="submit" disabled={busy}>
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Saving…
            </>
          ) : (
            "Save"
          )}
        </Button>
      </div>
    </form>
  );
}

// --------------------------------------------------------------------- memory
function MemoryCard({
  mems,
  setMems,
  enabled,
  onToggleEnabled,
}: {
  mems: MemoryItem[];
  setMems: (m: MemoryItem[]) => void;
  enabled: boolean;
  onToggleEnabled: (v: boolean) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    const content = draft.trim();
    if (!content || busy) return;
    setBusy(true);
    try {
      const m = await api.addMemory({ content });
      setMems([m, ...mems]);
      setDraft("");
      toast.success("Memory saved");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save memory");
    } finally {
      setBusy(false);
    }
  }
  async function pin(m: MemoryItem) {
    try {
      const up = await api.updateMemory(m.id, { pinned: !m.pinned });
      setMems(mems.map((x) => (x.id === m.id ? up : x)).sort((a, b) => Number(b.pinned) - Number(a.pinned)));
    } catch (e: any) { toast.error(e?.message ?? "Couldn't update memory"); }
  }
  async function del(m: MemoryItem) {
    try {
      await api.deleteMemory(m.id);
      setMems(mems.filter((x) => x.id !== m.id));
      toast.success("Memory removed");
    } catch (e: any) { toast.error(e?.message ?? "Couldn't remove memory"); }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
          <Brain className="size-4 text-primary" /> Memory
        </div>
        <label className="inline-flex items-center gap-2 text-[12px] font-medium text-slate-600 cursor-pointer">
          <input type="checkbox" checked={enabled} onChange={(e) => onToggleEnabled(e.target.checked)} className="size-4 accent-primary" />
          {enabled ? "On" : "Off"}
        </label>
      </div>
      <p className="text-[11.5px] text-slate-500 -mt-2">
        Durable facts BharatTax remembers across all your chats. It stays on this system and is only used with the self-hosted model.
      </p>

      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Remember that…"
          className="flex-1 h-10 rounded-md border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
        <Button type="button" onClick={add} disabled={!draft.trim() || busy}>
          <Plus className="size-4" /> Add
        </Button>
      </div>

      {mems.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-4 py-6 text-center text-[12.5px] text-slate-500">
          No memories yet. Add one above, or say "remember that…" in a chat.
        </div>
      ) : (
        <ul className="space-y-1.5 max-h-[340px] overflow-y-auto pr-1">
          {mems.map((m) => (
            <li
              key={m.id}
              className="group flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2"
            >
              {m.pinned && <Pin className="size-3.5 text-amber-500 mt-0.5 shrink-0" />}
              <span className="flex-1 text-[13px] text-slate-800 leading-snug">{m.content}</span>
              {m.source !== "manual" && (
                <span className="text-[10px] text-slate-400 mt-0.5 shrink-0">auto</span>
              )}
              <button
                type="button"
                onClick={() => pin(m)}
                title={m.pinned ? "Unpin" : "Pin"}
                className="text-slate-400 hover:text-amber-600 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                {m.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
              </button>
              <button
                type="button"
                onClick={() => del(m)}
                title="Delete"
                className="text-slate-400 hover:text-rose-600 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
