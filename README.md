# 🏢 NexaTech On-Premise RAG Service

> **2026 AX 실무 해커톤 과제 제출물**  
> **주제 01**: On-premise 환경 기반 RAG 서비스 구축 (Case 1: 신규 직원 온보딩 시스템)  
> **핵심 키워드**: `RAG` · `신뢰도 (Citations & Rejection)` · `보안 (RBAC)` · `온프레미스 GPU 추론`

[![GitHub Repository](https://img.shields.io/badge/GitHub-PJH720%2Fon--prem--rag--service-181717?style=flat-square&logo=github)](https://github.com/PJH720/on-prem-rag-service)
[![Architecture](https://img.shields.io/badge/Architecture-Docs-blue?style=flat-square)](./docs/on-premise-architecture.md)
[![Node.js](https://img.shields.io/badge/Node.js-v22-green?style=flat-square&logo=node.js)](https://nodejs.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15%20App%20Router-black?style=flat-square&logo=next.js)](https://nextjs.org/)

---

## 🌟 프로젝트 개요

**"외부 API를 쓰나 사내 온프레미스 GPU를 쓰나, 애플리케이션 코드는 단 한 줄도 바뀔 필요가 없다."**

**NexaTech 온보딩 RAG 지식 챗봇**은 120명 규모 B2B SaaS 기업의 15종 사내 규정(연차, 경비, 복리후생, 개발 환경, 비밀유지, 연봉/평가 등)을 기반으로 구축된 **엔터프라이즈급 온프레미스 RAG 프로토타입**입니다.

동일한 코드베이스가 두 가지 모드로 완전하게 구동됩니다:
1. **로컬 온프레미스 모드 (Primary)**: 사내 Tailscale 사설망에 격리된 **NVIDIA DGX Spark GPU 서버 (`sglang` + `Qwen3.8-Flash-NVFP4`)** 를 통한 0.3초대 초고속 자체 추론.
2. **클라우드 BYOK 모드 (Fallback)**: Vercel 등 외부 배포 시 사용자의 개인 API 키(OpenAI)를 브라우저 `localStorage`에만 보관하고 요청 헤더(`x-byok-key`)로 단발성 중계하는 보안 배포 모드.

---

## 🏗️ 시스템 아키텍처

```
 [ 더미 코퍼스 15개 .md ] ─── 빌드타임 인제스트 (pnpm ingest) ───▶ data/index.json (커밋됨)
   frontmatter: title,                                                청크 63개 + BM25 통계
   category, access_role,                                                     │
   owner, updated_at                                                          │
                                                                              ▼
                                                              ┌───────────────────────────────┐
   Next.js 15 App Router (Web UI)                             │   /api/chat (Node.js Route)   │
   ┌────────────────────────────────┐                         │                               │
   │ 1. RBAC 역할 선택기 (전사/인사/개발/재무)│ ──── POST ───────────▶ │ 1. 역할 기반 사전 필터 (Pre-filter)│
   │ 2. 실시간 스트리밍 대화창        │                         │ 2. BM25 어휘 검색 (k1=1.2, b=0.75) │
   │ 3. 출처 인용 하이라이트 배지     │ ◀─── SSE Stream ─────── │ 3. 신뢰도 임계값 검증 (부족시 거부)│
   │ 4. 참조 근거 카드 (점수/스니펫) │                         │ 4. 출처 인용 강제 프롬프트 생성   │
   │ 5. BYOK 키 설정 (localStorage) │                         └───────────────┬───────────────┘
   └────────────────────────────────┘                                         │ 동일한 LLM Client
                                                               ┌──────────────┴──────────────┐
                                                               ▼                             ▼
                                                   [온프레미스 GPU 추론 (Primary)]       [클라우드 BYOK (Fallback)]
                                                   DGX Spark (sglang)            OpenAI (api.openai.com)
                                                   Qwen3.8-Flash-NVFP4           gpt-4o-mini
                                                   Tailscale 사설망 / 키 불필요     사용자 키 / 서버 미저장
```

---

## 🔑 4대 핵심 차별화 포인트

| 키워드 | 구현 상세 |
|---|---|
| **RAG** | • `##` 시맨틱 헤딩 기반 청킹 (63개 청크, 평균 259 토큰)<br>• **어절 + 문자 2-gram 하이브리드 토크나이저**로 형태소 분석기 없이 한국어 조사 매칭 완벽 해결<br>• 정규화된 BM25 검색 스코어(0~100%) UI 노출 |
| **신뢰도 (Confidence)** | • **100% 인용 강제**: 모든 문장에 `[출처: 문서명 §섹션]` 태그 부착<br>• **환각 방지 답변 거부 (Rejection Threshold)**: 검색 신뢰도가 임계값(12.0) 미만이거나 쿼리 커버리지가 부족할 경우 LLM 호출을 차단하고 *"사내 문서에서 근거를 찾지 못했습니다"* 즉시 반환 |
| **보안 (RBAC)** | • **문서 단위 접근 제어(Role-Based Access Control)**: `access_role` (`all` \| `hr` \| `eng` \| `finance`)<br>• 검색 **이전에(Pre-filter)** 후보군을 분리하여 권한 없는 문서는 LLM 컨텍스트에 **애초에 진입 불가**<br>• 💡 *데모: "연봉 테이블 알려주세요" 질의 시 `all`에서는 결과 0건 차단, `hr`에서는 1위 검색* |
| **온프레미스 (On-Prem)** | • 실제 DGX Spark GPU 서버 연동 검증 완료 (`chat_template_kwargs: { enable_thinking: false }` 최적화)<br>• 상세 구축 설계서 포함: [`docs/on-premise-architecture.md`](./docs/on-premise-architecture.md) |

---

## 📂 코퍼스 및 지식 베이스 구성 (15종)

| 문서 ID | 파일명 | 권한 (`access_role`) | 설명 |
|---|---|---|---|
| `GEN-001` | [`01_취업규칙_요약.md`](./docs/onboarding/01_취업규칙_요약.md) | `all` | 수습 3개월(급여 100%), 시차출퇴근제(10~16시 코어타임) |
| `HR-001` | [`02_연차_휴가_규정.md`](./docs/onboarding/02_연차_휴가_규정.md) | `all` | **[대표 질의]** 입사 1년 미만 매월 1일 발생, 반차/반반차, 경조/리프레시 |
| `GEN-002` | [`03_재택근무_운영_지침.md`](./docs/onboarding/03_재택근무_운영_지침.md) | `all` | 주 2일 자율 재택, 수요일 오피스 데이, Slack 상태 표시 |
| `FIN-001` | [`04_경비_정산_가이드.md`](./docs/onboarding/04_경비_정산_가이드.md) | `all` | **[다중 문서 검색]** 매월 5일 마감 / 25일 지급, 적격 증빙 요건 |
| `FIN-002` | [`05_법인카드_사용_규정.md`](./docs/onboarding/05_법인카드_사용_규정.md) | `all` | **[대표 질의]** 야근식대 15,000원, 회식비 5만원, 3일 이내 전표 처리 |
| `HR-002` | [`06_복리후생_안내.md`](./docs/onboarding/06_복리후생_안내.md) | `all` | 자기계발비 연 120만원, 건강검진, 명절 상여, 식권대장 중식 지원 |
| `HR-003` | [`07_신규_입사자_온보딩_체크리스트.md`](./docs/onboarding/07_신규_입사자_온보딩_체크리스트.md) | `all` | D-Day, 1주차, 30/60/90일 마일스톤, 1:1 버디 커피챗 지원 |
| `IT-001` | [`08_장비_및_계정_신청_절차.md`](./docs/onboarding/08_장비_및_계정_신청_절차.md) | `all` | MacBook Pro 16/Air 지급, 4K 모니터, 사내 Tailscale VPN 접속 |
| `SEC-001` | [`09_정보보안_기본_수칙.md`](./docs/onboarding/09_정보보안_기본_수칙.md) | `all` | 1Password 의무화, BYOD 저장 금지, 10분 화면 잠금, 사고 신고 |
| `GEN-003` | [`10_조직도_및_부서별_업무_안내.md`](./docs/onboarding/10_조직도_및_부서별_업무_안내.md) | `all` | **[답변 거부 인접 문서]** 경영진/본부별 업무 안내 및 문의 창구 |
| `HR-011` | [`11_연봉_테이블_및_직급_체계.md`](./docs/onboarding/11_연봉_테이블_및_직급_체계.md) | **`hr`** | ★ **[RBAC 데모 핵심]** 직급별(A/P/S/L) 기본급 밴드, 인센티브 공식 |
| `HR-012` | [`12_인사평가_운영_세칙.md`](./docs/onboarding/12_인사평가_운영_세칙.md) | **`hr`** | ★ **[RBAC 데모]** OKR/다면평가, S/A/B/C 강제 배분 쿼터, 연봉 인상표 |
| `ENG-001` | [`13_개발_환경_셋업_가이드.md`](./docs/onboarding/13_개발_환경_셋업_가이드.md) | **`eng`** | ★ **[개발팀 전용]** Node 22, pnpm, Docker Compose 로컬 스택 |
| `ENG-002` | [`14_코드_리뷰_및_배포_규정.md`](./docs/onboarding/14_코드_리뷰_및_배포_규정.md) | **`eng`** | ★ **[개발팀 전용]** Trunk-Based 브랜치, 금요일 14시 이후 배포 동결 |
| `FIN-011` | [`15_예산_집행_승인_한도_규정.md`](./docs/onboarding/15_예산_집행_승인_한도_규정.md) | **`finance`** | ★ **[재무팀 전용]** 팀장 300만 / 본부장 1,000만 / CFO 5,000만 전결 |

---

## ⚙️ 온프레미스 vs 클라우드 환경 설정 비교

단 2줄의 환경 변수 변경만으로 동일한 코드가 온프레미스와 퍼블릭 클라우드를 오갑니다:

```bash
# [온프레미스 GPU 모드 (DGX Spark / sglang)]
LLM_BASE_URL=http://spark-f5e2.tail0bfda4.ts.net:8000/v1
LLM_MODEL=Inferact/Qwen3.8-Flash-Next-NVFP4

# [클라우드 BYOK 모드 (OpenAI)]
BYOK_BASE_URL=https://api.openai.com/v1
BYOK_MODEL=gpt-4o-mini
```

---

## 🚀 빠른 시작 (Local Quickstart)

### 1. 사전 요구사항
- Node.js 22+ 및 pnpm 10+
- (온프레미스 모드 사용 시) Tailscale 사설망 연결

### 2. 설치 및 색인 생성
```bash
# 1. 저장소 클론
git clone https://github.com/PJH720/on-prem-rag-service.git
cd on-prem-rag-service

# 2. 의존성 설치
pnpm install

# 3. 마크다운 코퍼스 BM25 색인 빌드 (data/index.json 생성)
pnpm ingest

# 4. BM25 및 RBAC 권한 필터링 유닛 테스트 검증
pnpm test:search
```

### 3. 로컬 개발 서버 실행
```bash
# 로컬 개발 서버 기동 (http://localhost:3000)
pnpm dev
```

---

## 🧪 E2E 검증 시나리오

1. **대표 질의**: `"연차는 입사 후 언제부터 쓸 수 있나요?"` (전사 권한)  
   👉 `02_연차_휴가_규정.md §연차 유급휴가 발생 기준` 인용과 함께 정확한 일수 답변.
2. **다중 문서 검색**: `"법인카드로 결제한 식대는 어떻게 정산하나요?"` (전사 권한)  
   👉 `05_법인카드_사용_규정.md`와 `04_경비_정산_가이드.md`가 동시에 검색되어 종합 답변.
3. **RBAC 보안 차단**: `"직급별 연봉 테이블 알려주세요"`  
   - `role=all` (전사): 검색 결과 0건으로 **차단 및 거부 안내**
   - `role=hr` (인사팀): `11_연봉_테이블_및_직급_체계.md`가 1위로 검색되어 **연봉 밴드 정확히 안내**
4. **환각 방지 거부**: `"오늘 구내식당 점심 메뉴 뭐야?"`  
   👉 사내 문서에 근거가 없어 LLM 호출 없이 **신뢰도 경고 및 거부 안내**.

---

## 📄 라이선스
MIT License
