import { searchChunks, hasSufficientGrounding } from '../lib/search';

console.log('=== [Running BM25 & RBAC Search Calibration Tests (8 Core Docs)] ===\n');

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

// Test 1: Representative Query - 연차 규정
const q1 = '연차는 입사 후 언제부터 쓸 수 있나요?';
const res1 = searchChunks(q1, 'all', 3);
assertTest(
  'Test 1: "연차는 입사 후 언제부터 쓸 수 있나요?" (role=all)',
  res1.length > 0 && res1[0].chunk.doc_id === 'HR-001' && hasSufficientGrounding(res1, q1),
  `Top 1: ${res1[0]?.chunk.doc_title} (§${res1[0]?.chunk.section_title}) | Score: ${res1[0]?.score.toFixed(2)} (Terms: ${res1[0]?.matchedTerms.length})`
);

// Test 2: Multi-document Query - 법인카드 & 경비 정산
const q2 = '법인카드로 결제한 식대는 어떻게 정산하나요?';
const res2 = searchChunks(q2, 'all', 3);
assertTest(
  'Test 2: "법인카드로 결제한 식대는 어떻게 정산하나요?" (role=all)',
  res2.length > 0 && res2[0].chunk.doc_id === 'FIN-001' && hasSufficientGrounding(res2, q2),
  `Top 1: ${res2[0]?.chunk.doc_title} (§${res2[0]?.chunk.section_title}) | Score: ${res2[0]?.score.toFixed(2)} (Terms: ${res2[0]?.matchedTerms.length})`
);

// Test 3: RBAC Security - "연봉 테이블 알려주세요" under role=all
const q3 = '직급별 연봉 테이블 알려주세요';
const res3All = searchChunks(q3, 'all', 5);
const hr11InAll = res3All.find(r => r.chunk.doc_id === 'HR-011');
assertTest(
  'Test 3: "직급별 연봉 테이블 알려주세요" under role="all" (전사)',
  hr11InAll === undefined,
  `role="all" candidate pool isolated: HR-011 present = ${!!hr11InAll}`
);

// Test 4: RBAC Access - "연봉 테이블 알려주세요" under role=hr
const res3Hr = searchChunks(q3, 'hr', 3);
assertTest(
  'Test 4: "직급별 연봉 테이블 알려주세요" under role="hr" (인사팀)',
  res3Hr.length > 0 && res3Hr[0].chunk.doc_id === 'HR-011' && hasSufficientGrounding(res3Hr, q3),
  `Top 1: ${res3Hr[0]?.chunk.doc_title} (§${res3Hr[0]?.chunk.section_title}) | Score: ${res3Hr[0]?.score.toFixed(2)} (Terms: ${res3Hr[0]?.matchedTerms.length})`
);

// Test 5: In-Domain Adjacent Query - "점심시간이 언제인가요?"
const q5 = '점심시간이 언제인가요?';
const res5 = searchChunks(q5, 'all', 3);
assertTest(
  'Test 5: "점심시간이 언제인가요?" (In-domain boundary test)',
  res5.length > 0 && res5[0].chunk.doc_id === 'GEN-001' && hasSufficientGrounding(res5, q5),
  `Top 1: ${res5[0]?.chunk.doc_title} (§${res5[0]?.chunk.section_title}) | Score: ${res5[0]?.score.toFixed(2)} (Terms: ${res5[0]?.matchedTerms.length})`
);

// Test 6: Out-of-Domain Rejection - "오늘 점심 메뉴 뭐야?"
const q6 = '오늘 점심 메뉴 뭐야?';
const res6 = searchChunks(q6, 'all', 3);
const grounding6 = hasSufficientGrounding(res6, q6);
assertTest(
  'Test 6: "오늘 점심 메뉴 뭐야?" (Out-of-domain rejection)',
  grounding6 === false,
  `Top Score: ${res6[0]?.score.toFixed(2) || 0} (Terms: ${res6[0]?.matchedTerms.length || 0}) | Grounding Sufficient: ${grounding6}`
);

// Test 7: Out-of-Domain General Knowledge - "파이썬으로 웹 크롤러 만드는 법"
const q7 = '파이썬으로 웹 크롤러 만드는 법 알려줘';
const res7 = searchChunks(q7, 'all', 3);
const grounding7 = hasSufficientGrounding(res7, q7);
assertTest(
  'Test 7: "파이썬으로 웹 크롤러 만드는 법" (General knowledge rejection)',
  grounding7 === false,
  `Grounding Sufficient: ${grounding7}`
);

console.log(`=== Summary: ${passCount} / ${totalCount} Calibration Tests Passed ===`);
if (passCount === totalCount) {
  console.log('🎉 ALL BM25 & RBAC CALIBRATION TESTS PASSED PERFECTLY (100%)!');
}
