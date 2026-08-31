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

function buildSearchOnlyAnswer(role: ViewerRole, docs: Document[]): string {
  if (docs.length === 0) return REFUSAL_TEXT;
  const top = readMeta(docs[0]);
  const topContent = docs[0].pageContent;

  return (
    `### 🔍 사내 지식 검색 결과 (검색 전용 모드)\n\n` +
    `**[${role.toUpperCase()} 권한]** 사내 규정 검색을 통해 관련 핵심 문서를 찾았습니다. (우측 상단 'BYOK 키 설정' 시 LLM 대화형 스트리밍으로 전환됩니다.)\n\n` +
    `**📌 관련 핵심 규정**: [출처: ${top.doc_title} §${top.section_title}]\n\n` +
    `${topContent}\n\n` +
    (docs.length > 1
      ? `\n---\n**추가 연관 섹션**: [출처: ${readMeta(docs[1]).doc_title} §${readMeta(docs[1]).section_title}]\n${docs[1].pageContent.slice(0, 180)}...\n`
      : '')
  );
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

    // 2. 신뢰도 게이트 — LLM 호출 없이 즉시 거부
    if (!gate.grounded) {
      const meta = {
        confidence: 'rejected',
        provider,
        role,
        sources,
        rejected: true,
        gate: gate.reason,
      };
      return new Response(staticStream(meta, REFUSAL_TEXT), {
        headers: buildHeaders('rejected', provider, gate, docs),
      });
    }

    const model = getModel({ isLocal: provider === 'on-premise', apiKey: byokKey });
    const chain = buildChain(model);

    // 3. 첫 토큰을 먼저 당겨 연결 실패를 확정한다 (메타데이터 송출 전에).
    let iterator: AsyncIterator<string>;
    let first: IteratorResult<string>;
    try {
      const lcStream = await chain.stream({
        question: message,
        role,
        docs,
        history: toLangChainHistory(Array.isArray(history) ? history : []),
        grounded: true,
      });
      iterator = lcStream[Symbol.asyncIterator]();
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
