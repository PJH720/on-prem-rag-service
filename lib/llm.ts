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
      maxRetries: 0,
      timeout: 15000,
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
