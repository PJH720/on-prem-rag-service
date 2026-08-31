# 넥사테크(NexaTech) 온프레미스 RAG 서비스 아키텍처 설계서

## 1. 개요 및 온프레미스 도입 배경

### 1.1 배경 및 비즈니스 요구사항
현대 엔터프라이즈 환경에서 생성형 AI(LLM) 기반의 사내 지식 관리 시스템(RAG) 도입이 가속화되고 있으나, 다음과 같은 핵심 과제에 직면해 있습니다:
1. **사내 기밀 데이터 외부 유출 방지**: 취업규칙, 인사평가, 연봉 테이블, 미공개 기술 문서, 고객사 계약서 등 민감 데이터가 퍼블릭 클라우드 LLM API(OpenAI, Anthropic 등)로 전송될 경우 컴플라이언스(개인정보보호법, ISO 27001) 위반 리스크 발생.
2. **네트워크 격리 및 데이터 주권(Data Sovereignty)**: 폐쇄망(On-Premise / Air-Gapped) 또는 사설망(Tailscale / VPN) 환경 내에서 외부 인터넷 연결 없이 100% 독립 구동되는 자체 추론 및 검색 인프라 필요.
3. **역할 기반 접근 제어 (RBAC)**: 직급 및 소속 부서(전사, 인사, 개발, 재무 등)에 따라 문서 접근 권한을 철저히 격리하여 권한 없는 데이터가 LLM 컨텍스트에 주입되지 않도록 보장.

### 1.2 시스템 목표
- **종단간(End-to-End) 사설 인프라 구성**: GPU 가속 온프레미스 LLM 추론 서버, 임베딩 파이프라인, 고속 인덱싱 엔진, 웹 애플리케이션의 컨테이너화된 통합 배포.
- **클라우드-온프레미스 일원화 아키텍처**: OpenAI 호환 API 인터페이스를 채택하여 환경 변수 변경만으로 로컬 온프레미스 GPU 클러스터와 클라우드 BYOK(Bring Your Own Key) 간 전환 지원.

---

## 2. 참조 구현 및 실측 데이터 (사내 sLLM 서빙용 워크스테이션)

본 설계는 실제 구축 및 검증된 사내 sLLM 서빙용 GPU 워크스테이션 인프라의 실측 벤치마크 데이터를 기반으로 작성되었습니다.

### 2.1 실측 하드웨어 및 런타임 환경
- **호스트 인프라**: 사내 sLLM 전용 GPU 워크스테이션
- **네트워크 토폴로지**: Zero-Trust 사설망 (`sllm-server.internal:8000`)
- **추론 프레임워크**: `sglang` (High-throughput LLM serving engine with RadixAttention)
- **배포 모델**: `Inferact/Qwen3.8-Flash-Next-NVFP4`

- **최대 컨텍스트 길이 (Max Context)**: 262,144 tokens (262K 초장문 컨텍스트 지원)
- **가중치 양자화**: **NVFP4 (NVIDIA 4-bit Floating Point)** — 메모리 점유율을 대폭 절감하면서도 16-bit 부동소수점 대비 98% 이상의 MMLU/한국어 언어 이해도 보존.

### 2.2 실측 벤치마크 지연 시간 (Latency) 및 튜닝 결과

| 설정 | Reasoning 토큰 생성 | 응답 생성 토큰 | 실측 응답 지연 시간 (Latency) | 평가 |
|---|---|---|---|---|
| **Thinking Mode ON** | 238 tokens (내부 추론) | 48 tokens | **18.7초 (High Latency)** | 사용자 대화형 챗봇에 부적합 |
| **Thinking Mode OFF** (`enable_thinking: false`) | **0 tokens** | 26 tokens | **0.32초 (Near Real-Time)** | **프로덕션 표준 채택** |

> **핵심 엔지니어링 교훈**: `sglang` 기반 추론 요청 시 요청 Body에 `chat_template_kwargs: { "enable_thinking": false }`를 명시적으로 주입하여 불필요한 Reasoning 토큰 소모를 방지하고 0.3초대 즉각 응답을 실현함.

---

## 3. 전체 시스템 아키텍처 (System Architecture)

```
                       [ 엔터프라이즈 사내 사용자 브라우저 ]
                                       │
                    HTTPS / WebSocket  │  (Tailscale 사설망 / 사내 인트라넷)
                                       ▼
                   ┌───────────────────────────────────────┐
                   │   Next.js 15 App Router Web Service   │
                   │   (React UI + Edge/Node API Routes)   │
                   └───────────────────┬───────────────────┘
                                       │
           ┌───────────────────────────┴───────────────────────────┐
           ▼                                                       ▼
┌─────────────────────────────────────┐         ┌─────────────────────────────────────┐
│       검색 및 지식 계층 (RAG Core)    │         │       추론 및 LLM 계층 (Serving)    │
│                                     │         │                                     │
│  1. RBAC 권한 사전 필터 (Pre-filter) │         │  [On-Premise Mode (Primary)]        │
│     - role: all | hr | eng | fin    │         │   sglang sLLM Serving Node          │
│                                     │         │   Model: Qwen3.8-Flash-NVFP4        │
│  2. BM25 어휘 검색 엔진 (k1=1.2,b=0.75)│         │   BaseURL: http://sllm-...:8000/v1  │
│     - 바이그램 + 어절 하이브리드 토크나이저  │         │                                     │
│                                     │         │  [Cloud BYOK Fallback Mode]         │
│  3. 신뢰도 임계값 검증 (Threshold)    │         │   OpenAI 호환 API Gateway           │
│     - 최고 점수 < 0.35 → LLM 호출 차단 │         │   Model: gpt-4o-mini / Upstage      │
│       ("근거 없음" 즉시 반환)          │         │   Key: 클라이언트 헤더 주입 (미저장)    │
└───────────────────┬─────────────────┘         └──────────────────┬──────────────────┘
                    │                                              │
                    └──────────────────────┬───────────────────────┘
                                           │
                                           ▼
                   ┌───────────────────────────────────────┐
                   │    인용 강제 스트리밍 응답 (SSE Engine)   │
                   │  - [출처: 문서명 §섹션] 엄격 강제       │
                   │  - 실시간 토큰 스트리밍 + 근거 카드 UI  │
                   └───────────────────────────────────────┘
```

---

## 4. 핵심 컴포넌트 상세 설계

### 4.1 모델 서빙 프레임워크 비교 및 선정

| 평가 항목 | **sglang (선정)** | vLLM | Ollama |
|---|---|---|---|
| **RadixAttention (KV 캐싱)** | **지원 (멀티턴/RAG 프롬프트 재사용 최적)** | Chunked Prefill | 미지원 |
| **FP4/NVFP4 양자화 지원** | **우수 (최신 NVIDIA FP4 네이티브)** | 양호 (AWQ/GPTQ 중심) | 보통 (GGUF 중심) |
| **처리량 (Throughput)** | **최고 (vLLM 대비 1.5~2배)** | 높음 | 단일 요청용 (낮음) |
| **OpenAI API 호환성** | 완전 호환 (`/v1/chat/completions`) | 완전 호환 | 호환 (경량화) |
| **적합 분야** | 엔터프라이즈 RAG 고성능 서빙 | 범용 클라우드 서빙 | 로컬 개인 PC 개발 |

### 4.2 임베딩 및 벡터 데이터베이스 확장 경로

현재 1차 프로토타입은 외부 의존성이 전혀 없는 **인메모리 BM25 어휘 검색 엔진(바운더리 토크나이저 결합)**으로 구축되어 즉시 구동 가능하며, 10만 건 이상의 대규모 코퍼스로 확장 시 다음과 같은 2단계 하이브리드 검색 아키텍처로 전환합니다:

1. **임베딩 전용 독립 컨테이너 서빙**:
   - 엔드포인트: `http://embedding-service:8080/v1/embeddings`
   - 모델: `BAAI/bge-m3` (다국어/한국어 고성능 임베딩 모델) 또는 `jhgan/ko-sroberta-multitask`
   - 서빙 엔진: `TEI (Text Embeddings Inference)` 또는 `FastAPI + ONNX Runtime`
2. **벡터 DB (Vector DB)**:
   - 솔루션: `Qdrant` 또는 `pgvector` (PostgreSQL 16)
   - 색인 구조: HNSW (Hierarchical Navigable Small World) + Cosine Distance
   - RBAC 메타데이터 인덱싱: `access_role` 필터 인덱스 구축

3. **LangChain.js 하이브리드 검색 (`EnsembleRetriever`) 결합 설계**:
   - 현재 구현된 `RbacBm25Retriever (BaseRetriever)`와 밀집 벡터 검색 리트리버를 결합하여 Reciprocal Rank Fusion(RRF) 기반 앙상블 리트리버로 손쉽게 확장됩니다:
   ```ts
   // 향후 임베딩 컨테이너(bge-m3, TEI) 연동 시의 하이브리드 확장 구성 청사진
   const dense = new QdrantVectorStore(embeddings, { url, collectionName: 'nexatech' })
     .asRetriever({
       k: 4,
       // RBAC 불변식: 벡터 검색 단계에서도 access_role 메타데이터 사전 필터 강제
       filter: { must: [{ key: 'access_role', match: { any: ['all', role] } }] },
     });

   const hybrid = new EnsembleRetriever({
     retrievers: [new RbacBm25Retriever({ role, k: 4 }), dense],
     weights: [0.4, 0.6], // BM25(0.4) + Dense Vector(0.6) RRF 가중 결합
   });
   ```
   - **핵심 아키텍처 불변식**: 어휘 검색(`RbacBm25Retriever`)의 생성자 선필터와 밀집 검색(`QdrantVectorStore`)의 메타데이터 필터 모두 **유사도 점수 계산 이전에 RBAC 격리를 보장**하므로 비인가 데이터가 LLM 프롬프트에 절대 유입되지 않습니다.

---

## 5. 하드웨어 사이징 및 용량 산정 (Capacity Planning)

사내 동시 접속자 수 및 지식 문서 규모에 따른 인프라 권장 구성입니다.

| 규모 | 동시 접속자 | 코퍼스 규모 | 권장 GPU 사양 | 시스템 메모리 | 스토리지 (SSD) | 예상 RPS / 지연 시간 |
|---|---|---|---|---|---|---|
| **소규모 (100명 미만)** | ~10 동시 사용자 | 500 문서 미만 | **1x NVIDIA RTX 4090 (24GB)** | 64GB DDR5 | 1TB NVMe | ~15 req/s (0.4초) |
| **중규모 (100~1,000명)** | ~50 동시 사용자 | 5,000 문서 | **1x NVIDIA A100 / H100 (80GB)** 또는 **sLLM 전용 고성능 워크스테이션** | 128GB ECC | 2TB NVMe Gen4 | ~60 req/s (0.25초) |
| **엔터프라이즈 (1,000명 이상)** | 200+ 동시 사용자 | 50,000+ 문서 | **2x~4x NVIDIA H100 NVLink** (텐서 병렬화) | 256GB ECC | 4TB Enterprise RAID | 200+ req/s (0.15초) |

---

## 6. 보안 및 컴플라이언스 설계

### 6.1 RBAC (역할 기반 접근 제어) 2단계 방어 체계
1. **1단계 (Retrieval Filter)**: 사용자의 세션 토큰에서 검증된 `role`(`all`, `hr`, `eng`, `finance`)을 기준으로 검색 대상 청크 풀을 사전에 격리.
2. **2단계 (Context Sanitization)**: 권한이 없는 문서는 검색 스코어링 대상에서 제외되므로, LLM의 프롬프트 컨텍스트에 원천적으로 주입되지 않음.

### 6.2 데이터 프라이버시 및 무기록(Zero-Retention) 원칙
- **외부 Egress 완전 차단**: 온프레미스 모드에서는 모든 네트워크 트래픽이 사내 서브넷(또는 Tailscale 사설망) 내에서만 순환하며 외부 공용망 통신 일체 차단.
- **BYOK 보안 원칙**: 클라우드 폴백(BYOK) 모드 시에도 사용자가 입력한 API 키는 브라우저의 `localStorage`에만 보관되며, 서버 측 데이터베이스나 로그에 기록되지 않고 요청 헤더(`x-byok-key`)를 통해 단발성으로 중계됨.
- **PII(개인식별정보) 필터링**: 프롬프트 전송 전 주민등록번호, 계좌번호, 전화번호 정규식 기반 마스킹 필터 적용.

---

## 7. 배포 토폴로지 (Docker Compose 구성안)

온프레미스 단일 서버 상에서 전체 RAG 스택을 1개의 커맨드로 구동하기 위한 `docker-compose.yml` 표준 구성:

```yaml
version: '3.8'

services:
  # 1. LLM 추론 엔진 (sglang)
  llm-serving:
    image: lmsysorg/sglang:latest
    container_name: nexatech-llm
    runtime: nvidia
    environment:
      - CUDA_VISIBLE_DEVICES=0
    volumes:
      - /models/Qwen3.8-Flash-NVFP4:/models/llm
    command: >
      python3 -m sglang.launch_server
      --model-path /models/llm
      --port 8000
      --host 0.0.0.0
      --max-model-len 32768
    ports:
      - "8000:8000"
    restart: always

  # 2. 임베딩 엔진 (TEI)
  embedding-serving:
    image: ghcr.io/huggingface/text-embeddings-inference:cpu-1.5
    container_name: nexatech-embedding
    ports:
      - "8080:80"
    volumes:
      - /models/bge-m3:/data
    command: --model-id /data --port 80
    restart: always

  # 3. 벡터 DB (Qdrant)
  vector-db:
    image: qdrant/qdrant:v1.9.0
    container_name: nexatech-qdrant
    ports:
      - "6333:6333"
    volumes:
      - ./qdrant_storage:/qdrant/storage
    restart: always

  # 4. Next.js RAG 웹 애플리케이션
  rag-web-app:
    build: .
    container_name: nexatech-rag-web
    ports:
      - "3000:3000"
    environment:
      - LLM_BASE_URL=http://llm-serving:8000/v1
      - LLM_MODEL=Inferact/Qwen3.8-Flash-Next-NVFP4
      - EMBEDDING_BASE_URL=http://embedding-serving:80
      - VECTOR_DB_URL=http://vector-db:6333
    depends_on:
      - llm-serving
      - embedding-serving
      - vector-db
    restart: always
```

---

## 8. TCO (총 소유 비용) 및 ROI 경제성 분석

임직원 500명 기업이 매일 1인당 10건(월 100,000건 질의)의 사내 지식 검색을 수행한다고 가정한 3년 TCO 비교 분석입니다.

| 비용 항목 | 상용 클라우드 API (GPT-4o 기준) | 온프레미스 sLLM 전용 서버 구축 |
|---|---|---|
| **초기 도입비 (하드웨어/설치)** | 0원 | 약 1,800만원 (서버 1대 + GPU) |
| **월간 토큰 사용료** | 월 약 180만원 (입출력 1.5억 토큰 기준) | **0원** (자체 추론) |
| **월간 전력 및 상면 비용** | 0원 | 월 약 15만원 (800W 기준) |
| **3년 총 소유 비용 (TCO)** | **약 6,480만원** | **약 2,340만원** |
| **손익분기점 (BEP)** | - | **도입 11개월 차 손익분기 달성 (64% 비용 절감)** |


---

## 9. 운영 및 유지관리 방안 (Operations & Monitoring)

1. **지식 베이스 지속적 업데이트 (CI/CD Ingestion)**:
   - 마크다운 문서 추가/수정 시 Git Hook 또는 CI/CD 파이프라인에서 `pnpm ingest` 스크립트를 자동 트리거하여 `data/index.json`을 무중단 재색인.
2. **모니터링 및 로깅**:
   - Prometheus & Grafana를 통해 sglang의 초당 생성 토큰 수, KV Cache 사용률, 응답 P99 지연 시간 모니터링.
   - 검색 적중률(Retrieval Hit Rate) 및 답변 거부율(Rejection Rate) 지표를 수집하여 지식 베이스 보완 필요 항목 도출.
3. **백업 및 재해 복구(DR)**:
   - 일일 단위로 `data/index.json` 및 원본 코퍼스 Git 커밋 백업.
