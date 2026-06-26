# IT-Appeal — System Architecture

> Engineering design for a multi-user, access-controlled, scalable product (not the MVP slice).
> Pairs with [`REQUIREMENTS.md`](REQUIREMENTS.md). Domain in [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md).

## 1. System context
```
        ┌────────────┐         ┌──────────────────────────────────────────┐
Visitor │  Landing   │         │                 Backend                   │
Officer │  + Auth    │  HTTPS  │  FastAPI (api/v1)  ──►  Services  ──► Repos │
Admin   │  Next.js   │ ──────► │   authz/RBAC          domain logic    SQLA │
        │  (web)     │  JWT    │   WebSocket (job progress)                 │
        └────────────┘         │        │                 │                │
                               │        ▼                 ▼                │
                               │   Celery workers     PostgreSQL+pgvector  │
                               │   (runs, ingest,     Redis (cache/queue)  │
                               │    email)            MinIO/S3 (PDFs)      │
                               │        │                                  │
                               │        ▼   Engine: rag (retrieval) +      │
                               │     appeal_tool (6 modules) + LLM adapter │
                               └────────────────────┬──────────────────────┘
                                                     ▼
                                   LLM: Gemini / Claude / self-hosted (vLLM)
```

## 2. The "frames" (cross-cutting concerns) and how each is handled
| Frame | Approach |
|---|---|
| **AuthN** | JWT **access (short) + refresh (long)**; password (bcrypt); invitation & reset tokens; optional OIDC/SAML SSO + TOTP MFA (phase 2) |
| **AuthZ (RBAC)** | Central permission matrix (role × resource × action) enforced by FastAPI dependencies; **office-scoped** queries (multi-tenancy) |
| **Access lifecycle** | `AccessRequest` → admin approval → `User(status)` + `Invitation`; suspend/revoke/expire; every transition audited |
| **Multi-tenancy** | `Organisation` (office/region); rows carry `org_id`; admins scoped to their org; super-admin global |
| **Async jobs** | Celery + Redis (pipeline runs, corpus ingest, emails); idempotent, retried; status in DB + **WebSocket** push |
| **Validation/errors** | Pydantic schemas; consistent error envelope `{error:{code,message,details}}`; problem-detail style |
| **API** | Versioned `/api/v1`; OpenAPI; pagination/filtering/sorting conventions; rate limiting (Redis) |
| **Persistence** | PostgreSQL + SQLAlchemy 2.0 + **Alembic** migrations; **pgvector** for embeddings (→ Qdrant at scale) |
| **Storage** | MinIO/S3 for case PDFs, exports, corpus; signed URLs; lifecycle/retention policies |
| **Caching** | Redis (sessions hints, rate-limit, hot reads) |
| **Notifications** | Transactional email (SMTP/provider) for invites/approvals/resets; in-app notifications |
| **Observability** | Structured JSON logs + correlation IDs; Prometheus metrics; OpenTelemetry traces; Sentry; `/health` `/ready` |
| **Security** | TLS, secrets via env/vault, CORS allow-list, CSRF for cookie flows, input sanitisation, audit log, encryption at rest |
| **Config** | 12-factor env config per environment (dev/staging/prod); feature flags |
| **CI/CD** | Lint+typecheck+test on PR; build images; migrate+deploy; staging→prod gates |

## 3. Backend — modular monolith (split to services later)
Layered per domain module: `api (routers) → services (business logic) → repositories → models`.
```
server/
  app.py                      # FastAPI factory, middleware, router mounting
  core/                       # config, db, security(jwt/rbac), deps, errors, logging, pagination
  modules/
    auth/                     # login, refresh, password reset, invitations, MFA
    access_requests/          # request → approval workflow
    users/                    # user CRUD, roles, licenses, suspend/revoke
    orgs/                     # offices/regions (tenancy)
    cases/                    # cases, documents
    runs/                     # pipeline runs, outputs, versions, citation audit
    corpus/                   # layers, upload, acquisition console, reindex
    prompts/                  # versioned per-module prompts, model config
    usage/                    # token/cost metering, quotas
    audit/                    # audit log read API
    notifications/            # email + in-app
    health/                   # health/readiness/metrics
  workers/                    # celery app + tasks (run_pipeline, ingest, send_email)
  migrations/                 # alembic
  tests/
```
Each module: `router.py`, `service.py`, `repository.py`, `schemas.py`, `models.py`. The existing
`rag/` + `appeal_tool/` stay as the **engine**, invoked by `runs`/`corpus` services + workers.

## 4. Frontend — Next.js (App Router), route groups
```
web/app/
  (marketing)/                # public landing, request-access, about, security
  (auth)/login, /admin-login, /set-password, /forgot, /reset
  (app)/dashboard, /cases, /cases/[id]            # officer area (role-guarded)
  (admin)/admin/…             # approvals, users, orgs, corpus, prompts, usage, audit, health
  api-helpers, middleware.ts  # route protection by role
components/  (design system: shadcn/ui + Tailwind)
lib/        (api client, auth/session, query hooks via TanStack Query, rbac helpers)
```
- **Separate portals:** officer area and admin console are distinct route groups with their own
  layouts/nav; `middleware.ts` + server checks enforce role access (defence in depth — UI hides,
  API enforces).
- Auth state via httpOnly refresh cookie + in-memory access token; TanStack Query for data.

## 5. Data model (core entities)
```
Organisation(id, name, region, …)
User(id, org_id, name, email, password_hash, role, status[pending|active|suspended],
     license_expiry, email_verified, created_at)
AccessRequest(id, name, email, designation, org_requested, reason,
              status[pending|approved|rejected], decided_by, decided_at, reject_reason)
Invitation(id, user_id, token_hash, expires_at, used_at)
PasswordReset(id, user_id, token_hash, expires_at, used_at)
RefreshToken(id, user_id, token_hash, expires_at, revoked)
Case(id, org_id, owner_id, title, ay, pan, section, status, …)
Document(id, case_id, filename, category, storage_key, pages)
Run(id, case_id, status, provider, model, started/finished, error, created_by)
Output(id, run_id, kind, content, edited, version)            # versioned per issue/draft
CitationAudit(id, run_id, issue, cited[], ungrounded[])
PromptTemplate(id, module, version, content, active)
ModelConfig(key, value)                                        # provider/model/top-k/temp
UsageRecord(id, org_id, user_id, run_id, tokens_in, tokens_out, cost, at)
Notification(id, user_id, type, payload, read_at)
AuditLog(id, org_id, user_id, action, entity, entity_id, detail, ip, at)
```

## 6. Key flows
- **Access request:** `POST /api/v1/access-requests` → admin `GET /admin/access-requests` →
  `POST …/{id}/approve {role, org, license}` → creates User + Invitation → email link →
  `POST /auth/accept-invite {token, password}` → active.
- **Run pipeline:** `POST /cases/{id}/run` → enqueue Celery task → worker runs engine →
  writes Outputs + UsageRecord → WebSocket pushes progress → client review.
- **Auth:** `POST /auth/login` → access+refresh; `POST /auth/refresh`; refresh rotation; logout revokes.

## 7. Deployment topology
- Containers: `web`, `api`, `worker`, `beat` (scheduled), `postgres(pgvector)`, `redis`, `minio`,
  `nginx/traefik` (TLS). Dev: docker-compose. Prod: compose on a single VM → k8s when needed.
- Envs: dev / staging / prod with separate secrets & DBs. Migrations run on deploy.
- Scaling: API and workers scale horizontally; Postgres vertical + read replicas; Qdrant if vectors outgrow pgvector.

## 8. Migration from the current MVP
Reuse the **engine** (`rag/`, `appeal_tool/`) and the working pipeline as-is. Refactor the thin
`server/` MVP into the modular structure above; move SQLite→Postgres+Alembic; add refresh tokens,
RBAC, access-requests, orgs, invitations; restructure `web/` into route groups with the design
system; add Celery + WebSocket. Nothing in the engine is wasted.

## 9. Roadmap (epics → see REQUIREMENTS §6)
E1 Foundation → E2 Core workflow → E3 Admin depth → E4 Hardening/scale → E5 Domain (own model, ITBA).
```
