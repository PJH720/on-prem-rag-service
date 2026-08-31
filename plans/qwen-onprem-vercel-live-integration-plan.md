# 🔌 Vercel 실배포 환경 ↔ 온프레미스 GPU(Qwen 3.8) 실시간 연결 완벽 가이드 및 실행 계획

> **문서 위치**: `plans/qwen-onprem-vercel-live-integration-plan.md`  
> **목적**: Vercel 프로덕션 배포본(`on-prem-rag-service.vercel.app`)에서 정적 요약/더미 출력이 아닌, **실제 온프레미스 GPU 서버(DGX Spark)의 Qwen 3.8-Flash 모델이 직접 실시간 생성 추론을 수행하도록 안전하게 연결**하는 구체적 아키텍처 및 단계별 실행 방안 수립.

---

## 1. 현상 분석 및 근본 원인 (Root Cause Analysis)

### 1.1 왜 Vercel 배포본에서 Qwen 3.8이 직접 대답하지 않았는가?
1. **네트워크 격리 (Network Isolation)**:
   - 온프레미스 GPU 서버(DGX Spark)는 **Tailscale 사설망(`spark-f5e2.tail0bfda4.ts.net:8000`)** 내부에서만 접근 가능하도록 폐쇄망에 위치합니다.
   - 반면, Vercel Serverless Functions는 **퍼블릭 AWS 클라우드 인프라** 상에서 실행되므로 사설망 내부의 Tailscale IP/도메인에 직접 라우팅할 수 없습니다 (`ECONNREFUSED` / `ETIMEDOUT`).
2. **Search-Only Fallback의 부작용**:
   - Vercel 환경에서 사설 엔드포인트 접속이 실패하자, 코드가 "검색 전용 모드 (Search-Only Extractive Summary)"로 자동 폴백되어 검색된 문서 조각(스니펫)만 정적으로 출력되었습니다.
3. **사용자가 원하는 최종 목표**:
   - 정해진 텍스트 스니펫 출력이 아닌, **실제 온프레미스 Qwen 3.8-Flash 모델에 프롬프트(질문 + 검색 근거)가 실시간으로 주입되어 동적 LLM 생성 답변이 스트리밍되는 실제 동작 환경 구축**.

---

## 2. 온프레미스 GPU ↔ Vercel 안전한 실시간 연결 3대 방안

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   추천 아키텍처 토폴로지                                        │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘

 [ Vercel Serverless Function ]  (AWS Public Cloud)
                 │
                 │ 1. HTTPS POST /v1/chat/completions
                 │    (인증: Bearer <SECRET_TOKEN>, Body: enable_thinking=false)
                 ▼
 [ Cloudflare Zero-Trust Tunnel ]  (또는 Tailscale Funnel / Reverse Proxy Relay)
                 │
                 │ 2. 종단간 암호화된 아웃바운드 터널 (포트포워딩 불필요, 방화벽 통과)
                 ▼
 [ DGX Spark GPU Node / sglang ]  (On-Premise Server)
   - Model: Inferact/Qwen3.8-Flash-Next-NVFP4
   - Port: 8000 (sglang RadixAttention serving engine)
   - Inference Speed: 0.3s (thinking: false 최적화)
```

---

### 방안 A. Cloudflare Tunnel (가장 추천: 안정성, 보안, 무료, 5분 내 구축)

공유기 포트포워딩이나 공인 IP 개방 없이, GPU 서버에서 아웃바운드 HTTPS 터널을 생성하여 Vercel이 안전하게 통신하도록 구성합니다.

#### 1) GPU 서버(또는 동일 사설망 PC)에서 터널 실행:
```bash
# 1. cloudflared 설치
brew install cloudflared  # (macOS) 또는 curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb (Ubuntu)

# 2. 임시 퍼블릭 HTTPS 터널 즉시 개설 (Quick Tunnel)
cloudflared tunnel --url http://spark-f5e2.tail0bfda4.ts.net:8000
# 👉 출력 예시: https://xxxx-xxxx-xxxx.trycloudflare.com 이 발급됨
```

#### 2) Vercel 환경 변수 설정:
Vercel 대시보드 또는 CLI를 통해 엔드포인트 등록:
```bash
vercel env add LLM_BASE_URL production
# 값 입력: https://xxxx-xxxx-xxxx.trycloudflare.com/v1

vercel env add LLM_MODEL production
# 값 입력: Inferact/Qwen3.8-Flash-Next-NVFP4
```

---

### 방안 B. Tailscale Funnel (Tailscale 공식 퍼블릭 인그레스 기능)

Tailscale에 이미 등록된 Spark 노드의 기능을 활용하여 사내망 엔드포인트를 안전한 퍼블릭 HTTPS로 노출합니다.

#### 1) GPU 노드에서 Funnel 활성화:
```bash
# Spark 노드에서 포트 8000 Funnel 켜기
tailscale funnel 8000 on
# 👉 URL 생성: https://spark-f5e2.tail0bfda4.ts.net/v1
```

#### 2) Vercel 환경 변수 등록:
```bash
vercel env add LLM_BASE_URL production
# 값 입력: https://spark-f5e2.tail0bfda4.ts.net/v1
```

---

### 방안 C. ngrok / zrok (데모 시연용 즉시 개설)

```bash
# ngrok으로 포트 8000을 HTTPS로 포워딩
ngrok http 8000
# 👉 생성된 URL: https://xxxx.ngrok-free.app

# Vercel에 반영
vercel env add LLM_BASE_URL production  # https://xxxx.ngrok-free.app/v1
```

---

## 3. 코드 레벨 필수 보완 항목 (향후 편집 시 적용 사항)

실제 터널이 연결되었을 때 Qwen 3.8의 스트리밍이 원활하게 동작하도록 하기 위한 코드 수정 계획입니다:

### 3.1 `app/api/chat/route.ts` 수정 사항
1. **Search-Only Fallback 제거**:
   - LLM 연결 실패 시 정적 마크다운을 출력하는 대신, **명확한 연결 실패 원인과 상태 코드(`503 Service Unavailable`)** 를 반환하여 Qwen 3.8의 실시간 추론 상태를 투명하게 보장.
2. **Vercel 타임아웃 방지**:
   - `export const maxDuration = 60;` 설정 (Hobby 플랜 최대치, 장문 답변 끊김 방지).
3. **Qwen 3.8 속도 최적화 파라미터 강제**:
   - 요청 body에 `chat_template_kwargs: { enable_thinking: false }` 주입하여 18.7초 지연을 0.3초대로 단축 유지.

### 3.2 `lib/llm.ts` 수정 사항
- `LLM_BASE_URL` 환경 변수가 설정되어 있을 경우, Vercel에서도 해당 URL로 즉시 `fetch`를 수행하도록 에러 핸들링 및 스트림 파이프라인 정비.

### 3.3 `app/page.tsx` UI 수정 사항
- 헤더에 **[실제 온프레미스 GPU 연결됨: Qwen3.8-Flash (Live Streaming)]** 상태 표시등(초록불)을 명확하게 표시.
- 응답 수신 시 토큰 단위로 실시간 타자 효과(Streaming)가 화면에 렌더링되도록 확인.

---

## 4. 단계별 실행 일정 (Execution Roadmap)

| 단계 | 작업 내용 | 소요 시간 | 담당/환경 |
|---|---|---|---|
| **1단계** | GPU 서버 또는 브릿지 머신에서 `cloudflared` 또는 `tailscale funnel`로 HTTPS 터널 개설 | 5분 | 로컬 터미널 / GPU 호스트 |
| **2단계** | `curl -X POST <터널URL>/v1/chat/completions` 로 외부에서 Qwen 3.8 호출 정상 여부 검증 | 2분 | 로컬 터미널 |
| **3단계** | Vercel Project Settings에 `LLM_BASE_URL=<터널URL>/v1` 환경 변수 등록 | 2분 | Vercel 대시보드 / CLI |
| **4단계** | `app/api/chat/route.ts`의 Fallback 제거 및 순수 Qwen 3.8 스트리밍 모드로 재배포 | 5분 | GitHub 푸시 & Vercel 배포 |
| **5단계** | `on-prem-rag-service.vercel.app`에 접속하여 질문 입력 시 Qwen 3.8이 실시간 생성 답변하는지 E2E 최종 검증 | 3분 | 브라우저 |

---

## 5. 검증 체크리스트 (Verification Checklist)

- [ ] **외부 호출 테스트**: `curl -s https://<tunnel-url>/v1/models` 실행 시 `Inferact/Qwen3.8-Flash-Next-NVFP4` 모델 JSON이 정상 반환되는가?
- [ ] **Vercel 응답 헤더**: 브라우저 개발자도구(F12) Network 탭에서 `/api/chat` 응답 모델이 `Inferact/Qwen3.8-Flash-Next-NVFP4`로 표시되는가?
- [ ] **스트리밍 생성 검증**: 고정된 문장이 아니라 사용자가 입력한 다양한 질문에 맞춰 실시간으로 단어가 조합되어 타이핑되는가?
- [ ] **인용 태그 부착**: Qwen 3.8이 답변 문장마다 `[출처: 문서명 §섹션]`을 정확히 생성하는가?
- [ ] **RBAC 동작**: `role="all"`에서는 연봉 테이블이 차단되고 `role="hr"`에서만 Qwen 3.8이 연봉 밴드를 읽어서 생성하는가?
