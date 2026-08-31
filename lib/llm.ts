import { ChatMessage } from './types';

export interface LLMStreamOptions {
  messages: ChatMessage[];
  byokKey?: string;
  onToken?: (token: string) => void;
}

export interface LLMConfig {
  provider: 'on-premise' | 'byok';
  baseURL: string;
  model: string;
  apiKey: string;
}

export function getLLMConfig(byokKey?: string): LLMConfig {
  if (byokKey && byokKey.trim().length > 0) {
    return {
      provider: 'byok',
      baseURL: process.env.BYOK_BASE_URL || 'https://api.openai.com/v1',
      model: process.env.BYOK_MODEL || 'gpt-4o-mini',
      apiKey: byokKey.trim(),
    };
  }

  return {
    provider: 'on-premise',
    baseURL: process.env.LLM_BASE_URL || 'http://spark-f5e2.tail0bfda4.ts.net:8000/v1',
    model: process.env.LLM_MODEL || 'Inferact/Qwen3.8-Flash-Next-NVFP4',
    apiKey: process.env.LLM_API_KEY || 'not-needed',
  };
}

/**
 * Calls OpenAI-compatible streaming completion endpoint.
 * Handles both on-premise (sglang with enable_thinking: false) and OpenAI BYOK.
 */
export async function createLLMStream(
  messages: ChatMessage[],
  byokKey?: string
): Promise<ReadableStream<Uint8Array>> {
  const config = getLLMConfig(byokKey);

  const bodyPayload: Record<string, unknown> = {
    model: config.model,
    messages,
    stream: true,
    max_tokens: 1024,
    temperature: 0.2,
  };

  // Crucial on-premise requirement: disable thinking mode for low latency and pure text output
  if (config.provider === 'on-premise') {
    bodyPayload.chat_template_kwargs = { enable_thinking: false };
  }

  const response = await fetch(`${config.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(bodyPayload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM Error (${response.status}): ${errorText}`);
  }

  if (!response.body) {
    throw new Error('No response body from LLM');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  let buffer = '';

  return new ReadableStream({
    async pull(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(':')) continue;
            if (trimmed === 'data: [DONE]') {
              controller.close();
              return;
            }

            if (trimmed.startsWith('data: ')) {
              const jsonStr = trimmed.slice(6);
              try {
                const parsed = JSON.parse(jsonStr);
                const delta = parsed.choices?.[0]?.delta;
                // Only yield content; discard reasoning_content if any
                const text = delta?.content;
                if (text) {
                  controller.enqueue(encoder.encode(text));
                }
              } catch {
                // Ignore parse errors on partial chunks
              }
            }
          }
        }
      } catch (err) {
        controller.error(err);
      }
    },
    cancel() {
      reader.cancel();
    },
  });
}
