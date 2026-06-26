"""Local transcription of an audio file using faster-whisper (offline)."""
import os
# Windows: avoid symlink-privilege errors in the HF model cache (copy instead).
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS", "1")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

import sys
from datetime import timedelta
from faster_whisper import WhisperModel

AUDIO = "IT - BMTC - APPEAL.m4a"   # local copy kept in the project folder
MODEL_SIZE = sys.argv[1] if len(sys.argv) > 1 else "medium"   # small | medium | large-v3
OUT_TXT = "transcript.txt"
OUT_SRT = "transcript.srt"


def ts(seconds: float) -> str:
    return str(timedelta(seconds=round(seconds)))


def srt_ts(seconds: float) -> str:
    td = timedelta(seconds=seconds)
    h, rem = divmod(td.seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d},{td.microseconds // 1000:03d}"


print(f"Loading model '{MODEL_SIZE}' (CPU, int8)...", flush=True)
model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")

print("Transcribing... this runs locally and can take a while on CPU.", flush=True)
segments, info = model.transcribe(
    AUDIO,
    beam_size=5,
    vad_filter=True,                 # skip long silences
    vad_parameters=dict(min_silence_duration_ms=500),
)
print(f"Detected language: {info.language} (p={info.language_probability:.2f})", flush=True)
print(f"Audio duration: {ts(info.duration)}", flush=True)

txt_lines, srt_lines = [], []
for i, seg in enumerate(segments, 1):
    line = seg.text.strip()
    txt_lines.append(f"[{ts(seg.start)} -> {ts(seg.end)}] {line}")
    srt_lines.append(f"{i}\n{srt_ts(seg.start)} --> {srt_ts(seg.end)}\n{line}\n")
    # live progress (timestamp only — avoid Windows cp1252 console crash on non-Latin text)
    if i % 10 == 0:
        print(f"  ...{i} segments, up to {ts(seg.end)}", flush=True)

with open(OUT_TXT, "w", encoding="utf-8") as f:
    f.write("\n".join(txt_lines) + "\n")
with open(OUT_SRT, "w", encoding="utf-8") as f:
    f.write("\n".join(srt_lines))

print(f"\nDone. {len(txt_lines)} segments -> {OUT_TXT} and {OUT_SRT}", flush=True)
