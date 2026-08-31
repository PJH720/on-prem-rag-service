import fs from 'fs';
import path from 'path';
import { RbacBm25Retriever, evaluateGrounding, readMeta } from '../lib/retriever';
import { getModel } from '../lib/llm';
import { answerPrompt, formatDocsAsXml } from '../lib/prompt';
import { RunnableBranch, RunnableLambda, RunnableSequence } from '@langchain/core/runnables';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { HumanMessage } from '@langchain/core/messages';

// Read .env.local if present
let baseURL = 'http://spark-f5e2.tail0bfda4.ts.net:8000/v1';
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  const match = envContent.match(/LLM_BASE_URL=(.+)/);
  if (match) baseURL = match[1].trim();
}

async function testE2E() {
  console.log('=== [Testing Full LCEL Chain with On-Premise GPU (Qwen 3.8)] ===\n');

  const question = '연차는 입사 후 언제부터 쓸 수 있나요?';
  const role = 'all';

  const retriever = new RbacBm25Retriever({ role, k: 4 });
  const docs = await retriever.invoke(question);
  const gate = evaluateGrounding(docs);

  console.log(`Retrieved ${docs.length} docs. Gate:`, gate);

  const model = getModel({ isLocal: true, customBaseUrl: baseURL });

  const chain = RunnableSequence.from([
    RunnableLambda.from((input: any) => ({
      role: input.role,
      question: input.question,
      history: input.history,
      context: formatDocsAsXml(input.docs),
    })),
    answerPrompt,
    model,
    new StringOutputParser(),
  ]);

  console.log('\n--- [Streaming Generation Output] ---');
  const t0 = Date.now();
  let fullOutput = '';

  const stream = await chain.stream({
    question,
    role,
    docs,
    history: [],
  });

  for await (const chunk of stream) {
    process.stdout.write(chunk);
    fullOutput += chunk;
  }
  const latency = Date.now() - t0;
  console.log(`\n\n--- [Done in ${latency}ms] ---`);

  // Verify Citation Regex Contract: /(\[출처:\s*[^\]]+\])/g
  const citationMatches = fullOutput.match(/(\[출처:\s*[^\]]+\])/g);
  console.log(`Citation tags matched:`, citationMatches);

  if (citationMatches && citationMatches.length > 0) {
    console.log('✅ Citation Contract PASSED: Exact [출처: 문서명 §섹션명] pattern generated!');
  } else {
    console.warn('⚠️ Citation Contract WARNING: No citations matched exact regex pattern.');
  }
}

testE2E();
