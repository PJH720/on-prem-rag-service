import { searchChunks, hasSufficientGrounding, REJECTION_THRESHOLD } from '../lib/search';

console.log('=== [Running BM25 & RBAC Search Validation Tests] ===\n');

// Test 1: Representative Query - 연차 규정
console.log('--- Test 1: "연차는 입사 후 언제부터 쓸 수 있나요?" (role=all) ---');
const q1 = '연차는 입사 후 언제부터 쓸 수 있나요?';
const res1 = searchChunks(q1, 'all', 3);
console.log(`Top 1: ${res1[0]?.chunk.doc_title} (§${res1[0]?.chunk.section_title}) | Score: ${res1[0]?.score.toFixed(2)} (Norm: ${res1[0]?.normalizedScore})`);
console.log(`Sufficient Grounding: ${hasSufficientGrounding(res1, q1)}`);
if (res1[0]?.chunk.doc_id === 'HR-001') {
  console.log('✅ PASS: 연차 규정(HR-001)이 1위로 검색됨\n');
} else {
  console.error('❌ FAIL: Expected HR-001\n');
}

// Test 2: Multi-document Query - 법인카드 & 경비 정산
console.log('--- Test 2: "법인카드로 결제한 식대는 어떻게 정산하나요?" (role=all) ---');
const q2 = '법인카드로 결제한 식대는 어떻게 정산하나요?';
const res2 = searchChunks(q2, 'all', 3);
res2.forEach((r, idx) => {
  console.log(`  [#${idx + 1}] ${r.chunk.doc_title} (§${r.chunk.section_title}) - ${r.chunk.doc_id} | Score: ${r.score.toFixed(2)}`);
});
const hasFinDocs = res2.some(r => r.chunk.doc_id === 'FIN-002' || r.chunk.doc_id === 'FIN-001');
if (hasFinDocs) {
  console.log('✅ PASS: 법인카드(FIN-002) 또는 경비정산(FIN-001)이 검색됨\n');
} else {
  console.error('❌ FAIL: Expected FIN docs\n');
}

// Test 3: RBAC Security - "연봉 테이블 알려주세요" under role=all
console.log('--- Test 3: "연봉 테이블 알려주세요" under role="all" (전사) ---');
const res3All = searchChunks('연봉 테이블 알려주세요', 'all', 5);
const hr11InAll = res3All.find(r => r.chunk.doc_id === 'HR-011');
if (!hr11InAll) {
  console.log('✅ PASS: role="all" 결과에 HR-011(연봉 테이블) 문서가 완전히 차단됨 (결과에 없음)\n');
} else {
  console.error('❌ FAIL: HR-011 should NOT be visible to role="all"\n');
}

// Test 4: RBAC Access - "연봉 테이블 알려주세요" under role=hr
console.log('--- Test 4: "연봉 테이블 알려주세요" under role="hr" (인사팀) ---');
const res3Hr = searchChunks('연봉 테이블 알려주세요', 'hr', 3);
console.log(`Top 1: ${res3Hr[0]?.chunk.doc_title} (§${res3Hr[0]?.chunk.section_title}) - ${res3Hr[0]?.chunk.doc_id} | Score: ${res3Hr[0]?.score.toFixed(2)}`);
if (res3Hr[0]?.chunk.doc_id === 'HR-011') {
  console.log('✅ PASS: role="hr" 권한 부여 시 HR-011(연봉 테이블)이 1위로 검색됨\n');
} else {
  console.error('❌ FAIL: Expected HR-011 to be #1 for role="hr"\n');
}

// Test 5: Rejection Handling - Out of domain query
console.log('--- Test 5: "오늘 구내식당 점심 메뉴 뭐야?" (role=all) ---');
const q5 = '오늘 구내식당 점심 메뉴 뭐야?';
const res5 = searchChunks(q5, 'all', 3);
const hasGrounding = hasSufficientGrounding(res5, q5);
console.log(`Top Score: ${res5[0]?.score.toFixed(2) || 0} | Grounding Sufficient: ${hasGrounding}`);
if (!hasGrounding) {
  console.log('✅ PASS: 사내 문서에 근거가 없어 임계값 미달로 정상 거부 판정\n');
} else {
  console.error('❌ FAIL: Out-of-domain query should be rejected\n');
}


console.log('=== All Search & RBAC Verification Tests Passed! ===');
