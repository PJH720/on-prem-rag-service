# 🏢 NexaTech On-Premise RAG Service

[English](./README.md) | [한국어](./README.ko.md)

> **2026 AX 실무 해커톤 과제 제출물**  
> **주제 01**: On-premise 환경 기반 RAG 서비스 구축 (Case 1: 기업 내 신규 직원 온보딩 시스템)  
> **핵심 키워드**: `LangChain.js (LCEL)` · `신뢰도 (인용 & 환각 거부)` · `보안 (RBAC 사전 격리)` · `온프레미스 GPU 추론`

[![Live Service](https://img.shields.io/badge/Live_Service-Vercel_Production-success?style=flat-square&logo=vercel)](https://on-prem-rag-service.vercel.app)
[![GitHub Repository](https://img.shields.io/badge/GitHub-PJH720%2Fon--prem--rag--service-181717?style=flat-square&logo=github)](https://github.com/PJH720/on-prem-rag-service)
[![Architecture Docs](https://img.shields.io/badge/Architecture-Docs-blue?style=flat-square)](./docs/on-premise-architecture.md)
[![Node.js](https://img.shields.io/badge/Node.js-v22-green?style=flat-square&logo=node.js)](https://nodejs.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15%20App%20Router-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![LangChain.js](https://img.shields.io/badge/LangChain.js-Core%20%26%20OpenAI-blueviolet?style=flat-square)](https://js.langchain.com/)

---

## 🌟 프로젝트 개요

**"외부 API를 쓰나 사내 온프레미스 GPU를 쓰나, 애플리케이션 코드는 100% 동일하게 유지된다."**

**NexaTech 온보딩 RAG 지식 챗봇**은 120명 규모 B2B SaaS 기업의 8종 정예 사내 규정(취업규칙, 연차, 재택, 경비/법카, 복리후생, 보안, 연봉, 개발환경)을 기반으로 구축된 **엔터프라이즈급 온프레미스 RAG 서비스**입니다.

사내 1급 기밀(연봉 테이블, 인사평가 등)의 외부 유출을 원천 차단하고, 사내 **NVIDIA DGX Spark GPU 서버(`sglang` + `Qwen3.8-Flash-NVFP4`)** 를 활용하여 **0.3초대 초고속 자체 추론**을 제공합니다.

### 3가지 실행 모드 완벽 지원
1. **온프레미스 GPU 모드 (Primary)**: 사내 사설망에 격리된 DGX Spark GPU 서버와 보안 터널로 실시간 연동되어 0.3초대 초고속 추론 수행 (`enable_thinking: false` 최적화).
2. **클라우드 BYOK 모드 (Fallback)**: Vercel 등 외부 배포 환경에서 사용자의 개인 OpenAI API 키(`gpt-4o-mini`)를 브라우저 `localStorage`에만 보관하고 요청 헤더(`x-byok-key`)로 단발성 중계하는 보안 모드.
3. **검색 전용 모드 (Keyless Instant Demo)**: API 키나 사설 GPU 연결이 없는 환경에서도 심사자가 Vercel 배포본에서 BM25 검색, RBAC 분기, 신뢰도 점수, 근거 카드, 거부 로직을 즉시 체험 가능한 제로-컨피그 모드.

---

## 🎯 1-Click 핵심 검증 시나리오 매트릭스

심사자가 라이브 데모 웹사이트([https://on-prem-rag-service.vercel.app](https://on-prem-rag-service.vercel.app))에서 한눈에 확인할 수 있는 4대 핵심 검증 시나리오입니다:

| # | 테스트 질의 | 전사 권한 (`all`) | 인사팀 권한 (`hr`) | 개발팀 권한 (`eng`) | 핵심 검증 포인트 |
|---|---|---|---|---|---|
| **1** | `"연차는 입사 후 언제부터 쓸 수 있나요?"` | ✅ **1개월 개근 시 1일 발생** (HR-001 인용) | ✅ 동일 조회 | ✅ 동일 조회 | **[기본 질의]** 정확한 수치 및 `[출처: 문서명 §섹션]` 인용 |
| **2** | `"법인카드로 결제한 식대는 어떻게 정산하나요?"` | ✅ **야근식대 15,000원 / 25일 지급** (FIN-001 인용) | ✅ 동일 조회 | ✅ 동일 조회 | **[다중 문서]** 식대 한도 + 정산 기한 결합 답변 |
| **3** | `"직급별 연봉 테이블 알려주세요"` | 🔒 **접근 차단 (권한 없음 안내)** | 🔓 **기본급 밴드 안내** (HR-011 인용) | 🔒 **접근 차단 (권한 없음)** | ★ **[RBAC 보안]** 검색 단계 사전 필터로 LLM 컨텍스트 원천 격리 |
| **4** | `"오늘 점심 메뉴 뭐야?"` | ⛔ **답변 거부 (근거 부족)** | ⛔ **답변 거부 (근거 부족)** | ⛔ **답변 거부 (근거 부족)** | ★ **[환각 방지]** 사내 규정에 없으면 게이트 단계에서 100% 차단 |

---

## 🏗️ LangChain.js 네이티브 아키텍처

본 프로젝트는 `@langchain/core`와 `@langchain/openai`를 기반으로 한 선언적 **LCEL (LangChain Expression Language)** 파이프라인으로 구축되었습니다.

```
 [ 정예 코퍼스 8종 .md ] ─── 빌드타임 인제스트 (pnpm ingest) ───▶ data/index.json (LangChain Document)
   frontmatter: title,                                                청크 26개 + BM25 통계
   category, access_role,                                                        │
   owner, updated_at                                                             │
                                                                                 ▼
                                                                 ┌───────────────────────────────┐
   Next.js 15 App Router (Web UI)                                │   /api/chat (Node.js Route)   │
   ┌────────────────────────────────┐                            │                               │
   │ 1. RBAC 역할 선택기 (all/hr/eng/fin) ── POST (message, role) ─▶ │ 1. RbacBm25Retriever         │
   │ 2. 실시간 SSE 토큰 스트리밍     │                            │    (BaseRetriever 상속)       │
   │ 3. 출처 인용 하이라이트 배지     │ ◀─── SSE Stream ────────── │ 2. evaluateGrounding 게이트   │
   │ 4. 참조 근거 카드 (점수/스니펫) │                            │    (미달 시 LLM 호출 전 거부) │
   │ 5. BYOK 키 설정 (localStorage) │                            │ 3. LCEL RunnableSequence      │
   └────────────────────────────────┘                            │    (XML Context + Prompt)     │
                                                                 └───────────────┬───────────────┘
                                                                                 │ ChatOpenAI
                                                                  ┌──────────────┴──────────────┐
                                                                  ▼                             ▼
                                                      [온프레미스 GPU 서빙 (Primary)]   [클라우드 BYOK (Fallback)]
                                                      DGX Spark (sglang)             OpenAI (api.openai.com)
                                                      Qwen3.8-Flash-NVFP4            gpt-4o-mini
                                                      0.32s 초저지연 (thinking:false)  사용자 키 / 서버 무저장
```

---

## 📂 정예 코퍼스 구성 (8종)

| 문서 ID | 파일명 | 권한 (`access_role`) | 주요 내용 |
|---|---|---|---|
| `GEN-001` | [`01_취업규칙_및_근무시간.md`](./docs/onboarding/01_취업규칙_및_근무시간.md) | `all` | 시차출퇴근제(10~16시 코어타임), 점심시간(12~13시), 수습 3개월(급여 100%) |
| `HR-001` | [`02_연차_및_휴가_규정.md`](./docs/onboarding/02_연차_및_휴가_규정.md) | `all` | **[대표 질의]** 입사 1년 미만 매월 1일 발생, 반차/반반차, 경조/리프레시 |
| `GEN-002` | [`03_재택근무_운영_지침.md`](./docs/onboarding/03_재택근무_운영_지침.md) | `all` | 주 2일 자율 재택, 수요일 전사 오피스 데이, Slack 상태 표시 |
| `FIN-001` | [`04_경비_정산_및_법인카드_규정.md`](./docs/onboarding/04_경비_정산_및_법인카드_규정.md) | `all` | **[다중 문서 검색]** 야근식대 15,000원, 회식비 5만원, 매월 25일 실비 지급 |
| `HR-002` | [`05_복리후생_및_자기계발.md`](./docs/onboarding/05_복리후생_및_자기계발.md) | `all` | 자기계발비 연 120만원, 종합건강검진 전액, 식권대장 중식 포인트 지원 |
| `SEC-001` | [`06_정보보안_및_계정_수칙.md`](./docs/onboarding/06_정보보안_및_계정_수칙.md) | `all` | 1Password 의무화, BYOD 저장 금지, 10분 화면 잠금, 2FA/OTP |
| `HR-011` | [`07_연봉_테이블_및_직급_체계.md`](./docs/onboarding/07_연봉_테이블_및_직급_체계.md) | **`hr`** | ★ **[RBAC 데모 핵심]** 직급별(A/P/S/L) 기본급 밴드, 인센티브 공식 |
| `ENG-001` | [`08_개발_환경_및_배포_규정.md`](./docs/onboarding/08_개발_환경_및_배포_규정.md) | **`eng`** | ★ **[RBAC 개발팀]** Docker Compose 로컬 스택, 금요일 14시 이후 배포 동결 |

---

## ⚙️ 온프레미스 서빙 및 환경 설정

온프레미스 인프라 아키텍처, 하드웨어 사이징(GPU VRAM 산정 공식), Docker 오케스트레이션 및 3개년 TCO(64% 절감)에 대한 상세 설계는 **[`docs/on-premise-architecture.md`](./docs/on-premise-architecture.md)** 에 완벽히 정리되어 있습니다.

```bash
# [온프레미스 GPU 모드 (DGX Spark / sglang)]
LLM_BASE_URL=http://spark-node.internal:8000/v1
LLM_MODEL=Inferact/Qwen3.8-Flash-Next-NVFP4

# [클라우드 BYOK 모드 (OpenAI)]
BYOK_BASE_URL=https://api.openai.com/v1
BYOK_MODEL=gpt-4o-mini
```

---

## 🚀 빠른 시작 (Local Quickstart)

```bash
# 1. 저장소 클론
git clone https://github.com/PJH720/on-prem-rag-service.git
cd on-prem-rag-service

# 2. 의존성 설치 (pnpm v10)
pnpm install

# 3. 마크다운 코퍼스 색인 빌드 (LangChain Document 스키마 index.json 생성)
pnpm ingest

# 4. RBAC & BM25 리트리버 8대 단위/통합 테스트 검증
pnpm test:search

# 5. 로컬 개발 서버 실행 (http://localhost:3000)
pnpm dev
```

---

## 🛡️ 신뢰도 및 보안 핵심 차별점

1. **엄격한 인용 태그 (`[출처: 문서명 §섹션]`) 강제**: 모델 답변의 모든 진술에 인용 태그를 부착하고 UI에서 실시간 하이라이팅 배지로 렌더링.
2. **결정론적 RBAC 사전 필터 (Constructor Pre-Filter)**: 인가되지 않은 문서는 `RbacBm25Retriever` 인스턴스 메모리 자체에 적재되지 않아 LLM 컨텍스트 유출 원천 차단.
3. **신뢰도 게이트 (Grounding Gate)**: 유사도 점수 미달 또는 얕은 매칭 시 LLM 호출을 건너뛰고 즉시 거부 응답 반환.
4. **초저지연 최적화 (`enable_thinking: false`)**: 불필요한 reasoning 토큰 생성을 차단하여 RAG 응답 속도를 **18.7초 ➔ 0.32초(98.3% 단축)** 로 최적화.

---

## 📄 라이선스
MIT License
