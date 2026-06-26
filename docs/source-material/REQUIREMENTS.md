# IT-Appeal — Product Requirements

> What the system must do and for whom. Pairs with [`ARCHITECTURE.md`](ARCHITECTURE.md) (how)
> and [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) (domain). This supersedes the "2-page app" MVP:
> the target is a multi-user, access-controlled, scalable product.

## 1. Vision
A secure, multi-user web platform where Income-Tax appellate staff (CIT(A)/NFAC) draft
appellate orders with AI assistance, grounded in a verifiable legal corpus, under proper
access control, approvals, and audit — deployable on a government/rented server.

## 2. Personas & roles (RBAC)
| Role | Who | Can do |
|---|---|---|
| **Visitor** | Anyone on the landing page | View marketing/landing, **request access**, log in |
| **Officer** | CIT(A) / appeal-unit staff | Own cases: upload, run, review/edit, export. Only their own data |
| **Senior officer** | Supervisory officer | All officer rights + view/oversee their office's cases, reassign |
| **Org admin** | Office/region admin | Approve access requests, manage users & licenses **within their office**, corpus, view usage/audit (scoped) |
| **Super admin** | Platform owner | Everything across all offices: orgs, global config, model/prompts, billing, audit, system health |
| **Auditor** (optional) | Compliance | Read-only access to audit logs & usage |

Permissions are a matrix (resource × action) resolved server-side; UI hides what a role can't do.

## 3. Access lifecycle (request → approve → provision → use → expire/revoke)
The core access model the owner specified:
1. **Request** — a visitor submits an access request (name, official email, designation,
   office/region, reason). No account is usable yet (status `pending`).
2. **Review** — relevant **admin** sees the request in an approvals queue with full details.
3. **Decision** — admin **approves** (assign role, office, license validity) or **rejects**
   (with reason). Both notify the requester by email.
4. **Provision** — on approval the user is created (status `active`) and receives an
   **invitation link** to set their password (or, for offline deployments, the admin shares
   a generated temporary password). Optional email verification.
5. **Use** — user logs in, works within their role/office scope, subject to license validity.
6. **Lifecycle** — admin can **suspend / reactivate / revoke**, extend/expire **licenses**,
   reset passwords, change role/office. Expired license → blocked at login with a message.
All transitions are written to the **audit log**.

## 4. Functional requirements

### 4.1 Public / landing
- Public **landing page**: what the tool does, who it's for, security posture, CTA buttons
  **"Request access"** and **"Sign in"**. (Internal-only deployments can gate this behind VPN.)
- **Request-access** form (creates a pending request).

### 4.2 Authentication
- **Sign in** (email + password), **separate admin sign-in entry** (or role-based redirect to
  the admin console). JWT access + refresh; secure session; logout everywhere.
- Password set via **invitation token**, **forgot/reset password**, optional **email verification**,
  optional **MFA/TOTP** (phase 2). Account lockout/rate-limit on brute force.

### 4.3 Officer application
- **Dashboard**: my cases (search/filter/sort by AY/PAN/section/status), quick "new case".
- **Case**: metadata (title, AY, PAN, section, office); lifecycle states.
- **Documents**: drag-drop multi-upload; live classification (Module 3) + missing-doc flags;
  replace/delete; (phase 2) OCR for scanned PDFs.
- **Run**: trigger the 6 modules; **live per-module progress** (WebSocket); cancel; re-run.
- **Review workspace**: Deficiency, Scope, Compliance, **Issue Matrix**; **editable Draft Order**;
  **per-issue regenerate**; set Result per issue; **citation viewer** (open source PDF at page;
  ungrounded cites flagged); **search/add case law**; **version history**; notes.
- **Export & finalise**: DOCX + PDF; finalise/lock; share within office (senior).
- **Notifications**: run complete/failed, approvals, license expiry.
- **Profile**: change password, view license status, preferences.

### 4.4 Admin console (proper panel)
- **Approvals queue**: pending requests, approve/reject with role/office/license; bulk.
- **User management**: list/search; create/invite; edit role/office/license; suspend/reactivate/
  revoke; reset password; impersonate (super admin, audited).
- **Org/office management**: create offices/regions; assign admins; scope isolation.
- **Corpus management**: layers (statutes/case-law/prior-orders); upload PDFs; **case-law
  acquisition console** (run HC/SC pulls by court/year/issue); reindex; provenance; stats.
- **Model & prompt config**: provider/model (Gemini/Claude/local), temperature, retrieval top-k;
  **versioned, editable per-module prompts** (A/B, rollback); test connection.
- **Usage & cost**: tokens/cost per user/office/period; quotas; export.
- **Audit & compliance**: full searchable audit log; data-retention controls; access logs.
- **Feedback analytics**: officer edits/ratings → quality metrics → **fine-tuning export**.
- **System health**: queue depth, workers, job failures, corpus index status, uptime.
- **Settings**: SMTP/email, branding, security policy (password rules, session TTL).

## 5. Non-functional requirements
- **Security (govt/taxpayer data):** TLS everywhere; encryption at rest; secrets in a vault;
  RBAC least-privilege; full audit trail; session timeout; rate limiting; CSRF/XSS/SQLi-safe;
  no LLM training on customer data (cloud) — own-model phase removes cloud exposure.
- **Privacy/compliance:** data-retention & deletion policy; PII minimisation; per-office data
  isolation; configurable region of processing.
- **Reliability:** background jobs retried & idempotent; graceful degradation; backups + DR.
- **Performance/scale:** async drafting jobs; horizontal scale of API & workers; vector search
  scalable to millions of chunks; pagination everywhere.
- **Observability:** structured logs, metrics, tracing, error tracking, health endpoints.
- **Maintainability:** layered modular code; typed; tested; CI/CD; migrations; OpenAPI docs.
- **Accessibility/i18n:** keyboard-navigable; English now, Hindi-ready later.

## 6. Phasing (epics → milestones)
- **E1 Foundation:** modular backend, RBAC, refresh tokens, **access-request/approval**,
  invitations/reset, landing + auth portals, app shell, admin console shell, Postgres + migrations.
- **E2 Core workflow:** cases/docs/runs on the new arch; Celery + WebSocket progress; review
  workspace v2 (regenerate, versions, citation viewer); DOCX/PDF.
- **E3 Admin depth:** orgs/tenancy, corpus + acquisition console, prompt/model mgmt, usage/cost,
  audit UI, feedback.
- **E4 Hardening/scale:** pgvector/Qdrant, MinIO, SSO/MFA, observability stack, CI/CD, k8s, DR.
- **E5 Domain:** on-prem own model + fine-tuning loop; ITBA integration; all order types.
