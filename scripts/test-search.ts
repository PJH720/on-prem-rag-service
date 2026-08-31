import { canView } from '../lib/rbac';
import { RbacBm25Retriever, evaluateGrounding, readMeta } from '../lib/retriever';

console.log('=== [Running LangChain RBAC & BM25 Retriever Calibration Tests] ===\n');

let passCount = 0;
let totalCount = 0;

function assertTest(name: string, condition: boolean, details?: string) {
  totalCount++;
  if (condition) {
    passCount++;
    console.log(`✅ PASS: ${name}`);
  } else {
    console.error(`❌ FAIL: ${name}`);
  }
  if (details) console.log(`   ${details}`);
  console.log('');
}

// 1. RBAC Unit Test
assertTest(
  'RBAC Unit Test: canView truth table',
  canView({ viewer: 'all', access: 'hr' }) === false &&
    canView({ viewer: 'hr', access: 'hr' }) === true &&
    canView({ viewer: 'hr', access: 'all' }) === true &&
    canView({ viewer: 'eng', access: 'hr' }) === false,
  'viewer="all" + access="hr" -> false | viewer="hr" + access="all" -> true'
);

async function runRetrieverTests() {
  // 2. Retriever Constructor Isolation Test
  const allRetriever = new RbacBm25Retriever({ role: 'all', k: 5 });
  const hrRetriever = new RbacBm25Retriever({ role: 'hr', k: 5 });

  // Test 1: In-Domain Representative - 연차 규정
  const q1 = '연차는 입사 후 언제부터 쓸 수 있나요?';
  const docs1 = await allRetriever.invoke(q1);
  const gate1 = evaluateGrounding(docs1);
  assertTest(
    'Test 1: "연차는 입사 후 언제부터 쓸 수 있나요?" (role=all)',
    docs1.length > 0 && readMeta(docs1[0]).doc_id === 'HR-001' && gate1.grounded,
    `Top 1: ${readMeta(docs1[0])?.doc_title} (§${readMeta(docs1[0])?.section_title}) | Score: ${readMeta(docs1[0])?.score.toFixed(2)}`
  );

  // Test 2: Multi-document Query - 법인카드 & 경비 정산
  const q2 = '법인카드로 결제한 식대는 어떻게 정산하나요?';
  const docs2 = await allRetriever.invoke(q2);
  const gate2 = evaluateGrounding(docs2);
  assertTest(
    'Test 2: "법인카드로 결제한 식대는 어떻게 정산하나요?" (role=all)',
    docs2.length > 0 && readMeta(docs2[0]).doc_id === 'FIN-001' && gate2.grounded,
    `Top 1: ${readMeta(docs2[0])?.doc_title} (§${readMeta(docs2[0])?.section_title}) | Score: ${readMeta(docs2[0])?.score.toFixed(2)}`
  );

  // Test 3: RBAC Security - "연봉 테이블 알려주세요" under role=all
  const q3 = '직급별 연봉 테이블 알려주세요';
  const docs3All = await allRetriever.invoke(q3);
  const hr11InAll = docs3All.find(d => readMeta(d).doc_id === 'HR-011');
  assertTest(
    'Test 3: "직급별 연봉 테이블 알려주세요" under role="all" (전사)',
    hr11InAll === undefined,
    `role="all" candidate pool isolated: HR-011 present = ${!!hr11InAll}`
  );

  // Test 4: RBAC Access - "연봉 테이블 알려주세요" under role=hr
  const docs3Hr = await hrRetriever.invoke(q3);
  const gate3Hr = evaluateGrounding(docs3Hr);
  assertTest(
    'Test 4: "직급별 연봉 테이블 알려주세요" under role="hr" (인사팀)',
    docs3Hr.length > 0 && readMeta(docs3Hr[0]).doc_id === 'HR-011' && gate3Hr.grounded,
    `Top 1: ${readMeta(docs3Hr[0])?.doc_title} (§${readMeta(docs3Hr[0])?.section_title}) | Score: ${readMeta(docs3Hr[0])?.score.toFixed(2)}`
  );

  // Test 5: In-Domain Adjacent Query - "점심시간이 언제인가요?"
  const q5 = '점심시간이 언제인가요?';
  const docs5 = await allRetriever.invoke(q5);
  const gate5 = evaluateGrounding(docs5);
  assertTest(
    'Test 5: "점심시간이 언제인가요?" (In-domain boundary test)',
    docs5.length > 0 && readMeta(docs5[0]).doc_id === 'GEN-001' && gate5.grounded,
    `Top 1: ${readMeta(docs5[0])?.doc_title} (§${readMeta(docs5[0])?.section_title}) | Score: ${readMeta(docs5[0])?.score.toFixed(2)}`
  );

  // Test 6: Out-of-Domain Rejection - "오늘 점심 메뉴 뭐야?"
  const q6 = '오늘 점심 메뉴 뭐야?';
  const docs6 = await allRetriever.invoke(q6);
  const gate6 = evaluateGrounding(docs6);
  assertTest(
    'Test 6: "오늘 점심 메뉴 뭐야?" (Out-of-domain rejection)',
    gate6.grounded === false,
    `Top Score: ${docs6[0] ? readMeta(docs6[0]).score.toFixed(2) : 0} | Grounded: ${gate6.grounded} (Reason: ${gate6.reason})`
  );

  // Test 7: Out-of-Domain General Knowledge - "파이썬으로 웹 크롤러 만드는 법"
  const q7 = '파이썬으로 웹 크롤러 만드는 법 알려줘';
  const docs7 = await allRetriever.invoke(q7);
  const gate7 = evaluateGrounding(docs7);
  assertTest(
    'Test 7: "파이썬으로 웹 크롤러 만드는 법" (General knowledge rejection)',
    gate7.grounded === false,
    `Grounded: ${gate7.grounded} (Reason: ${gate7.reason})`
  );

  console.log(`=== Summary: ${passCount} / ${totalCount} Calibration Tests Passed ===`);
  if (passCount === totalCount) {
    console.log('🎉 ALL LANGCHAIN RBAC & RETRIEVER TESTS PASSED PERFECTLY (100%)!');
  }
}

runRetrieverTests();
