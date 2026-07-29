// Browser text-to-speech (Web Speech API). Runs entirely on the user's machine
// via the OS voices — no audio is sent anywhere. Voice + rate + pitch are chosen
// in Personalization and stored per-device (available voices differ by machine).
import { useEffect, useState } from "react";

export interface VoicePrefs {
  voiceURI: string | null;
  rate: number; // 0.5–2
  pitch: number; // 0–2
}

const KEY = "bharathtax_voice_v1";
export const DEFAULT_VOICE_PREFS: VoicePrefs = { voiceURI: null, rate: 1, pitch: 1 };

export function loadVoicePrefs(): VoicePrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_VOICE_PREFS };
    return { ...DEFAULT_VOICE_PREFS, ...(JSON.parse(raw) as Partial<VoicePrefs>) };
  } catch {
    return { ...DEFAULT_VOICE_PREFS };
  }
}

export function saveVoicePrefs(p: VoicePrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private mode — accept the loss */
  }
}

export function ttsSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

// Voices load asynchronously in most browsers — re-read on `voiceschanged`.
export function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!ttsSupported()) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);
  return voices;
}

// Strip markdown / citation clutter so the spoken version sounds like prose,
// not "star star Section star star".
export function cleanForSpeech(md: string): string {
  return (md || "")
    .replace(/```[\s\S]*?```/g, " code block. ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\{\{cite:[^}]*\}\}/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/\s*\[\d+\]/g, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Single shared speech controller: tracks which message id is speaking so the
 *  UI can toggle a play/stop icon, and cancels any prior utterance first. */
export function useSpeech() {
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  useEffect(() => {
    // Stop speech if the component unmounts (navigating away mid-read).
    return () => {
      if (ttsSupported()) window.speechSynthesis.cancel();
    };
  }, []);

  function toggle(id: string, text: string) {
    if (!ttsSupported()) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    if (speakingId === id) {
      setSpeakingId(null);
      return;
    }
    const u = new SpeechSynthesisUtterance(cleanForSpeech(text));
    const prefs = loadVoicePrefs();
    if (prefs.voiceURI) {
      const v = synth.getVoices().find((x) => x.voiceURI === prefs.voiceURI);
      if (v) u.voice = v;
    }
    u.rate = prefs.rate;
    u.pitch = prefs.pitch;
    u.onend = () => setSpeakingId(null);
    u.onerror = () => setSpeakingId(null);
    setSpeakingId(id);
    synth.speak(u);
  }

  function stop() {
    if (ttsSupported()) window.speechSynthesis.cancel();
    setSpeakingId(null);
  }

  return { speakingId, toggle, stop, supported: ttsSupported() };
}
