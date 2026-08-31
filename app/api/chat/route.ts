import { NextRequest } from 'next/server';
import { searchChunks, hasSufficientGrounding } from '@/lib/search';
import { createLLMStream, getLLMConfig } from '@/lib/llm';
import { ChatMessage, Role } from '@/lib/types';

// Vercel Serverless Function Configuration
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, role = 'all', history = [] } = body as {
      message: string;
      role: Role;
      history?: ChatMessage[];
    };

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return new Response(JSON.stringify({ error: 'Message is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const byokKey = req.headers.get('x-byok-key') || undefined;
    const llmConfig = getLLMConfig(byokKey);

    // 1. RBAC Pre-Filter + BM25 Search
    const searchResults = searchChunks(message, role, 4);
    const isGrounded = hasSufficientGrounding(searchResults, message);

    const sources = searchResults.map(r => ({
      doc_id: r.chunk.doc_id,
      doc_title: r.chunk.doc_title,
      section_title: r.chunk.section_title,
      score: r.score,
      normalizedScore: r.normalizedScore,
      snippet: r.chunk.content.slice(0, 250) + (r.chunk.content.length > 250 ? '...' : ''),
      access_role: r.chunk.access_role,
    }));

    const encoder = new TextEncoder();

    // 2. Rejection Logic: When confidence is insufficient, reject immediately
    if (!isGrounded || searchResults.length === 0) {
      const rejectionMeta = JSON.stringify({
        confidence: 'rejected',
        provider: byokKey ? 'byok' : 'on-premise',
        model: llmConfig.model,
        role,
        sources,
        rejected: true,
      });

      const rejectionText =
        '사내 규정 및 온보딩 문서에서 관련된 근거를 찾지 못했습니다.\n\n' +
        '해당 정보는 사내 지식 베이스에 등록되어 있지 않거나 현재 열람 권한 범위 밖입니다. ' +
        '보다 상세한 안내는 담당 부서(피플팀 `people@nexatech.ai` 또는 IT지원팀 `it-support@nexatech.ai`)로 문의해 주시기 바랍니다.';

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`__METADATA__:${rejectionMeta}\n\n`));
          controller.enqueue(encoder.encode(rejectionText));
          controller.close();
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      });
    }

    // 3. Prepare Context for Generation
    const topDoc = searchResults[0];
    const contextText = searchResults
      .map((r, i) => {
        return `[근거 ${i + 1}] 문서: ${r.chunk.doc_title} (ID: ${r.chunk.doc_id}) § ${r.chunk.section_title}\n권한: ${r.chunk.access_role}\n내용:\n${r.chunk.content}`;
      })
      .join('\n\n---\n\n');

    const systemPrompt = `당신은 넥사테크(NexaTech) 사내 온보딩 지식 챗봇입니다.
현재 질문자의 조회 권한(Role)은 [${role}]입니다.
반드시 아래 제공된 [사내 문서 근거]에만 기반하여 질문에 친절하고 정확하게 한국어로 답변하십시오.

[필수 답변 원칙]
1. 반드시 아래 제공된 문서의 사실만을 바탕으로 답변하십시오.
2. 모든 문장이나 사실 진술 끝에는 반드시 \`[출처: 문서명 §섹션명]\` 형식으로 인용 태그를 명시하십시오. (예: [출처: 연차 및 휴가 규정 §연차 유급휴가 발생 기준])
3. 제공된 문서에 없는 내용은 추측하여 지어내지 말고 모른다고 답하십시오.

[사내 문서 근거]
${contextText}`;

    const llmMessages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...(Array.isArray(history) ? history.slice(-4) : []),
      { role: 'user', content: message },
    ];

    // Try calling LLM stream; if endpoint is unreachable (e.g. Vercel without local Tailscale), fallback to Search-Only synthesis
    try {
      const llmStream = await createLLMStream(llmMessages, byokKey);
      const reader = llmStream.getReader();

      const metadataHeader = JSON.stringify({
        confidence: 'high',
        provider: llmConfig.provider,
        model: llmConfig.model,
        role,
        sources,
        rejected: false,
      });

      let metaSent = false;

      const transformStream = new ReadableStream({
        async pull(controller) {
          if (!metaSent) {
            controller.enqueue(encoder.encode(`__METADATA__:${metadataHeader}\n\n`));
            metaSent = true;
          }

          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            return;
          }
          controller.enqueue(value);
        },
        cancel() {
          reader.cancel();
        },
      });

      return new Response(transformStream, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      });
    } catch (llmErr) {
      console.warn('LLM unreachable or error, falling back to Search-Only Mode:', llmErr);

      // Search-Only Mode: Extractive Synthesis without requiring external API
      const searchOnlyMeta = JSON.stringify({
        confidence: 'high',
        provider: 'search-only',
        model: 'BM25 Extractive Search Engine',
        role,
        sources,
        rejected: false,
      });

      const summaryText =
        `### 🔍 사내 지식 검색 결과 (검색 전용 모드)\n\n` +
        `**[${role.toUpperCase()} 권한]** 사내 규정 검색을 통해 관련 핵심 문서를 찾았습니다. (우측 상단 'BYOK 키 설정' 시 LLM 대화형 스트리밍으로 전환됩니다.)\n\n` +
        `**📌 관련 핵심 규정**: [출처: ${topDoc.chunk.doc_title} §${topDoc.chunk.section_title}]\n\n` +
        `${topDoc.chunk.content}\n\n` +
        (searchResults.length > 1
          ? `\n---\n**추가 연관 섹션**: [출처: ${searchResults[1].chunk.doc_title} §${searchResults[1].chunk.section_title}]\n${searchResults[1].chunk.content.slice(0, 180)}...\n`
          : '');

      const fallbackStream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`__METADATA__:${searchOnlyMeta}\n\n`));
          controller.enqueue(encoder.encode(summaryText));
          controller.close();
        },
      });

      return new Response(fallbackStream, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      });
    }
  } catch (error: unknown) {
    console.error('Chat API Error:', error);
    const errMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return new Response(JSON.stringify({ error: errMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
