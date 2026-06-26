# IT-Appeal — CIT(A)/NFAC appellate-order drafting platform

Secure, multi-user web platform where Income-Tax appeal staff draft appellate orders with AI,
grounded in a verifiable legal corpus, under request→approval access control and audit.

**Read first:** [`REQUIREMENTS.md`](REQUIREMENTS.md) · [`ARCHITECTURE.md`](ARCHITECTURE.md) ·
[`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) (domain & status).

## Components
| Dir | What |
|---|---|
| `rag/` | Local retrieval engine (PDF → chunks → embeddings → search) |
| `appeal_tool/` | The 6-module pipeline + LLM adapter (Gemini/Claude/local) + DOCX export |
| `server/` | FastAPI backend (`/api/v1`): `core/` + domain `modules/` (auth, access_requests, users, orgs, cases, corpus, admin) |
| `web/` | Next.js portals: `(marketing)` landing · `(auth)` login/admin-login/set-password/reset · `(app)` officer · `(admin)` console |
| `infra/` | docker-compose + Dockerfiles |
| `corpus/ index/ models/ outputs/` | Data (gitignored) |

## Run locally (dev)
```bash
# 1) backend deps + retrieval index
python -m pip install -r server/requirements.txt
python -m rag.index --rebuild

# 2) AI backend (else 'mock' drafts). Keys live in a gitignored .env:
#    APPEAL_LLM_PROVIDER=gemini  +  GEMINI_API_KEY=...   (or claude / openai-local)

# 3) backend API  → http://127.0.0.1:8000  (docs at /docs)
python -m uvicorn server.app:app --port 8000
#    first run seeds: super-admin  admin@itappeal.in / admin12345  (change it) + a default org

# 4) frontend → http://localhost:3000
cd web && npm install && npm run dev
```

## The flow
1. Visitor → landing (`/`) → **Request access**.
2. Admin signs in at **`/admin-login`** → **Approvals** → approve with role/org/licence → user is
   provisioned (email invite, or a temp password shown to the admin if SMTP isn't configured).
3. User signs in at **`/login`** → **Dashboard** → new case → upload PDFs → **Run 6 modules** →
   review reports, edit the **Draft Order**, check the **citation audit**, **Download .docx**.
4. Admin console: approvals, users & licences, organisations, corpus, audit.

Roles: `super_admin > org_admin > senior > officer (+ auditor)`. Data is **org-scoped**.

## Run the scalable stack (Postgres + pgvector + Celery/Redis)
The app runs on SQLite + in-process jobs by default. To use the production backends locally:
```bash
# 1) infra containers (alt ports to avoid clashes)
docker run -d --name appeal-pg    -e POSTGRES_USER=appeal -e POSTGRES_PASSWORD=appeal \
  -e POSTGRES_DB=appeal -p 5433:5432 pgvector/pgvector:pg16
docker run -d --name appeal-redis -p 6380:6379 redis:7-alpine

# 2) point the app at them (in .env)
#   APPEAL_DATABASE_URL=postgresql+psycopg://appeal:appeal@localhost:5433/appeal
#   APPEAL_REDIS_URL=redis://localhost:6380/0
#   APPEAL_JOBS_BACKEND=celery
#   APPEAL_VECTOR_BACKEND=pgvector

# 3) load the vector corpus into pgvector (after rag.index)
python -m rag.migrate_pg

# 4) run API + Celery worker + frontend
python -m uvicorn server.app:app --port 8000
celery -A server.workers.celery_app:celery worker --pool=solo --loglevel=info
cd web && npm run dev
```
Flags are independent: you can use Celery with the NumPy store, or pgvector with inline jobs.

## Deploy (server)
```bash
cp infra/.env.example infra/.env   # secrets, API key, DATABASE_URL (Postgres)
docker compose -f infra/docker-compose.yml --env-file infra/.env up --build
```

## Status
**Epic 1 (Foundation) complete** — modular multi-tenant backend (JWT access+refresh, RBAC,
access-request→approval, invitations/reset, audit) + the four portals, tested end-to-end.
Next epics (E2–E5): Postgres+pgvector, Celery+WebSocket progress, per-issue regenerate + versions,
deeper admin (prompt/model mgmt, usage/cost, feedback→fine-tuning), SSO/MFA, on-prem model, ITBA.
See `ARCHITECTURE.md` §roadmap.
