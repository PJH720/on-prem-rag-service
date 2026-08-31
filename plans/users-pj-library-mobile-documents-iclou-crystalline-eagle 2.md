# LangChain.js 리팩터 — On-Premise RAG 사내 지식 챗봇

## Context

`on-prem-rag-service`는 이미 완성·배포된 상태다 (`https://on-prem-rag-service.vercel.app`, 마지막 커밋 `ccd1e31`). 현재는 LangChain 의존성 없이 손으로 짠 BM25 + `fetch` 기반 SSE 파싱으로 동작한다. 테스트 7/7 통과, 빌드 성공, RBAC E2E 검증 완료.

**요청:** 이 코드를 LangChain.js(`@langchain/core` + `@langchain/openai`) 네이티브 구조로 재작성한다 — 커스텀 `BaseRetriever`, `ChatOpenAI` 모델 팩토리, LCEL 체인 + 거부 분기.

**정직한 트레이드오프:** 지금 코드는 잘 돌아가고 의존성이 0이다. LangChain을 넣으면 Vercel 서버리스 번들이 무거워지고, 잘 동작하는 코드를 건드리는 리스크가 생긴다. 그럼에도 이 리팩터를 권하는 이유는 **산출물의 논지가 아키텍처이기 때문**이다. `BaseRetriever` / LCEL / `EnsembleRetriever` 업그레이드 경로는 `docs/on-premise-architecture.md`가 주장하는 "BM25 → 하이브리드 검색 마이그레이션"을 *가설*에서 *인터페이스가 이미 준비된 상태*로 바꾼다. 심사 키워드(RAG·신뢰도·보안) 중 RAG 축을 실제로 강화하는 유일한 변경이다. 다만 **아래 Gate 0을 통과하지 못하면 리팩터를 중단**한다.

---

## Gate 0 — 리팩터 전에 반드시 확인 (블로킹)

`ChatOpenAI`가 `modelKwargs`를 요청 body로 실제 전달하는지 **먼저 확인한다.** 전달되지 않으면 온프레미스 경로가 조용히 죽는다(빈 응답). 문서를 믿지 말고 실측한다 — 실패 시그니처는 이미 두 번 재현해 뒀다.

```bash
pnpm add @langchain/core @langchain/openai
```

```ts
// scripts/probe-modelkwargs.ts  — 실행: pnpm tsx scripts/probe-modelkwargs.ts
import { ChatOpenAI } from '@langchain/openai';

const model = new ChatOpenAI({
  model: 'Inferact/Qwen3.8-Flash-Next-NVFP4',
  apiKey: 'not-needed',
  maxTokens: 128,
  temperature: 0.2,
  streamUsage: false,
  configuration: { baseURL: process.env.LLM_BASE_URL! },
  modelKwargs: { chat_template_kwargs: { enable_thinking: false } },
});

const t0 = Date.now();
const res = await model.invoke('연차는 며칠인가요? 한 문장으로 답하세요.');
console.log(`latency=${Date.now() - t0}ms len=${String(res.content).length}`);
console.log(res.content);
```

| 결과 | 판정 |
|---|---|
| 내용 있음, ~3초 이내 | ✅ 전달됨 → 계획대로 진행 |
| `content` 빈 문자열, ~18초, `finish_reason: length` | ❌ 전달 안 됨 → 아래 **비대칭 폴백** |

**비대칭 폴백 (전부 갈아엎지 않는다):** BYOK 경로는 `chat_template_kwargs`가 애초에 필요 없다(OpenAI가 거부함). 따라서 `ChatOpenAI`를 그대로 쓴다. **온프레미스 분기만** 검증 완료된 기존 `createLLMStream`을 감싼 얇은 `SimpleChatModel`로 교체한다. 두 분기가 LCEL 체인에 동일한 인터페이스를 반환하므로 **체인 코드는 바뀌지 않는다.** `getModel()`을 처음부터 이 이음새를 갖도록 설계한다.

---

## 절대 깨면 안 되는 계약 (코드에서 확인한 실측값)

리팩터가 조용히 어긋나면 에러 없이 UI만 망가지는 지점 두 곳:

1. **메타데이터 프레이밍** — `app/page.tsx:226-234`가 `buffer.indexOf('__METADATA__:')`로 찾고 `buffer.indexOf('\n\n')`로 끝을 자른다. 접두사와 `\n\n` 구분자를 바이트 단위로 동일하게 유지할 것. **JSON은 반드시 한 줄**(`JSON.stringify(meta)` — 들여쓰기 인자 금지). 개행이 들어가면 파싱이 깨진다.
2. **인용 태그 하이라이팅** — `app/page.tsx:295-297`이 `/(\[출처:\s*[^\]]+\])/g`로 split하고 `part.startsWith('[출처:')`로 판별한다. 프롬프트를 다시 쓰면서 모델이 `[출처 : ...]`(공백)나 `§` 대신 다른 구분자를 뱉으면 **에러 없이 하이라이팅만 사라진다.** 프롬프트에 정확한 토큰 형식을 못 박고, 검증 단계에서 실제 출력에 정규식을 돌려 확인할 것.

---

## 파일별 구현

### 1. `lib/rbac.ts` (신규) — `all`의 두 가지 의미 분리

현재 코드에서 `role='all'`은 **최소 권한**(일반 직원, `access_role==='all'`만 조회)이고 `access_role='all'`은 **전사 공개**다. 정반대 의미인데 같은 문자열이라 리팩터 중 뒤바꿔도 컴파일러가 못 잡는다. 필터를 생성자로 옮기는 김에 분리한다. 와이어 값은 `all` 그대로 두어 `page.tsx` / `test-search.ts`는 건드리지 않는다.

```ts
/** 질문자의 조회 권한. 'all' = 최소 권한(일반 직원). */
export type ViewerRole = 'all' | 'hr' | 'eng' | 'finance';

/** 문서의 공개 범위. 'all' = 전사 공개. */
export type AccessRole = 'all' | 'hr' | 'eng' | 'finance';

/**
 * RBAC 판정의 유일한 지점. 객체 파라미터라 인자 순서를 바꿔 쓸 수 없다.
 */
export function canView(args: { viewer: ViewerRole; access: AccessRole }): boolean {
  if (args.access === 'all') return true;      // 전사 공개 문서
  return args.viewer === args.access;          // 권한 문서는 정확히 일치할 때만
}
```

기존 동작과 진리표가 동일하다(`viewer='all'` + `access='hr'` → `false`). 두 타입이 구조적으로 같아 컴파일러가 혼용을 강제로 막지는 못한다 — **실질적 보호 장치는 "판정 로직이 이 함수 하나뿐"이라는 사실 + 단위 테스트**다. 이 점을 과장하지 말 것.

### 2. `lib/retriever.ts` (신규) — RBAC 선필터 BM25 리트리버

`@langchain/community`의 `BM25Retriever`를 쓰지 않는 이유 두 가지: (a) 점수를 반환하지 않아 신뢰도 게이트를 만들 수 없다, (b) 검색 전 메타데이터 필터를 지원하지 않아 RBAC를 사후 필터로 밀어내야 한다 — 보안 설계가 뒤집힌다. 덤으로 `@langchain/community`(무거움)를 의존성에서 뺄 수 있다.

```ts
import { BaseRetriever, type BaseRetrieverInput } from '@langchain/core/retrievers';
import { Document } from '@langchain/core/documents';
import { tokenize } from './tokenizer';
import { canView, type ViewerRole, type AccessRole } from './rbac';
import rawIndex from '../data/index.json';

const K1 = 1.2;
const B = 0.75;

export interface ChunkMetadata {
  doc_id: string;
  doc_title: string;
  section_title: string;
  category: string;
  access_role: AccessRole;
  owner: string;
  file_name: string;
}

/** index.json의 한 항목. terms/length는 BM25 통계이며 LLM 컨텍스트로는 나가지 않는다. */
interface IndexedDoc {
  id: string;
  pageContent: string;
  metadata: ChunkMetadata;
  terms: Record<string, number>;
  length: number;
}

interface SerializedIndex {
  avgdl: number;
  idf: Record<string, number>;
  documents: IndexedDoc[];
}

const INDEX = rawIndex as unknown as SerializedIndex;

export interface RetrievedMetadata extends ChunkMetadata {
  score: number;
  normalizedScore: number;
  matchedTerms: string[];
}

/** Document.metadata를 타입 안전하게 읽는다. */
export function readMeta(doc: Document): RetrievedMetadata {
  return doc.metadata as RetrievedMetadata;
}

export interface RbacBm25RetrieverInput extends BaseRetrieverInput {
  role: ViewerRole;
  k?: number;
}

export class RbacBm25Retriever extends BaseRetriever {
  static lc_name() {
    return 'RbacBm25Retriever';
  }

  lc_namespace = ['nexatech', 'retrievers', 'rbac_bm25'];

  readonly role: ViewerRole;
  readonly k: number;

  /**
   * 보안 핵심: RBAC를 생성자에서 적용한다.
   * 권한 없는 청크는 이 인스턴스에서 도달 자체가 불가능하므로,
   * _getRelevantDocuments에 어떤 버그가 있어도 유출될 수 없다.
   */
  private readonly permitted: readonly IndexedDoc[];

  constructor(fields: RbacBm25RetrieverInput) {
    super(fields);
    this.role = fields.role;
    this.k = fields.k ?? 4;
    this.permitted = INDEX.documents.filter((d) =>
      canView({ viewer: fields.role, access: d.metadata.access_role })
    );
  }

  async _getRelevantDocuments(query: string): Promise<Document[]> {
    const queryTerms = tokenize(query);
    if (queryTerms.length === 0) return [];

    const scored: Array<{ doc: IndexedDoc; score: number; matched: string[] }> = [];

    for (const doc of this.permitted) {
      let score = 0;
      const matched = new Set<string>();

      for (const term of queryTerms) {
        const tf = doc.terms[term] ?? 0;
        if (tf === 0) continue;
        matched.add(term);
        const idf = INDEX.idf[term] ?? 0.1;
        const norm = 1 - B + B * (doc.length / INDEX.avgdl);
        score += idf * ((tf * (K1 + 1)) / (tf + K1 * norm));
      }

      if (score > 0) scored.push({ doc, score, matched: [...matched] });
    }

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, this.k).map(
      ({ doc, score, matched }) =>
        new Document({
          id: doc.id,
          pageContent: doc.pageContent,
          metadata: {
            ...doc.metadata,
            score,
            normalizedScore: Math.round((score / (score + 10)) * 100) / 100,
            matchedTerms: matched,
          } satisfies RetrievedMetadata,
        })
    );
  }
}

// ---------------------------------------------------------------------------
// 신뢰도 게이트 — LLM 호출 전에 판정한다.
// ---------------------------------------------------------------------------

/** .env.example에 이미 선언돼 있으나 지금까지 코드에 연결되지 않았던 값을 여기서 연결한다. */
const MIN_SCORE = Number(process.env.RAG_REJECTION_THRESHOLD ?? 10);
const MIN_SHALLOW_SCORE = Number(process.env.RAG_SHALLOW_SCORE ?? 18);

export type GateReason = 'ok' | 'no_results' | 'below_threshold' | 'shallow_match';

export interface GroundingGate {
  grounded: boolean;
  topScore: number;
  reason: GateReason;
}

export function evaluateGrounding(docs: Document[]): GroundingGate {
  if (docs.length === 0) return { grounded: false, topScore: 0, reason: 'no_results' };

  const top = readMeta(docs[0]);

  if (top.score < MIN_SCORE) {
    return { grounded: false, topScore: top.score, reason: 'below_threshold' };
  }
  // 단일 어휘만 스친 얕은 매칭은 근거로 보지 않는다.
  if (top.matchedTerms.length < 2 && top.score < MIN_SHALLOW_SCORE) {
    return { grounded: false, topScore: top.score, reason: 'shallow_match' };
  }
  return { grounded: true, topScore: top.score, reason: 'ok' };
}
```

### 3. `lib/llm.ts` (재작성) — 통합 모델 팩토리

```ts
import { ChatOpenAI } from '@langchain/openai';

export type Provider = 'on-premise' | 'byok';

export interface GetModelOptions {
  isLocal: boolean;
  /** BYOK 모드에서만 사용. 절대 서버에 저장하거나 로깅하지 않는다. */
  apiKey?: string;
  customBaseUrl?: string;
}

/**
 * 검증된 온프레미스 필수 파라미터.
 * 누락하면 Qwen3가 reasoning 토큰만 태우고 content를 빈 문자열로 반환한다.
 */
const ONPREM_MODEL_KWARGS = { chat_template_kwargs: { enable_thinking: false } };

export function resolveProvider(byokKey?: string): Provider {
  return byokKey && byokKey.trim().length > 0 ? 'byok' : 'on-premise';
}

export function getModel({ isLocal, apiKey, customBaseUrl }: GetModelOptions): ChatOpenAI {
  if (isLocal) {
    return new ChatOpenAI({
      model: process.env.LLM_MODEL || 'Inferact/Qwen3.8-Flash-Next-NVFP4',
      // sglang은 인증이 없지만 OpenAI SDK가 비어 있지 않은 키를 요구한다.
      apiKey: process.env.LLM_API_KEY || 'not-needed',
      temperature: 0.2,
      maxTokens: 1024,
      streaming: true,
      // sglang은 stream_options를 지원하지 않을 수 있다. 켜두면 400으로 죽는다.
      streamUsage: false,
      configuration: {
        baseURL: customBaseUrl || process.env.LLM_BASE_URL || 'http://spark-node.internal:8000/v1',
      },
      modelKwargs: ONPREM_MODEL_KWARGS,
    });
  }

  if (!apiKey) throw new Error('BYOK mode requires a user-supplied API key');

  return new ChatOpenAI({
    model: process.env.BYOK_MODEL || 'gpt-4o-mini',
    apiKey,
    temperature: 0.2,
    maxTokens: 1024,
    streaming: true,
    configuration: {
      baseURL: customBaseUrl || process.env.BYOK_BASE_URL || 'https://api.openai.com/v1',
    },
  });
}
```

> Gate 0이 실패하면: 이 파일의 `if (isLocal)` 분기만 `SimpleChatModel` 래퍼를 반환하도록 바꾼다. BYOK 분기와 호출부는 그대로.

### 4. `lib/prompt.ts` (신규) — 인용 강제 프롬프트 + XML 컨텍스트

**LangChain 함정:** `ChatPromptTemplate`은 기본이 f-string 템플릿이라 리터럴 `{`/`}`를 변수로 착각한다. 한국어 문서 본문에 중괄호가 있어도 **변수 *값*은 재템플릿되지 않으므로 안전**하다 — 컨텍스트를 문자열로 인라인하지 말고 반드시 `{context}` 변수로 주입할 것.

```ts
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import type { Document } from '@langchain/core/documents';
import { readMeta } from './retriever';

function escapeXmlAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function formatDocsAsXml(docs: Document[]): string {
  return docs
    .map((doc, i) => {
      const m = readMeta(doc);
      const attrs = [
        `id="${escapeXmlAttr(m.doc_id)}"`,
        `title="${escapeXmlAttr(m.doc_title)}"`,
        `section="${escapeXmlAttr(m.section_title)}"`,
        `access="${m.access_role}"`,
        `rank="${i + 1}"`,
      ].join(' ');
      return `  <doc ${attrs}>\n${doc.pageContent}\n  </doc>`;
    })
    .join('\n');
}

// 리터럴 중괄호 없음 — {role}, {context}, {question}만 변수다.
const SYSTEM_TEMPLATE = `당신은 넥사테크(NexaTech) 사내 온보딩 지식 챗봇입니다.
현재 질문자의 조회 권한(Role)은 [{role}]입니다.

아래 <context> 안의 사내 문서 근거에만 기반하여 한국어로 정확하게 답변하십시오.

[필수 답변 원칙]
1. <context>에 있는 사실만 사용하십시오. 없는 내용은 추측하여 지어내지 마십시오.
2. 모든 사실 진술 끝에 반드시 다음 형식으로 인용을 붙이십시오:
   [출처: 문서명 §섹션명]
   - 대괄호로 감싸고, "출처:" 뒤에 한 칸 띄우고, 문서명, 한 칸, "§", 섹션명 순서입니다.
   - 예시: [출처: 연차 및 휴가 규정 §연차 유급휴가 발생 기준]
   - 이 형식을 정확히 지키십시오. 다른 구분자나 여분의 공백을 쓰지 마십시오.
3. 문서명과 섹션명은 <doc> 태그의 title/section 속성 값을 그대로 사용하십시오.
4. 근거가 부족하면 모른다고 답하고 담당 부서 문의를 안내하십시오.

<context>
{context}
</context>`;

export const answerPrompt = ChatPromptTemplate.fromMessages([
  ['system', SYSTEM_TEMPLATE],
  new MessagesPlaceholder('history'),
  ['human', '{question}'],
]);
```

### 5. `app/api/chat/route.ts` (재작성) — LCEL 체인 + 거부 분기

설계상 중요한 두 가지:

- **검색은 체인 밖에서 한 번만 await한다.** 응답 헤더와 `__METADATA__`에 sources가 필요하므로 스트림 시작 전에 결과가 손에 있어야 한다. 체인 안에 넣으면 중복 검색이거나 헤더를 못 채운다. (요청서의 "helper composition" 허용 범위)
- **첫 토큰을 미리 당겨본 뒤에 메타데이터를 내보낸다.** `chain.stream()`은 즉시 반환되고 실제 연결 오류는 첫 순회에서 터진다. 메타데이터를 먼저 보내면 `provider: "on-premise"` 배지를 띄운 채 search-only 답변이 나가는 불일치가 생긴다.

```ts
import { NextRequest } from 'next/server';
import { RunnableBranch, RunnableLambda, RunnableSequence } from '@langchain/core/runnables';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages';
import type { Document } from '@langchain/core/documents';
import type { ChatOpenAI } from '@langchain/openai';

import { RbacBm25Retriever, evaluateGrounding, readMeta, type GroundingGate } from '@/lib/retriever';
import { getModel, resolveProvider } from '@/lib/llm';
import { answerPrompt, formatDocsAsXml } from '@/lib/prompt';
import type { ViewerRole } from '@/lib/rbac';
import type { ChatMessage } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const REFUSAL_TEXT =
  '사내 규정 및 온보딩 문서에서 관련된 근거를 찾지 못했습니다.\n\n' +
  '해당 정보는 사내 지식 베이스에 등록되어 있지 않거나 현재 열람 권한 범위 밖입니다. ' +
  '보다 상세한 안내는 담당 부서(피플팀 `people@nexatech.ai` 또는 IT지원팀 `it-support@nexatech.ai`)로 문의해 주시기 바랍니다.';

interface ChainInput {
  question: string;
  role: ViewerRole;
  docs: Document[];
  history: BaseMessage[];
  grounded: boolean;
}

/** 근거 부족 시 LLM을 호출하지 않고 즉시 거부로 분기한다. */
function buildChain(model: ChatOpenAI) {
  return RunnableBranch.from([
    [(input: ChainInput) => !input.grounded, RunnableLambda.from(() => REFUSAL_TEXT)],
    RunnableSequence.from([
      RunnableLambda.from((input: ChainInput) => ({
        role: input.role,
        question: input.question,
        history: input.history,
        context: formatDocsAsXml(input.docs),
      })),
      answerPrompt,
      model,
      new StringOutputParser(),
    ]),
  ]);
}

function toLangChainHistory(history: ChatMessage[]): BaseMessage[] {
  return history
    .slice(-4)
    .map((m) => (m.role === 'assistant' ? new AIMessage(m.content) : new HumanMessage(m.content)));
}

function toSources(docs: Document[]) {
  return docs.map((d) => {
    const m = readMeta(d);
    return {
      doc_id: m.doc_id,
      doc_title: m.doc_title,
      section_title: m.section_title,
      score: m.score,
      normalizedScore: m.normalizedScore,
      snippet: d.pageContent.slice(0, 250) + (d.pageContent.length > 250 ? '...' : ''),
      access_role: m.access_role,
    };
  });
}

/** 헤더에는 ASCII 스칼라만 넣는다 — 한국어 문서명은 헤더 값으로 들어갈 수 없다. */
function buildHeaders(confidence: string, provider: string, gate: GroundingGate, docs: Document[]) {
  return new Headers({
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
    'x-rag-confidence': confidence,
    'x-rag-provider': provider,
    'x-rag-top-score': gate.topScore.toFixed(2),
    'x-rag-gate-reason': gate.reason,
    'x-rag-doc-ids': docs.map((d) => readMeta(d).doc_id).join(','),
  });
}

/** JSON은 반드시 한 줄. 개행이 들어가면 page.tsx의 \n\n 종결 파싱이 깨진다. */
function metadataFrame(meta: Record<string, unknown>): string {
  return `__METADATA__:${JSON.stringify(meta)}\n\n`;
}

function staticStream(meta: Record<string, unknown>, text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(metadataFrame(meta)));
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, role = 'all', history = [] } = body as {
      message: string;
      role: ViewerRole;
      history?: ChatMessage[];
    };

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return new Response(JSON.stringify({ error: 'Message is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const byokKey = req.headers.get('x-byok-key') || undefined;
    const provider = resolveProvider(byokKey);

    // 1. RBAC 선필터 + BM25 검색 (체인 밖에서 1회)
    const retriever = new RbacBm25Retriever({ role, k: 4 });
    const docs = await retriever.invoke(message);
    const gate = evaluateGrounding(docs);
    const sources = toSources(docs);

    // 2. 신뢰도 게이트 — LLM 호출 없이 거부
    if (!gate.grounded) {
      const meta = { confidence: 'rejected', provider, role, sources, rejected: true, gate: gate.reason };
      return new Response(staticStream(meta, REFUSAL_TEXT), {
        headers: buildHeaders('rejected', provider, gate, docs),
      });
    }

    const model = getModel({ isLocal: provider === 'on-premise', apiKey: byokKey });
    const chain = buildChain(model);

    const lcStream = await chain.stream({
      question: message,
      role,
      docs,
      history: toLangChainHistory(Array.isArray(history) ? history : []),
      grounded: true,
    });

    // 3. 첫 토큰을 먼저 당겨 연결 실패를 확정한다 (메타데이터 송출 전에).
    const iterator = lcStream[Symbol.asyncIterator]();
    let first: IteratorResult<string>;
    try {
      first = await iterator.next();
    } catch (llmErr) {
      console.warn('[chat] LLM unreachable, falling back to search-only:', llmErr);
      const meta = {
        confidence: 'high',
        provider: 'search-only',
        model: 'BM25 Extractive Search Engine',
        role,
        sources,
        rejected: false,
      };
      return new Response(staticStream(meta, buildSearchOnlyAnswer(role, docs)), {
        headers: buildHeaders('high', 'search-only', gate, docs),
      });
    }

    const meta = {
      confidence: 'high',
      provider,
      model: model.model,
      role,
      sources,
      rejected: false,
    };

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode(metadataFrame(meta)));
        if (!first.done && first.value) controller.enqueue(encoder.encode(first.value));
        try {
          for (;;) {
            const next = await iterator.next();
            if (next.done) break;
            if (next.value) controller.enqueue(encoder.encode(next.value));
          }
        } catch (err) {
          // 스트림 중간 실패는 되돌릴 수 없다(메타데이터가 이미 나갔다). 안내 문구로 마감한다.
          console.error('[chat] stream interrupted:', err);
          controller.enqueue(encoder.encode('\n\n(응답이 중단되었습니다. 다시 시도해 주세요.)'));
        }
        controller.close();
      },
      cancel() {
        void iterator.return?.();
      },
    });

    return new Response(stream, { headers: buildHeaders('high', provider, gate, docs) });
  } catch (error: unknown) {
    console.error('Chat API Error:', error);
    const errMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return new Response(JSON.stringify({ error: errMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
```

`buildSearchOnlyAnswer(role, docs)`는 기존 `route.ts:162-169`의 추출 요약 로직을 그대로 옮긴다 — 인용 형식(`[출처: ... §...]`)을 반드시 유지할 것(하이라이팅 계약).

### 6. `scripts/ingest.ts` (수정) — LangChain Document 직렬화

출력 스키마만 바꾼다. 청킹·토크나이징·IDF 계산 로직은 손대지 않는다.

```ts
// 기존 Chunk 객체 생성부를 이 형태로 교체 (섹션 청크 / 폴백 청크 두 곳)
const doc = {
  id: `chunk_${String(++chunkIndex).padStart(3, '0')}`,
  pageContent: sectionBody,
  metadata: {
    doc_id: frontmatter.doc_id,
    doc_title: frontmatter.title,
    section_title: sectionTitle,
    category: frontmatter.category || '기타',
    access_role: frontmatter.access_role,
    owner: frontmatter.owner || '사내',
    file_name: fileName,
  },
  terms,             // BM25 통계 — metadata 밖에 둔다 (LLM 컨텍스트로 새지 않게)
  length: tokens.length,
};
documents.push(doc);
```

출력 파일:

```jsonc
{
  "version": "2.0.0",
  "updated_at": "2026-08-31T06:00:00.000Z",   // ISO-8601, 기존과 동일
  "total_docs": 26,
  "avgdl": 177.2,
  "df":  { "연차": 3 },
  "idf": { "연차": 1.87 },
  "documents": [ /* 위 형태 */ ]
}
```

`lib/types.ts`의 `Chunk` / `BM25Index` / `ScoredChunk`는 `lib/retriever.ts`의 타입으로 대체되므로 제거한다. `ChatMessage`는 유지(`page.tsx`가 쓴다).

---

## `EnsembleRetriever` 확장 청사진 (`docs/on-premise-architecture.md`용)

**아래는 설계 예시이며 실행 코드가 아니다.** LangChain.js가 최근 패키지를 재편해 레거시 표면이 `@langchain/classic/*`로 이동했다 — `EnsembleRetriever`의 정확한 임포트 경로는 실제 설치 시점에 확인이 필요하다. 확신 없는 임포트를 아키텍처 문서에 박아두는 것보다 이 단서를 남기는 편이 낫다.

리팩터의 실질적 이득은 여기다. 지금 구조에서 밀집 검색으로 가는 데 필요한 변경이 **리트리버 교체 한 줄**로 줄어든다 — `route.ts`, 프롬프트, 게이트, UI는 전부 그대로다.

```ts
// 임베딩 컨테이너(bge-m3, TEI)가 붙은 뒤의 목표 구성 — 예시
const dense = new QdrantVectorStore(embeddings, { url, collectionName: 'nexatech' })
  .asRetriever({
    k: 4,
    // RBAC를 벡터 DB 메타데이터 필터로 강제 — 어휘 검색과 동일한 불변식
    filter: { must: [{ key: 'access_role', match: { any: ['all', role] } }] },
  });

const hybrid = new EnsembleRetriever({
  retrievers: [new RbacBm25Retriever({ role, k: 4 }), dense],
  weights: [0.4, 0.6],   // RRF 기반 결합
});
```

핵심 논지: **RBAC 불변식이 두 검색 경로에서 동일하게 유지된다.** 어휘 쪽은 생성자 선필터, 밀집 쪽은 벡터 DB 메타데이터 필터 — 둘 다 점수 계산 이전이다.

---

## 의존성 및 배포

```bash
pnpm add @langchain/core @langchain/openai
```

`@langchain/community`는 넣지 않는다(커스텀 리트리버로 불필요, 번들만 무거워짐).

> ⚠️ **직전 배포 실패 재발 방지:** Vercel은 `--frozen-lockfile`로 설치한다. `pnpm add` 후 **`package.json`과 `pnpm-lock.yaml`을 반드시 같이 커밋**할 것. 지난번 배포가 정확히 이 불일치(`next` 15.2.0 vs 16.3.3)로 깨졌다.

---

## 검증

Gate 0 통과 후, 순서대로:

1. **RBAC 단위** — `canView({viewer:'all',access:'hr'})===false`, `canView({viewer:'hr',access:'all'})===true`
2. **리트리버 격리** — `new RbacBm25Retriever({role:'all'})`의 `permitted`에 `HR-011`이 **없음**을 확인. `role:'hr'`에서는 있음.
3. **회귀** — `pnpm test:search` 7/7 유지 (리트리버 호출로 교체하되 기대 doc_id는 그대로)
4. **게이트** — "오늘 점심 메뉴 뭐야?" → `grounded:false`, 네트워크 탭에서 LLM 호출 0건
5. **온프레미스 생성** — 로컬 `LLM_BASE_URL` 설정 후 질의 → 한국어 답변 스트리밍, `reasoning_content` 누출 없음
6. **인용 계약** — 5번 출력에 `/(\[출처:\s*[^\]]+\])/g`를 실제로 돌려 1건 이상 매칭 확인 ← 조용히 깨지는 지점
7. **메타데이터 계약** — `curl -N`으로 첫 청크가 `__METADATA__:{...}\n\n` 한 줄인지, UI 근거 패널이 뜨는지 확인
8. **빌드·배포** — `pnpm build` → `vercel --prod` → 프로덕션에서 예시 질문 3개 + 역할 전환

---

## 인접 발견 (이번 스코프 밖, 기록만)

- **`finance` 역할이 죽어 있다.** 코퍼스 8개 중 `access_role: finance`가 0개다 — `FIN-001`(경비/법인카드 규정)이 `all`로 되어 있다. 따라서 UI에서 재무팀을 골라도 전사 권한과 동작이 완전히 동일하다. `ingest.ts`를 어차피 건드리므로 frontmatter 한 줄로 고칠 수 있다. 단, "법인카드 식대 정산" 예시 질문이 전사 권한에서 거부되므로 예시 칩도 함께 조정해야 한다.
- **거부 임계값이 문구에 취약하다.** 프로덕션 실측: "연차는 **입사 후** 언제부터 쓸 수 있나요?" → 12.06(통과), "연차는 언제부터 쓸 수 있나요?" → 6.0(거부). BM25 원점수는 매칭된 질의어 **개수**에 비례하므로 같은 의미라도 짧게 물으면 점수가 떨어진다. 임계값 숫자를 바꾸기보다 **질의 길이로 정규화**하는 편이 원리적으로 옳다. 다만 지금 손으로 숫자를 고르면 도메인 밖 질의까지 통과시킬 위험이 있으므로, 라벨링된 질의 세트로 점수를 찍어보고 정해야 한다 — `scripts/test-search.ts`를 확장하면 된다.
- `data/corpus/*.md`와 `docs/onboarding/*.md` 8개 파일이 바이트 단위로 동일한 중복이다.
