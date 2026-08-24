<div align="center">

# **BharathTax**

### *The Sovereign AI Assistant for Indian Tax Professionals*

---

**Citation-Grounded. Self-Hosted. Made for India.**

*Answers rooted in primary tax law — never in a language model's imagination.*

---

</div>

## The Promise in One Line

> **Ask any question on Indian tax law. Get an answer with the exact section, sub-section, proviso, or CBDT circular it came from — or an honest "I don't know." Never a hallucination.**

---

## The Problem We Solve

Tax professionals lose **hours every day** to the same friction:

- Hunting through **880-page Acts, thousands of Rules, and endless CBDT circulars**.
- Cross-checking whether an AI chatbot's confident answer is **actually in the statute** — or invented.
- Sending sensitive client data, notices, and case files to **third-party cloud AI services**.
- Paying **per-seat SaaS fees to foreign vendors** whose models are trained on data they don't own.

Generic AI tools were not built for Indian tax law. They hallucinate section numbers. They cite circulars that don't exist. They store your queries on someone else's servers.

**BharathTax was built to fix all four problems at once.**

---

## What BharathTax Is

A **self-hosted, AI-powered tax-research platform** that:

1. Retrieves from a curated corpus of **primary Indian tax law only** — Income Tax Act, Rules, CBDT Circulars & Notifications.
2. Grounds every response in **cited, clickable sources** — down to the exact section or proviso.
3. **Refuses to answer** when nothing relevant is found. No guesses. No fabrications.
4. Runs **entirely inside your infrastructure** — on-premise or private cloud. Your data never leaves.
5. Scales from a **laptop demo (CPU)** to a **department-wide GPU deployment** with zero code changes.

---

## The Six Pillars

### **1. Grounded Answers, Every Time**

Every response is anchored to the actual statute. A three-stage retrieval pipeline — dense semantic search + sparse keyword FTS + neural cross-encoder reranking — surfaces the most relevant sections before the language model ever sees the question.

- **Dense retrieval** via bge-m3 embeddings over pgvector.
- **Sparse retrieval** via Postgres full-text search.
- **Reranking** via bge-reranker-v2-m3 cross-encoder.
- **Parent-section expansion** so provisos and Explanations arrive with their parent context.

### **2. Anti-Hallucination Grounding Gate**

A hard-coded gate inspects retrieval **before** the LLM is invoked. If the evidence isn't there, the bot says so — plainly and honestly.

> *"No relevant provision found. I will not answer from the model's own knowledge."*

This is the single most valuable behaviour for a regulated profession. It is not an afterthought — it is the design centre.

### **3. Structure-Aware Legal Chunking**

Statute text is not paragraph text. BharathTax parses law the way lawyers read it:

- Splits on **Chapter → Section → Sub-section → Proviso → Explanation**.
- Never fragments a proviso from its parent section.
- Every chunk carries a **breadcrumb prefix** — so a citation is always self-describing.

Validated on the real **880-page Income Tax Act, 1961**.

### **4. Document Q&A**

Upload a notice, an assessment order, or a client file. Ask questions **scoped to that document**. Answers cite both the uploaded doc **and** the underlying statute.

- Handles PDF and structured text.
- Chunked and embedded on the fly.
- Isolated per user and per session.

### **5. Enterprise-Grade Licensing**

Built for how tax departments actually work — with **wings, seats, and concurrent-session limits**.

- **Department → Wing → Seat** hierarchy.
- Live seat pool visible to wing admins.
- Logins block automatically when the pool is exhausted.
- Every session is auditable.

### **6. Multi-Domain by Design**

The MVP ships **Income Tax**. Adding **GST, Customs, or any future domain** is a configuration change — never a code change.

- Add a source in `config/sources.yaml`.
- Drop files into `data/manual/<domain>/…`.
- Run one ingestion command.
- The Module filter surfaces the new domain automatically.

---

## Under the Hood

<div align="center">

| Layer            | Technology                                                        |
|:-----------------|:------------------------------------------------------------------|
| **Frontend**     | React · Vite · TypeScript · Tailwind CSS                          |
| **API**          | FastAPI · SQLAlchemy · Pydantic · Alembic                         |
| **Auth**         | JWT · bcrypt · Seat-based session licensing                       |
| **Datastore**    | PostgreSQL · pgvector (HNSW) · GIN full-text search               |
| **Object store** | MinIO (S3-compatible)                                             |
| **Embeddings**   | bge-m3 (self-hosted, FastAPI ml-server)                           |
| **Reranker**     | bge-reranker-v2-m3 cross-encoder                                  |
| **LLM (dev)**    | Ollama · Qwen2.5-3B-Instruct — runs on a laptop                   |
| **LLM (prod)**   | vLLM · Qwen2.5-14B-Instruct — one GPU with ≥ 24 GB VRAM           |
| **Orchestration**| Docker Compose · Celery workers · Celery beat scheduler           |

</div>

The LLM sits behind a clean `LLMClient` interface. Switching from a mock backend to Ollama to vLLM is **one line in `.env`**. No code change. No retraining. No migration.

---

## Why This Matters for India

<div align="center">

| Concern                        | Generic Cloud AI      | **BharathTax**                     |
|:-------------------------------|:----------------------|:-----------------------------------|
| Data leaves your network       | Yes                   | **Never**                          |
| Cites Indian statute           | Sometimes, often wrong| **Always, verified**               |
| Hallucinates section numbers   | Frequently            | **Refuses instead of guessing**    |
| Trained on your queries        | Usually               | **No — your data is yours**        |
| Per-seat foreign SaaS bill     | Recurring, in USD     | **One-time deploy, INR CAPEX**     |
| Works air-gapped               | No                    | **Yes**                            |
| Adds GST / Customs later       | Vendor's roadmap      | **Your configuration, today**      |
| Departmental seat licensing    | Not offered           | **Built in**                       |
| Auditable answer trail         | Rare                  | **Every citation is traceable**    |

</div>

---

## Who It Is For

- **Income Tax Departments** — investigation wings, appeals, assessments, and research cells.
- **Chartered Accountancy Firms** — Big Four, mid-market, and boutique practices.
- **Corporate Tax Teams** — in-house counsel and tax controllers of large enterprises.
- **Legal Publishers** — building tax-research products with a sovereign AI layer.
- **Government & PSU Legal Cells** — where data residency is non-negotiable.

---

## Real-World Use Cases

### **Faster Research**
*"What is the maximum deduction available under section 80C for a HUF assessee?"*
→ Grounded answer with a link to the exact clause.

### **Notice Response Drafting**
Upload a Section 143(2) notice. Ask *"Which provisions apply and what is the response window?"* — receive a citation-backed brief.

### **Cross-Statute Reasoning**
Ask a Rule-1962 question that turns on an Act-1961 definition — retrieval spans both, citations distinguish them.

### **Historical Circular Lookup**
*"Has CBDT clarified the treatment of ESOP perquisites for non-residents?"*
→ Circular number, date, and the exact paragraph — or an honest refusal.

### **Onboarding Junior Staff**
New associates get instant, cited, authoritative answers — without a partner spending 20 minutes explaining every statute lookup.

---

## Deployment Options

### **On-Premise**
Runs on a single server with Docker Compose. Air-gapped compatible. Nothing leaves the LAN.

### **Private Cloud**
Deploy in your AWS / Azure / GCP tenancy, inside a VPC, with your own KMS.

### **Hybrid**
Ingestion + embedding on GPU nodes, serving from CPU nodes closer to users.

### **Laptop Demo**
`make up && make seed && make ingest` — a live, working demo on a developer laptop in an afternoon.

---

## Security, Compliance & Governance

- **Zero data egress.** No third-party API calls at inference time.
- **JWT authentication** with rotatable secrets.
- **Bcrypt-hashed credentials** — no plaintext, no reversible ciphers.
- **Append-only audit log** for every login and every question asked.
- **Seat-based concurrent-session enforcement.**
- **Role-based access** — super admin, wing admin, officer, auditor.
- **Data residency by construction** — the stack runs wherever you put it.
- **Open-source ML models** — no vendor lock-in, no opaque licensing.

---

## What's Verified in the MVP

<div align="center">

| Milestone                                              | Status |
|:-------------------------------------------------------|:------:|
| Full Income Tax Act 1961 + Rules 1962 corpus ingested  | **Done** |
| CBDT Circular 06/2025 ingested                         | **Done** |
| 3,898 clean chunks with breadcrumb citations           | **Done** |
| Dense + sparse hybrid retrieval + neural reranker      | **Done** |
| Anti-hallucination refusal gate                        | **Done** |
| Structure-aware chunker (provisos never split)         | **Done** |
| Seat licensing blocks logins at the limit              | **Done** |
| End-to-end test suite (11 / 11 passing)                | **Done** |
| GPU production overlay (vLLM + 14B)                    | **Ready** |
| GST / Customs domain extension                         | **Config-only** |

</div>

---

## The Roadmap

Clean extension points already exist for:

- **Case-law & NJRS ingestion** — tribunal, HC, and SC judgment corpus.
- **Draft Bot** — notice, order, and appeal drafting.
- **MS-Word Add-in** — research inside the drafting workflow.
- **PII redaction tool** — for shareable extracts.
- **SSO (SAML / OIDC)** — for enterprise identity providers.
- **Multi-instance federation** — for pan-department deployments.
- **Live circular auto-crawl** — beyond the current manual-drop path.

---

## Getting Started

Three commands to a running demo:

```bash
make up          # start the stack
make migrate     # create the schema
make seed        # demo users, wings, and seats
```

Then browse to **http://127.0.0.1:5173** and log in as `officer1 / officer123`.

---

<div align="center">

## **BharathTax**

*Sovereign AI. Cited Answers. Built for Indian Tax Law.*

---

**Ready to see it in action?**

Request a live demo · Book an on-premise pilot · Ask about custom domains

---

*Self-hosted. Citation-backed. Made in India, for India.*

</div>
