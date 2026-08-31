import fs from 'fs';
import path from 'path';
import { ChatOpenAI } from '@langchain/openai';

// Read .env.local if present
let baseURL = 'http://spark-f5e2.tail0bfda4.ts.net:8000/v1';
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  const match = envContent.match(/LLM_BASE_URL=(.+)/);
  if (match) baseURL = match[1].trim();
}

async function probe() {
  console.log(`[Probe Gate 0] Testing baseURL: ${baseURL}`);

  const model = new ChatOpenAI({
    model: 'Inferact/Qwen3.8-Flash-Next-NVFP4',
    apiKey: 'not-needed',
    maxTokens: 128,
    temperature: 0.2,
    streamUsage: false,
    configuration: { baseURL },
    modelKwargs: { chat_template_kwargs: { enable_thinking: false } },
  });

  const t0 = Date.now();
  try {
    const res = await model.invoke('연차는 며칠인가요? 한 문장으로 답하세요.');
    const latency = Date.now() - t0;
    console.log(`[Probe Result] Latency: ${latency}ms | Content Length: ${String(res.content).length}`);
    console.log(`[Probe Content]: "${res.content}"`);

    if (String(res.content).length > 0 && latency < 5000) {
      console.log('✅ GATE 0 PASSED: ChatOpenAI correctly passed modelKwargs and received instant response!');
    } else {
      console.warn('⚠️ GATE 0 WARNING: Unexpected response structure or latency.');
    }
  } catch (err) {
    console.error('❌ GATE 0 FAILED with error:', err);
  }
}

probe();
