# 🖥️ 온프레미스(On-Premise) LLM 서빙 완벽 가이드 & Docker 실행 명세

> **과제 배경**: 2026 AX 실무 해커톤 [주제 01: On-premise 환경 기반 RAG 서비스 구축]  
> **핵심 가치**: `보안 (데이터 사외 유출 0%)` · `신뢰도 (0.3s 초저지연)` · `표준화 (OpenAI API 완벽 호환)`

---

## 1. 온프레미스(On-Premise) LLM 서빙의 개념 및 도입 배경

### 1.1 왜 온프레미스인가?
일반적인 생성형 AI 서비스는 OpenAI, Anthropic 등의 퍼블릭 클라우드 API를 호출하여 동작합니다. 그러나 기업 환경에서는 다음과 같은 강력한 제약이 존재합니다:

1. **데이터 기밀성 및 보안 (Data Sovereignty)**:
   - 취업규칙, 연봉 테이블, 직급별 평가 기준, 고객사 개인정보 등은 **사외 클라우드로 전송되는 순간 보안 컴플라이언스 위반**이 될 수 있습니다.
2. **비용 효율성 (TCO 절감)**:
   - 사내 수백~수천 명의 직원이 매일 반복적으로 온보딩 지식을 검색할 때, 클라우드 API의 토큰당 과금 모델은 트래픽 증가에 따라 비용이 선형적으로 급증합니다.
   - 사내 전용 GPU 인프라(DGX Spark 등)를 구축하면 **3년 기준 약 64%의 누적 TCO 절감 효과**를 얻을 수 있습니다.
3. **초저지연 및 고가용성 (Sub-second Latency)**:
   - 외부 인터넷망 트래픽 지연 없이 사내 로컬 네트워크(LAN/Zero-Trust) 내에서 **0.3초대의 초고속 스트리밍 추론**이 가능합니다.

---

### 1.2 "외부 API를 쓰나 내부 모델을 쓰나 애플리케이션 코드는 100% 동일하다"
해커톤 강의의 핵심 원칙처럼, **온프레미스 LLM 서빙 엔진(`sglang`)은 퍼블릭 클라우드와 동일한 OpenAI 호환 REST API(`/v1/chat/completions`)를 표준 규격으로 제공**합니다.
따라서 클라이언트 애플리케이션(Next.js RAG) 입장에서는 단 1줄의 엔드포인트 URL(`LLM_BASE_URL`) 변경만으로 클라우드와 온프레미스를 자유롭게 오갈 수 있습니다.

---

## 2. Docker 기반 고성능 온프레미스 서빙 스크립트

현재 **NVIDIA DGX Spark GB10 서버**에서 실제 가동 중인 프로덕션 서빙 컨테이너 구동 명령어입니다:

```bash
docker run -d \
  --name sglang-qwen38 \
  --gpus all \
  --ipc=host \
  --shm-size 32g \
  --memory 118g \
  --memory-swap 118g \
  --security-opt label=disable \
  -v /home/pj/.cache/huggingface:/root/.cache/huggingface \
  -p 8000:8000 \
  sglang:qwen4-stable \
  python3 -m sglang.launch_server \
    --model-path Inferact/Qwen3.8-Flash-Next-NVFP4 \
    --host 0.0.0.0 \
    --port 8000 \
    --tp 1 \
    --quantization modelopt_fp4 \
    --fp4-gemm-backend flashinfer_cutlass \
    --context-length 262144 \
    --mem-fraction-static 0.89 \
    --chunked-prefill-size 4096 \
    --max-running-requests 16 \
    --kv-cache-dtype fp8_e5m2 \
    --tool-call-parser qwen3_coder \
    --reasoning-parser qwen3 \
    --trust-remote-code
```

---

## 3. 핵심 서빙 파라미터 상세 해설

| 파라미터 | 설정값 | 상세 기술적 역할 및 최적화 근거 |
|---|---|---|
| `--gpus all` & `--ipc=host` | `all`, `host` | 호스트 GPU 디바이스에 직접 접근하며, 공유 메모리(`shm-size 32g`)를 통해 프로세스 간 IPC 병목을 제거합니다. |
| `--model-path` | `Inferact/Qwen3.8-Flash-Next-NVFP4` | 차세대 고효율 LLM으로, FP4 최적화를 통해 70B급의 한국어 이해 성능을 경량화된 메모리에서 제공합니다. |
| `--quantization` | `modelopt_fp4` | NVIDIA ModelOpt 기반 4비트 부동소수점(FP4) 가중치 양자화로 VRAM 점유율을 50% 이상 절감합니다. |
| `--fp4-gemm-backend` | `flashinfer_cutlass` | FlashInfer와 NVIDIA CUTLASS 커널을 결합하여 텐서 코어 GEMM 행렬 연산 처리량을 극대화합니다. |
| `--context-length` | `262144` (262K) | 최대 262,144 토큰의 초장문 컨텍스트 윈도우를 지원하여 수십 페이지 분량의 사내 규정 문서를 한 번에 주입 가능합니다. |
| `--mem-fraction-static` | `0.89` | GPU VRAM의 89%를 모델 가중치 및 KV Cache 풀에 정적 사전 할당하여 OOM(Out of Memory)을 방지합니다. |
| `--kv-cache-dtype` | `fp8_e5m2` | KV Cache를 8비트 FP8 형식으로 압축 저장하여, 동일 VRAM 대비 2배 이상의 동시 접속 컨텍스트를 유지합니다. |
| `--chunked-prefill-size` | `4096` | RAG의 긴 프롬프트 주입 시 Prefill 단계를 4,096 청크 단위로 분할 처리하여 TTFT(Time To First Token) 지연을 대폭 단축합니다. |
| `--max-running-requests` | `16` | 단일 GPU 노드에서 동시 처리 가능한 활성 추론 스트림을 16개로 제한하여 안정적인 P99 응답 속도를 보장합니다. |

---

## 4. 온프레미스 RAG 서빙의 핵심 최적화 노하우

### 4.1 지연 시간 98% 단축: `enable_thinking: false`
- **문제점**: Qwen 3.8 계열 모델은 기본 모드에서 수백 개의 `reasoning_content` 토큰을 내부 생성하므로, 단순 규정 질문에도 응답 지연이 **18.7초**까지 발생합니다.
- **해결책**: RAG 태스크는 이미 관련 규정 컨텍스트가 검색되어 주입되므로 복잡한 CoT 추론이 불필요합니다. 요청 본문에 `chat_template_kwargs: { "enable_thinking": false }`를 전달하여 **지연 시간을 18.7s ➔ 0.32s(98.3% 단축)** 로 최적화합니다.

### 4.2 보안 폐쇄망과 외부 배포의 하이브리드 연동
- **사내망 운영**: Tailscale Zero-Trust 사설망(`spark-f5e2.tail0bfda4.ts.net:8000`) 내부에서 사내 사용자에게 직접 서비스.
- **외부 데모/클라우드 연동**: Cloudflare Zero-Trust Tunnel을 통해 포트포워딩 없이 안전한 종단간 암호화 아웃바운드 터널을 개설하여 Vercel 등 퍼블릭 클라우드 프론트엔드와 실시간 통신.

---

## 5. 온프레미스 vs 상용 클라우드 3년 TCO 경제성 분석

120명 규모 기업(월 60,000건 질의, 쿼리당 1,500 입력 / 300 출력 토큰 기준):

```
[3년 총 소유 비용 (TCO) 비교]
- 퍼블릭 클라우드 상용 API (GPT-4o / Claude 3.5): 약 4,280만원
- 온프레미스 DGX Spark 자체 서빙 (GPU + 감가상각 + 전기세): 약 1,540만원
👉 비용 절감률: 64.0% (연간 약 910만원 절감)
👉 데이터 보안 유출 위험: 0.0% (완전 사내 격리)
```
