# Runbook — Gemini on Vertex AI (free-credit billing)

**Purpose:** BharathTax runs Gemini through **Vertex AI** so calls draw down a
GCP account's **$300 / 90-day free credit** instead of a credit card. This
runbook covers: how it works, how to **rotate to a new account** when a credit
runs low, how to **monitor burn**, and how to **roll back**.

> Why this exists: the AI Studio Gemini API (`generativelanguage.googleapis.com`)
> is **excluded** from the $300 Cloud free trial (since March 2026). Vertex AI
> Gemini is **included**. Same models, different endpoint + auth.

---

## 1. How it's wired

- Flag **`GEMINI_BACKEND`** (`aistudio` | `vertex`) in `/opt/bharathtax/.env`
  selects the backend. Code: `backend/app/services/gemini_transport.py`.
- In `vertex` mode, auth is an **OAuth token** minted from a **service-account
  JSON** (no API key). Token is cached in-process and auto-refreshed.
- Model-name aliases are mapped to concrete Vertex ids
  (e.g. `gemini-flash-lite-latest` → `gemini-2.5-flash-lite`).
- **Region matters:** use **`GEMINI_VERTEX_LOCATION=global`** — `asia-south1`
  does **not** serve the `-lite` models (planner/researcher 404). `global`
  serves both `gemini-2.5-flash` and `gemini-2.5-flash-lite`.

### Current prod `.env` block
```
GEMINI_BACKEND=vertex
GEMINI_VERTEX_PROJECT=gen-lang-client-0080160641   # the account's project id
GEMINI_VERTEX_LOCATION=global
GOOGLE_APPLICATION_CREDENTIALS=/app/secrets/vertex.json
GEMINI_API_KEY=...                                  # kept for instant rollback
```
The key file lives at `/opt/bharathtax/backend/secrets/vertex.json`
(bind-mounted to `/app/secrets/vertex.json`). It is **gitignored** — never commit it.

---

## 2. Deploy command reference

Prod is **docker-compose v1** (hyphenated), project **`bharathtax-web`**:
```bash
CE="docker-compose -p bharathtax-web \
  -f docker-compose.yml -f docker-compose.web.yml -f docker-compose.frontend-override.yml"
```
- **Code-only change** (bind-mounted source): `docker restart bharathtax-web-api-1`
- **`.env` change** (env is read at container *create*, NOT restart):
  `cd /opt/bharathtax && $CE up -d --no-deps --force-recreate api`
- **Dependency change** (`pyproject.toml`): `$CE build api` then the recreate above.

---

## 3. Rotate to a new account's credit (when the current one runs low)

Per account (~10 min in the Google Cloud Console of that Gmail):

1. **Enable Vertex** — open
   `https://console.cloud.google.com/apis/library/aiplatform.googleapis.com?project=<PROJECT_ID>`
   → **Enable**.
2. **Service account** — IAM & Admin → Service Accounts → **Create** →
   name `bharathtax-vertex` → grant role **Vertex AI User** → **Create**.
3. **Key** — open the SA → **Keys** → Add Key → **Create new key** → **JSON** → download.
4. Note the **project id** (top of the console, e.g. `gen-lang-client-…`).

Then on prod:
```bash
# copy the new key up (run from your laptop, repo root)
scp <new-key>.json cstrax:/opt/bharathtax/backend/secrets/vertex.json
ssh cstrax 'chmod 600 /opt/bharathtax/backend/secrets/vertex.json'

# point the project id at the new account
ssh cstrax "cd /opt/bharathtax && sed -i 's/^GEMINI_VERTEX_PROJECT=.*/GEMINI_VERTEX_PROJECT=<NEW_PROJECT_ID>/' .env"

# recreate api so it picks up the new key + project
ssh cstrax "cd /opt/bharathtax && $CE up -d --no-deps --force-recreate api"
```
Verify (see §5). Keep `GEMINI_VERTEX_LOCATION=global`.

> ⚠️ **Policy risk:** Google's free trial is "one per customer"; using multiple
> Gmail accounts to extend it violates the Cloud ToS and can get accounts
> **suspended**. Treat rotation as a short-term **bridge**, not the foundation.
> The durable near-zero-cost path is routing more traffic to the **self-hosted
> Llama-8B** (already running, free) and reserving Gemini for what it uniquely
> does (live web-search grounding).

---

## 4. Monitor burn

- **Credit balance (source of truth):** that account's Console →
  **Billing** → the free-trial card shows *"₹X of ₹28,694 used, expires <date>"*.
  If it's climbing, the credit is being consumed (good — not your card).
- **Set a budget alert:** Billing → **Budgets & alerts** → create a budget at
  e.g. ₹20,000 with 50/90/100% email alerts, so you rotate *before* it's dry.
- **App-side call volume:** `token_usage` table (per-user Gemini call counts).
- **Health:** Admin console → system status → **"Gemini API (Vertex)"** tile
  should read **ok** ("Responding via Vertex AI").

### Cost levers already in place
- **Query router** (`query_router.py`): multi-agent (3–6 calls) fires **only for
  complex questions**; greetings/simple lookups take the single agent.
  Kill-switch `MULTI_AGENT_ROUTING=0`.
- Planner/researcher run on **flash-lite** (cheapest tier); composer on flash.

---

## 5. Verify a deploy is healthy

```bash
# 1) real Vertex call through the app transport
ssh cstrax 'docker exec bharathtax-web-api-1 python -c "
import httpx; from app.services import gemini_transport as tx
h=tx.headers(); b={\"contents\":[{\"role\":\"user\",\"parts\":[{\"text\":\"Reply exactly: OK\"}]}],\"generationConfig\":{\"maxOutputTokens\":10,\"thinkingConfig\":{\"thinkingBudget\":0}}}
r=httpx.post(tx.url(\"gemini-2.5-flash\",\"generateContent\"),headers=h,json=b,timeout=30)
print(r.status_code, r.json().get(\"usageMetadata\",{}).get(\"trafficType\"))"'
# expect: 200 ON_DEMAND

# 2) api health
ssh cstrax 'curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000/health'   # expect 200
```

---

## 6. Rollback (chat broken / credit issue)

Instant — flip back to the AI Studio API key (still present in `.env`):
```bash
ssh cstrax "cd /opt/bharathtax && sed -i 's/^GEMINI_BACKEND=.*/GEMINI_BACKEND=aistudio/' .env && \
  $CE up -d --no-deps --force-recreate api"
```
A timestamped `.env` backup was saved at `/opt/bharathtax/.env.bak.vertex`.

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `404 Publisher model … not found` | Model not served in the region | Ensure `GEMINI_VERTEX_LOCATION=global` |
| `ImportError: requests library not installed` | google-auth default transport | We use an httpx adapter in `gemini_transport.py`; ensure that file is deployed |
| Health tile "Vertex auth failed" | SA missing role / bad key | Grant **Vertex AI User**; re-download JSON |
| `.env` change didn't take effect | `docker restart` doesn't re-read env | Use `--force-recreate` (§2) |
| Chat "temporarily busy" + credit at 0 | Free credit exhausted | Rotate to a new account (§3) |
