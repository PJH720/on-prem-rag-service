# 🏢 NexaTech On-Premise RAG Service

> **2026 AX 실무 해커톤 과제 제출물**  
> **주제 01**: On-premise 환경 기반 RAG 서비스 구축 (Case 1: 신규 직원 온보딩 시스템)  
> **핵심 키워드**: `RAG` · `신뢰도 (Citations & Rejection)` · `보안 (RBAC)` · `온프레미스 GPU 추론`

[![GitHub Repository](https://img.shields.io/badge/GitHub-PJH720%2Fon--prem--rag--service-181717?style=flat-square&logo=github)](https://github.com/PJH720/on-prem-rag-service)
[![Architecture Docs](https://img.shields.io/badge/Architecture-Docs-blue?style=flat-square)](./docs/on-premise-architecture.md)
[![Node.js](https://img.shields.io/badge/Node.js-v22-green?style=flat-square&logo=node.js)](https://nodejs.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15%20App%20Router-black?style=flat-square&logo=next.js)](https://nextjs.org/)

---

## 🌟 프로젝트 개요

**"외부 API를 쓰나 사내 온프레미스 GPU를 쓰나, 애플리케이션 코드는 단 한 줄도 바뀔 필요가 없다."**

**NexaTech 온보딩 RAG 지식 챗봇**은 120명 규모 B2B SaaS 기업의 8종 정예 사내 규정(취업규칙, 연차, 재택, 경비/법카, 복리후생, 보안, 연봉, 개발환경)을 기반으로 구축된 **엔터프라이즈급 온프레미스 RAG 서비스**입니다.

### 3가지 실행 모드 완벽 지원
1. **온프레미스 GPU 모드 (Primary)**: 사내 사설망에 격리된 **NVIDIA DGX Spark GPU 서버 (`sglang` + `Qwen3.8-Flash-NVFP4`)** 를 통한 0.3초대 초고속 자체 추론 (`enable_thinking: false` 최적화).
2. **클라우드 BYOK 모드 (Fallback)**: Vercel 등 외부 배포 시 사용자의 개인 API 키(OpenAI `gpt-4o-mini`)를 브라우저 `localStorage`에만 보관하고 요청 헤더(`x-byok-key`)로 단발성 중계하는 보안 모드.
3. **검색 전용 모드 (Keyless Instant Demo)**: **API 키가 없는 심사자도 Vercel 링크에서 BM25 검색, RBAC 분기, 근거 카드, 거부 로직을 100% 즉시 체험 가능.**

---

## 🎯 1-Click 핵심 검증 시나리오 매트릭스

심사자가 한눈에 확인할 수 있는 4대 핵심 검증 시나리오입니다:

| # | 테스트 질의 | 전사 권한 (`all`) | 인사팀 권한 (`hr`) | 개발팀 권한 (`eng`) | 핵심 검증 포인트 |
|---|---|---|---|---|---|
| **1** | `"연차는 입사 후 언제부터 쓸 수 있나요?"` | ✅ **1개월 개근 시 1일 발생** (HR-001 인용) | ✅ 동일 조회 | ✅ 동일 조회 | **[기본 질의]** 정확한 수치 및 출처 인용 |
| **2** | `"법인카드로 결제한 식대는 어떻게 정산하나요?"` | ✅ **야근식대 15,000원 / 25일 지급** (FIN-001 인용) | ✅ 동일 조회 | ✅ 동일 조회 | **[다중 문서]** 식대 한도 + 정산 기한 결합 |
| **3** | `"직급별 연봉 테이블 알려주세요"` | 🔒 **접근 차단 (권한 없음 안내)** | 🔓 **기본급 밴드 안내** (HR-011 인용) | 🔒 **접근 차단 (권한 없음)** | ★ **[RBAC 보안]** 사전 필터로 LLM 컨텍스트 격리 |
| **4** | `"오늘 점심 메뉴 뭐야?"` | ⛔ **답변 거부 (근거 부족)** | ⛔ **답변 거부 (근거 부족)** | ⛔ **답변 거부 (근거 부족)** | ★ **[신뢰도]** 사내 문서에 없으면 100% 환각 차단 |

---

## 🏗️ 시스템 아키텍처

```
 [ 정예 코퍼스 8종 .md ] ─── 빌드타임 인제스트 (pnpm ingest) ───▶ data/index.json (커밋됨)
   frontmatter: title,                                               청크 26개 + BM25 통계
   category, access_role,                                                    │
   owner, updated_at                                                         │
                                                                             ▼
                                                             ┌───────────────────────────────┐
   Next.js 15 App Router (Web UI)                            │   /api/chat (Node.js Route)   │
   ┌────────────────────────────────┐                        │                               │
   │ 1. RBAC 역할 선택기 (전사/인사/개발/재무)│ ──── POST ──────────▶ │ 1. 역할 기반 사전 필터 (Pre-filter)│
   │ 2. 실시간 스트리밍 대화창        │                        │ 2. BM25 어휘 검색 (k1=1.2, b=0.75) │
   │ 3. 출처 인용 하이라이트 배지     │ ◀─── SSE Stream ────── │ 3. 신뢰도 임계값 검증 (부족시 거부)│
   │ 4. 참조 근거 카드 (점수/스니펫) │                        │ 4. 출처 인용 강제 프롬프트 생성   │
   │ 5. BYOK 키 설정 (localStorage) │                        └───────────────┬───────────────┘
   └────────────────────────────────┘                                        │ 단일 LLM Client
                                                              ┌──────────────┴──────────────┐
                                                              ▼                             ▼
                                                  [온프레미스 GPU 추론 (Primary)]       [클라우드 BYOK (Fallback)]
                                                  DGX Spark (sglang)            OpenAI (api.openai.com)
                                                  Qwen3.8-Flash-NVFP4           gpt-4o-mini
                                                  사설망 격리 / 키 불필요          사용자 키 / 서버 미저장
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

## ⚙️ 온프레미스 vs 클라우드 환경 설정 비교

단 2줄의 환경 변수 변경만으로 동일한 코드가 온프레미스와 퍼블릭 클라우드를 오갑니다:

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

# 2. 의존성 설치
pnpm install

# 3. 마크다운 코퍼스 BM25 색인 빌드 (data/index.json 생성)
pnpm ingest

# 4. BM25 및 RBAC 권한 필터링 7대 시나리오 캘리브레이션 테스트 검증
pnpm test:search

# 5. 로컬 개발 서버 실행
pnpm dev
```

---

## 📄 라이선스
MIT License
