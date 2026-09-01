"""LLM client abstraction. The ONLY thing that changes between this laptop and a
GPU deployment is `LLM_BACKEND` in .env — no code change.

  mock   -> deterministic, grounded-from-context answer (lets the slice run with
            no model; also used in tests)
  ollama -> small local model on the host (dev)        } both are OpenAI
  vllm   -> Qwen2.5-14B-Instruct served by vLLM (prod)  } chat-completions APIs
  openai -> any other OpenAI-compatible endpoint
"""
from __future__ import annotations

from typing import Protocol

import httpx

from app.core.config import settings
from app.core.logging import get_logger

log = get_logger(__name__)


class LLMClient(Protocol):
    def complete(self, system: str, user: str, *, context: str | None = None) -> str: ...


class MockLLM:
    """No model required. Returns a transparently grounded answer built ONLY from
    the passages handed to it, so the anti-hallucination contract holds in dev."""

    def complete(self, system: str, user: str, *, context: str | None = None) -> str:
        marker = "PASSAGES:"
        excerpt = ""
        if marker in user:
            body = user.split(marker, 1)[1]
            excerpt = body.strip().splitlines()[0][:300] if body.strip() else ""
        return (
            "[mock LLM — no model loaded] Based only on the retrieved primary "
            "sources below, the most relevant provision is:\n\n"
            f"> {excerpt}\n\n"
            "See the cited sources [1] for the exact text. "
            "(Set LLM_BACKEND=ollama or vllm for a real generated answer.)"
        )


class OpenAICompatLLM:
    """Client that captures per-call telemetry on `self.last_usage` /
    `self.last_model` / `self.last_latency_ms` so upstream code can persist
    the token spend without threading it through every return signature."""

    def __init__(self, base_url: str, model: str, api_key: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.api_key = api_key
        # Telemetry from the most recent complete() call — filled AFTER the
        # HTTP response returns. Reset on each new call.
        self.last_usage: dict | None = None
        self.last_model: str | None = None
        self.last_latency_ms: int | None = None

    def complete(
        self,
        system: str,
        user: str,
        *,
        model: str | None = None,
        max_tokens: int | None = None,
        context: str | None = None,
    ) -> str:
        import time
        used_model = model or self.model
        self.last_usage = None
        self.last_model = used_model
        self.last_latency_ms = None
        t0 = time.time()
        messages = [{"role": "system", "content": system}]
        # Personalization goes in as a prior turn (NOT the final user message), so
        # the gateway retrieves on the clean question but still sees who's asking.
        if context:
            messages.append({"role": "user", "content": context})
            messages.append({"role": "assistant", "content": "Understood — I'll keep that in mind."})
        messages.append({"role": "user", "content": user})
        with httpx.Client(timeout=httpx.Timeout(180.0)) as client:
            r = client.post(
                f"{self.base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={
                    "model": used_model,
                    "messages": messages,
                    "temperature": settings.llm_temperature,
                    "max_tokens": max_tokens or settings.llm_max_tokens,
                },
            )
            r.raise_for_status()
            payload = r.json()
        self.last_latency_ms = int((time.time() - t0) * 1000)
        try:
            self.last_usage = payload.get("usage") or None
        except AttributeError:
            self.last_usage = None
        return payload["choices"][0]["message"]["content"].strip()


class VertexLLM:
    """Vertex AI Gemini client with the same `.complete(system, user, ...)`
    signature as `OpenAICompatLLM`. Uses the shared `gemini_transport`
    (`_tx`) so it inherits the service-account auth, model-name mapping
    and Vertex/AI-Studio backend selection that the chat surfaces use.

    Prefer this for surfaces that need Gemini-quality drafts (opinion, order,
    reply) but still want the OpenAI-shaped ergonomics of the rest of the
    codebase. Telemetry is captured on `self.last_*` after each call, same
    as OpenAICompatLLM.
    """

    def __init__(self, model: str) -> None:
        self.model = model
        self.last_usage: dict | None = None
        self.last_model: str | None = None
        self.last_latency_ms: int | None = None

    def complete(
        self,
        system: str,
        user: str,
        *,
        model: str | None = None,
        max_tokens: int | None = None,
        context: str | None = None,
    ) -> str:
        import time
        # Lazy import — gemini_transport pulls in httpx + google-auth which
        # are cheap but not needed for the mock/openai code path.
        from app.services import gemini_transport as _tx

        used_model = model or self.model
        self.last_usage = None
        self.last_model = used_model
        self.last_latency_ms = None
        t0 = time.time()

        # Gemini message shape: `systemInstruction` + `contents[]` (parts).
        # `context` becomes a preceding user turn so the model has personalisation
        # without treating it as the current question.
        contents: list[dict] = []
        if context:
            contents.append({"role": "user", "parts": [{"text": context}]})
            contents.append({"role": "model", "parts": [{"text": "Understood — I'll keep that in mind."}]})
        contents.append({"role": "user", "parts": [{"text": user}]})

        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": contents,
            "generationConfig": {
                "temperature": settings.llm_temperature,
                "maxOutputTokens": max_tokens or settings.llm_max_tokens,
                # Draft prose doesn't need thinking budget — the model just
                # writes; requesting a budget slows every call by 5-10s.
                "thinkingConfig": {"thinkingBudget": 0},
            },
        }

        with _tx.gate(), httpx.Client(timeout=httpx.Timeout(180.0)) as client:
            r = client.post(
                _tx.url(used_model, "generateContent"),
                headers=_tx.headers(),
                json=body,
            )
            r.raise_for_status()
            payload = r.json()

        self.last_latency_ms = int((time.time() - t0) * 1000)
        # Vertex telemetry — map to OpenAI-shaped keys so downstream code
        # doesn't care which backend produced the numbers.
        um = payload.get("usageMetadata") or {}
        self.last_usage = {
            "prompt_tokens": um.get("promptTokenCount"),
            "completion_tokens": um.get("candidatesTokenCount"),
            "total_tokens": um.get("totalTokenCount"),
        }

        cand = (payload.get("candidates") or [{}])[0]
        parts = (cand.get("content") or {}).get("parts") or []
        text = "".join(p.get("text", "") for p in parts).strip()
        if not text:
            # Surface the finish reason so an empty completion doesn't turn
            # into a silent no-op (safety block, content filter, quota).
            fr = cand.get("finishReason", "UNKNOWN")
            raise RuntimeError(f"Vertex returned no text (finishReason={fr})")
        return text


def get_llm() -> LLMClient:
    backend = settings.llm_backend.lower()
    if backend == "mock":
        return MockLLM()
    if backend in {"ollama", "vllm", "openai"}:
        return OpenAICompatLLM(settings.llm_base_url, settings.llm_model_name, settings.llm_api_key)
    log.warning("unknown LLM_BACKEND %r; falling back to mock", backend)
    return MockLLM()
