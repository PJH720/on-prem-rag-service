# 🏢 NexaTech On-Premise RAG Service

[English](./README.md) | [한국어](./README.ko.md)

> **2026 AX Practical Hackathon Submission**  
> **Topic 01**: On-Premise Environment-Based RAG Service (Case 1: New Employee Onboarding System)  
> **Core Themes**: `RAG` · `Reliability (Citations & Rejection)` · `Security (RBAC)` · `On-Premise GPU Serving`

[![GitHub Repository](https://img.shields.io/badge/GitHub-PJH720%2Fon--prem--rag--service-181717?style=flat-square&logo=github)](https://github.com/PJH720/on-prem-rag-service)
[![Architecture Docs](https://img.shields.io/badge/Architecture-Docs-blue?style=flat-square)](./docs/on-premise-architecture.md)
[![Node.js](https://img.shields.io/badge/Node.js-v22-green?style=flat-square&logo=node.js)](https://nodejs.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15%20App%20Router-black?style=flat-square&logo=next.js)](https://nextjs.org/)

---

## 🌟 Executive Summary

**"Whether querying a private on-premise GPU or an external cloud API, the application code remains 100% identical."**

**NexaTech Onboarding RAG Knowledge Assistant** is an enterprise-grade on-premise Retrieval-Augmented Generation (RAG) system built upon 8 curated corporate policy documents (Employment Rules, Annual Leave, Telecommuting, Expense/Corporate Card, Benefits, Information Security, Salary Grid, and Engineering Setup) for a virtual 120-person B2B SaaS company.

### 3 Execution Modes Supported Out of the Box:
1. **On-Premise GPU Mode (Primary)**: Sub-second (~0.3s) local inference powered by an **NVIDIA DGX Spark GPU server (`sglang` + `Qwen3.8-Flash-NVFP4`)** isolated in a private Zero-Trust network (`enable_thinking: false` latency optimization).
2. **Cloud BYOK Mode (Fallback)**: For public cloud deployments (e.g., Vercel), users can provide their personal OpenAI API key (`gpt-4o-mini`). The key is kept strictly in browser `localStorage` and relayed only via request headers (`x-byok-key`) with zero server retention.
3. **Keyless Search-Only Mode (Zero-Config Demo)**: **Reviewers without an API key can immediately evaluate the live Vercel deployment with full BM25 search, RBAC isolation, score breakdown, source cards, and hallucination rejection.**

---

## 🎯 1-Click Demo Evaluation Matrix

A unified test matrix showcasing our core RAG, RBAC, and rejection capabilities:

| # | Test Query | General Role (`all`) | HR Role (`hr`) | Eng Role (`eng`) | Key Verification Metric |
|---|---|---|---|---|---|
| **1** | `"When can I use my annual leave after joining?"` | ✅ **1 day earned per month worked** (Cited: HR-001) | ✅ Full Access | ✅ Full Access | **[Base Retrieval]** Exact policy metrics & citation tag |
| **2** | `"How do I settle night meal expenses on corporate card?"` | ✅ **₩15,000 limit / 25th payout** (Cited: FIN-001) | ✅ Full Access | ✅ Full Access | **[Multi-Doc Synthesis]** Combines card rules with ERP dates |
| **3** | `"Show me the salary band table for each level"` | 🔒 **Access Blocked (No Permission)** | 🔓 **Band Displayed (A/P/S/L)** (Cited: HR-011) | 🔒 **Access Blocked (No Permission)** | ★ **[RBAC Security]** Candidate pool pre-filtered before LLM |
| **4** | `"What is today's cafeteria lunch menu?"` | ⛔ **Response Rejected (No Grounding)** | ⛔ **Response Rejected (No Grounding)** | ⛔ **Response Rejected (No Grounding)** | ★ **[Hallucination Prevention]** Strict rejection if not in docs |

---

## 🏗️ System Architecture

```
 [ 8 Curated .md Corpus ] ─── Build-time Ingestion (pnpm ingest) ───▶ data/index.json (Committed)
   frontmatter: title,                                                26 chunks + BM25 term stats
   category, access_role,                                                        │
   owner, updated_at                                                             │
                                                                                 ▼
                                                                 ┌───────────────────────────────┐
   Next.js 15 App Router (Web Client)                            │   /api/chat (Node.js Route)   │
   ┌────────────────────────────────┐                            │                               │
   │ 1. RBAC Role Selector (all/hr/eng/fin) ──── POST ─────────▶ │ 1. RBAC Pre-Filter (Isolation) │
   │ 2. Real-time SSE Chat Stream   │                            │ 2. BM25 Hybrid Lexical Search │
   │ 3. Citation Pill Highlight     │ ◀─── SSE Stream ────────── │ 3. Confidence Threshold Gate  │
   │ 4. Grounding Card View (Scores)│                            │ 4. Citation-Forced Prompting  │
   │ 5. Client-Side BYOK Key Modal  │                            └───────────────┬───────────────┘
   └────────────────────────────────┘                                            │ Unified Client
                                                                  ┌──────────────┴──────────────┐
                                                                  ▼                             ▼
                                                      [On-Premise GPU Serving]        [Public Cloud BYOK]
                                                      DGX Spark (sglang)             OpenAI (api.openai.com)
                                                      Qwen3.8-Flash-NVFP4            gpt-4o-mini
                                                      Zero-Trust Mesh / Keyless      User Key / Zero-Retention
```

---

## 📂 Curated Knowledge Base (8 Core Documents)

| Doc ID | File | Role (`access_role`) | Summary |
|---|---|---|---|
| `GEN-001` | [`01_취업규칙_및_근무시간.md`](./docs/onboarding/01_취업규칙_및_근무시간.md) | `all` | Staggered commute (10:00~16:00 core time), 1hr lunch, 3-month probation (100% pay) |
| `HR-001` | [`02_연차_및_휴가_규정.md`](./docs/onboarding/02_연차_및_휴가_규정.md) | `all` | **[Primary Query]** 1 day/mo in 1st year, half-day/quarter-day, condolence & refresh leave |
| `GEN-002` | [`03_재택근무_운영_지침.md`](./docs/onboarding/03_재택근무_운영_지침.md) | `all` | Up to 2 days/week telecommuting, Wednesday Office Day, Slack status, VPN protocol |
| `FIN-001` | [`04_경비_정산_및_법인카드_규정.md`](./docs/onboarding/04_경비_정산_및_법인카드_규정.md) | `all` | **[Multi-Doc Search]** ₩15,000 night meal cap, ₩50k team dinner, 25th monthly payout |
| `HR-002` | [`05_복리후생_및_자기계발.md`](./docs/onboarding/05_복리후생_및_자기계발.md) | `all` | ₩1.2M/yr self-development allowance, annual health checkup, ₩200k/mo meal credits |
| `SEC-001` | [`06_정보보안_및_계정_수칙.md`](./docs/onboarding/06_정보보안_및_계정_수칙.md) | `all` | Mandatory 1Password vault, BYOD ban, 10-min screen lock, 2FA/OTP enforcement |
| `HR-011` | [`07_연봉_테이블_및_직급_체계.md`](./docs/onboarding/07_연봉_테이블_및_직급_체계.md) | **`hr`** | ★ **[RBAC Core Demo]** Level-based base pay bands (A/P/S/L), profit-sharing incentive |
| `ENG-001` | [`08_개발_환경_및_배포_규정.md`](./docs/onboarding/08_개발_환경_및_배포_규정.md) | **`eng`** | ★ **[RBAC Eng Demo]** Docker Compose local stack, Friday 14:00+ deployment freeze |

---

## ⚙️ Environment Configuration: On-Premise vs Cloud

Switching between on-premise GPU cluster and public cloud requires modifying only 2 environment variables:

```bash
# [On-Premise GPU Serving (DGX Spark / sglang)]
LLM_BASE_URL=http://spark-node.internal:8000/v1
LLM_MODEL=Inferact/Qwen3.8-Flash-Next-NVFP4

# [Public Cloud BYOK Mode (OpenAI)]
BYOK_BASE_URL=https://api.openai.com/v1
BYOK_MODEL=gpt-4o-mini
```

---

## 🚀 Local Quickstart

### 1. Prerequisites
- Node.js 22+ & pnpm 10+
- (Optional for On-Premise) Private network connection to GPU host

### 2. Setup and Ingestion
```bash
# 1. Clone the repository
git clone https://github.com/PJH720/on-prem-rag-service.git
cd on-prem-rag-service

# 2. Install dependencies
pnpm install

# 3. Build BM25 index from markdown corpus (generates data/index.json)
pnpm ingest

# 4. Run automated BM25 & RBAC calibration tests (7 scenarios)
pnpm test:search

# 5. Launch development server (http://localhost:3000)
pnpm dev
```

---

## 🛡️ Reliability & Security Highlights

1. **Strict Citation Enforcement**: Every asserted sentence is backed by an inline source tag `[출처: Document §Section]`.
2. **Deterministic RBAC Pre-Filtering**: Documents outside the user's role are eliminated before candidate scoring, ensuring sensitive data never enters the prompt context.
3. **Threshold-Based Rejection Gate**: Queries with insufficient lexical confidence or low query-term coverage bypass LLM generation and return a friendly out-of-domain rejection message, eliminating hallucinations.
4. **Comprehensive Architecture Blueprint**: Review our complete enterprise infrastructure, sizing, and TCO analysis in [`docs/on-premise-architecture.md`](./docs/on-premise-architecture.md).

---

## 📄 License
MIT License
