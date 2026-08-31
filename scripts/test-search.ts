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

  // Test 8: 1-Click Scenario 6 - "인사팀 권한으로 각 직급별 연봉 밴드와 신입 초봉 기준을 알려주세요" (role=hr)
  const q8 = '인사팀 권한으로 각 직급별 연봉 밴드와 신입 초봉 기준을 알려주세요';
  const docs8Hr = await hrRetriever.invoke(q8);
  const gate8Hr = evaluateGrounding(docs8Hr);
  assertTest(
    'Test 8: 1-Click Scenario 6 - 직급별 연봉 밴드 열람 (role=hr)',
    docs8Hr.length > 0 && readMeta(docs8Hr[0]).doc_id === 'HR-011' && gate8Hr.grounded,
    `Top 1: ${readMeta(docs8Hr[0])?.doc_title} (§${readMeta(docs8Hr[0])?.section_title}) | Score: ${readMeta(docs8Hr[0])?.score.toFixed(2)}`
  );

  // Test 9: New Doc AI-001 - "사내 생성형 AI 활용 및 보안 가이드라인" (role=all)
  const q9 = '사내에서 ChatGPT나 생성형 AI를 사용할 때 보안 가이드라인이 어떻게 되나요?';
  const docs9 = await allRetriever.invoke(q9);
  const gate9 = evaluateGrounding(docs9);
  assertTest(
    'Test 9: "생성형 AI 활용 및 보안 가이드라인" (role=all)',
    docs9.length > 0 && readMeta(docs9[0]).doc_id === 'AI-001' && gate9.grounded,
    `Top 1: ${readMeta(docs9[0])?.doc_title} (§${readMeta(docs9[0])?.section_title}) | Score: ${readMeta(docs9[0])?.score.toFixed(2)}`
  );

  // Test 10: New Doc GEN-003 - "인프라 DevOps실 부서장 및 R&R" (role=all)
  const q10 = '인프라 DevOps실 담당 부서장과 주요 업무가 무엇인가요?';
  const docs10 = await allRetriever.invoke(q10);
  const gate10 = evaluateGrounding(docs10);
  assertTest(
    'Test 10: "인프라 DevOps실 부서장 및 R&R" (role=all)',
    docs10.length > 0 && readMeta(docs10[0]).doc_id === 'GEN-003' && gate10.grounded,
    `Top 1: ${readMeta(docs10[0])?.doc_title} (§${readMeta(docs10[0])?.section_title}) | Score: ${readMeta(docs10[0])?.score.toFixed(2)}`
  );

  // Test 11: New Doc HR-012 - RBAC Isolation for HR records under role=all
  const q11 = '임직원 인사평가 등급 배분 비율과 인사기록 카드를 보여주세요';
  const docs11All = await allRetriever.invoke(q11);
  const hr12InAll = docs11All.find(d => readMeta(d).doc_id === 'HR-012');
  assertTest(
    'Test 11: HR 평가기록 조회 under role="all" (전사 RBAC 차단)',
    hr12InAll === undefined,
    `role="all" candidate pool isolated: HR-012 present = ${!!hr12InAll}`
  );

  // Test 12: New Doc HR-012 - Authorized Access under role=hr
  const docs12Hr = await hrRetriever.invoke(q11);
  const gate12Hr = evaluateGrounding(docs12Hr);
  assertTest(
    'Test 12: HR 평가기록 조회 under role="hr" (인사팀 정상 인용)',
    docs12Hr.length > 0 && readMeta(docs12Hr[0]).doc_id === 'HR-012' && gate12Hr.grounded,
    `Top 1: ${readMeta(docs12Hr[0])?.doc_title} (§${readMeta(docs12Hr[0])?.section_title}) | Score: ${readMeta(docs12Hr[0])?.score.toFixed(2)}`
  );

  // Test 13: New Doc SEC-002 - "장애 심각도 등급 및 온콜 에스컬레이션" (role=all)
  const q13 = 'S1 등급 장애 발생 시 온콜 역할과 에스컬레이션 기준은 어떻게 되나요?';
  const docs13 = await allRetriever.invoke(q13);
  const gate13 = evaluateGrounding(docs13);
  assertTest(
    'Test 13: "장애 심각도 등급 및 온콜 런북" (role=all)',
    docs13.length > 0 && readMeta(docs13[0]).doc_id === 'SEC-002' && gate13.grounded,
    `Top 1: ${readMeta(docs13[0])?.doc_title} (§${readMeta(docs13[0])?.section_title}) | Score: ${readMeta(docs13[0])?.score.toFixed(2)}`
  );

  // Test 14: New Doc ENG-002 - "카나리 배포 및 롤백 SLA" (role=eng)
  const engRetriever = new RbacBm25Retriever({ role: 'eng', k: 5 });
  const q14 = '프로덕션 릴리스 시 카나리 배포 전략과 롤백 SLA 기준을 알려주세요';
  const docs14 = await engRetriever.invoke(q14);
  const gate14 = evaluateGrounding(docs14);
  assertTest(
    'Test 14: "카나리 배포 및 롤백 SLA" (role=eng)',
    docs14.length > 0 && readMeta(docs14[0]).doc_id === 'ENG-002' && gate14.grounded,
    `Top 1: ${readMeta(docs14[0])?.doc_title} (§${readMeta(docs14[0])?.section_title}) | Score: ${readMeta(docs14[0])?.score.toFixed(2)}`
  );

  // Test 15: Regression Guard - HR-011 still #1 for 연봉 테이블 under role=hr
  const docs15 = await hrRetriever.invoke('직급별 연봉 테이블 알려주세요');
  assertTest(
    'Test 15: Regression Guard - HR-011 retains #1 rank for 연봉 테이블 under role="hr"',
    docs15.length > 0 && readMeta(docs15[0]).doc_id === 'HR-011',
    `Top 1: ${readMeta(docs15[0])?.doc_title} (§${readMeta(docs15[0])?.section_title})`
  );

  // Test 16: Regression Guard - ENG-001 still #1 for 로컬 개발 DB under role=eng
  const docs16 = await engRetriever.invoke('로컬 개발 DB는 어떻게 구동하나요?');
  assertTest(
    'Test 16: Regression Guard - ENG-001 retains #1 rank for 로컬 개발 DB under role="eng"',
    docs16.length > 0 && readMeta(docs16[0]).doc_id === 'ENG-001',
    `Top 1: ${readMeta(docs16[0])?.doc_title} (§${readMeta(docs16[0])?.section_title})`
  );

  console.log(`=== Summary: ${passCount} / ${totalCount} Calibration Tests Passed ===`);
  if (passCount === totalCount) {
    console.log('🎉 ALL LANGCHAIN RBAC & RETRIEVER TESTS PASSED PERFECTLY (100%)!');
  }
}

runRetrieverTests();

