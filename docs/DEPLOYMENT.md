# BharatTax — Deployment & Data Sovereignty

BharatTax runs the same application in three postures. The **client is always a
thin front-end** (browser or desktop app); what changes is **where the backend,
data, documents and AI model live** — and that is what determines data control.

| Model | Where data lives | Who operates | For |
|---|---|---|---|
| **SaaS (default today)** | Our cloud | Us | CA firms, low-sensitivity |
| **Managed sovereign instance** | Gov-approved India cloud (NIC MeghRaj / State DC), isolated tenant | Us (managed) | Most departments |
| **Central gov-hosted** | Department / NIC data centre | Dept central IT | High-control departments |
| **On-prem / air-gapped** | Department's own server room | Dept IT | The most sensitive wings |

> Sovereignty does **not** mean a server in every office. It is **one central
> instance** on government-controlled infrastructure — the same model as ITBA /
> Insight / TRACES. Officers connect over the department network; they run and
> manage nothing.

```
   Officers (browser / desktop .exe)  ──dept LAN / VPN──▶  ONE central instance
   [ thin UI, no data stored locally ]                     [ FastAPI + Postgres/pgvector
                                                              + MinIO docs + local LLM + corpus ]
                                                              ↑ all data stays here
```

## Pointing the UI at a department backend — no rebuild

The frontend reads a **runtime config** (`/config.js`) that loads before the app.
The container serves it; a deployment edits it in place. Resolution order:
dev-tunnel → `/config.js` → build-time `VITE_API_BASE_URL` → `localhost:8000`.

`dist/config.js` (edit on the department's server, then hard-refresh):

```js
// Point the UI at the department's own backend:
window.__BHARATTAX_CONFIG__ = { apiBase: "https://bharattax.itd.internal" };

// …or when the UI and API are served from the same host/nginx:
window.__BHARATTAX_CONFIG__ = { sameOrigin: true };
```

The **same production build** therefore serves SaaS and every on-prem/sovereign
deployment — only this file differs.

## Local-first mode (data stays on the officer's machine)

For a government / sovereign deployment, set one more flag in the same
`/config.js` — no rebuild:

```js
window.__BHARATTAX_CONFIG__ = { localFirst: true };
```

With **local-first** on, when an officer saves a drafted order to their own
computer, BharatTax **removes that case and its uploaded documents from the
server** at the same time — so the officer's machine holds the only lasting
copy and nothing of the case is retained on the cloud. (The AI still *processes*
the documents on the server to draft the order; local-first governs
**retention**, not processing. For a fully in-network install, combine it with
the local-LLM option below so processing stays on the department's hardware
too.) Off by default: the managed SaaS keeps the persistent workspace.

## Keeping the AI model local (no data to any external cloud)

The one component that would otherwise call out is the LLM. The backend already
supports a **local, OpenAI-compatible model** as a first-class backend (it fails
over to it today). For an on-prem / air-gapped deployment, point it at a model
running on the department's own GPU server and no inference data leaves the
network:

```
LLM_BACKEND=vllm                      # or ollama / openai-compatible
LLM_BASE_URL=http://gpu-node.internal:8000/v1
LLM_API_KEY=<internal>
# Leave GEMINI_API_KEY unset for a fully-local, air-gapped install.
```

Ship the primary-law + case-law **corpus (with embeddings)** alongside so
retrieval works offline.

**Honest note on model quality:** a quantized 8B on a 24 GB card is usable; to
approach the SaaS Gemini quality, budget a 70B-class or a law-tuned model on
adequate hardware, or offer a hybrid (local for sensitive drafting; a
government-approved managed model for general research, where policy permits).

## Stack (self-contained Docker)

FastAPI · Postgres + pgvector · MinIO (documents) · Redis · Celery · nginx
(frontend). Nothing in the data layer is cloud-locked — the whole thing runs on
the department's own hardware or a sovereign cloud.

## Productisation checklist (for a real deployment)

- One-command provisioner to stand up an isolated instance (Compose already exists).
- Bundled corpus + local model validation on the target GPU.
- Offline licensing + a signed update package (no outbound data path).
- Encryption at rest, audit logs (present), RBAC by wing (present).
- Security audit / CERT-In posture for government procurement.
- Data Processing Agreement + SLA for the managed-sovereign option.
