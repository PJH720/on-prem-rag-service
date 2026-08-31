import { tokenize } from './tokenizer';

/**
 * Query pre-processing & Korean synonym expansion
 *
 * 1. sanitizeRetrievalQuery: BM25 검색 쿼리에서 역할 위장 문구를 제거하여 검색 점수 오염 방지
 * 2. expandSynonyms: 한국어 어휘 격차를 해소하기 위한 양방향 동의어 확장
 */

/**
 * 역할 위장/권한 주장 패턴 목록
 */
const ROLE_SPOOFING_PATTERNS: RegExp[] = [
  // 1. "X팀/X 권한으로/자격으로/역할로 답해주세요/알려주세요"
  /(?:인사팀|엔지니어링|재무팀|보안팀|개발팀|경영진|관리자|임원|hr|eng|finance|admin)\s*(?:권한|역할|자격)(?:으로|에서|의|이|가)?\s*(?:답해?\s*(?:주세요|줘|주십시오)?|답변해?\s*(?:주세요|줘)?|알려\s*(?:주세요|줘)?|조회해?\s*(?:주세요|줘)?)/gi,

  // 2. "X팀/X 권한으로 / X로서 / X 자격으로" (단독 수식구)
  /(?:인사팀|엔지니어링|재무팀|보안팀|개발팀|경영진|관리자|임원|hr|eng|finance|admin)\s*(?:권한으로|권한상|으?로서?|자격으로|입장에서)\s*/gi,

  // 3. "나는/저는 X팀 소속/직원/담당자 입니다/이야"
  /(?:나는|저는|본인은)\s*(?:인사팀|엔지니어링|재무팀|보안팀|개발팀|경영진|관리자|임원|hr팀?|eng팀?)\s*(?:소속|직원|담당자|팀원)?(?:입니다|이에요|이야|임)/gi,

  // 4. System prompt / role injection
  /(?:system|시스템|assistant)\s*(?:프롬프트|prompt)?\s*(?:역할|role|메시지|message)?\s*(?:를?|을?|은?|는?|이?|가?|의?)?\s*(?:hr|eng|finance|admin|관리자|인사팀|개발팀)?\s*(?:로|으로)?\s*(?:변경|설정|바꿔|override|지정|전환|조작)(?:해?\s*(?:주세요|줘|주십시오|봐)?|합니다|함)?/gi,

  // 5. "모든/전체 문서를 열람/접근/조회/공개"
  /(?:모든|전체|모든\s*문서|기밀|비밀)\s*(?:문서|자료|정보)?\s*(?:를?|을?)\s*(?:열람|접근|조회|공개|보여)\s*(?:해?\s*(?:주세요|줘)?|하겠습니다|권한)/gi,
];

/**
 * BM25 검색 전 쿼리에서 역할 위장 및 권한 조작 문구를 제거한다.
 */
export function sanitizeRetrievalQuery(raw: string): string {
  if (!raw) return '';
  let q = raw;
  for (const pattern of ROLE_SPOOFING_PATTERNS) {
    q = q.replace(pattern, ' ');
  }
  return q
    .replace(/\s{2,}/g, ' ')
    .replace(/^[^가-힣a-zA-Z0-9]+/, '')
    .trim();
}

/**
 * 한국어 동의어/유의어 확장 맵.
 * 각 그룹은 양방향 등가 — 그룹 내 어떤 단어로 검색해도
 * 나머지 단어의 토큰이 쿼리에 추가된다.
 */
const SYNONYM_GROUPS: string[][] = [
  // 인원/인력 관련
  ['사원', '직원', '임직원', '구성원', '인원', '총원', '인력'],
  ['인원수', '총원', 'headcount', '정원'],
  ['몇명', '몇 명', '인원수', '총원'],
  // 조직 관련
  ['부서장', '팀장', '실장', '본부장', '리더'],
  ['조직도', '조직구조', '조직체계'],
  // 급여 관련
  ['연봉', '급여', '보수', '임금'],
  ['초봉', '신입급여', '시작급여'],
  // 근무 관련
  ['근무시간', '업무시간', '출퇴근시간', '워킹아워'],
  ['휴가', '연차', '유급휴가', '휴일'],
  // AI/보안 관련
  ['생성형ai', '생성ai', 'genai', 'generativeai'],
  ['보안사고', '인시던트', '침해사고', '장애'],
];

/** 단어→동의어그룹 역인덱스 (O(1) 조회) */
const synonymIndex: Map<string, string[]> = new Map();
for (const group of SYNONYM_GROUPS) {
  for (const word of group) {
    const key = word.toLowerCase().replace(/\s+/g, '');
    synonymIndex.set(key, group);
  }
}

/**
 * 토큰 배열을 받아 동의어 확장된 토큰 배열을 반환한다.
 * 원본 토큰은 유지하고, 각 동의어의 토큰(n-gram 포함)을 추가한다.
 * 중복 제거하여 BM25 tf를 불필요하게 부풀리지 않는다.
 */
export function expandSynonyms(tokens: string[]): string[] {
  const expanded = new Set(tokens);
  for (const token of tokens) {
    const key = token.toLowerCase().replace(/\s+/g, '');
    const group = synonymIndex.get(key);
    if (group) {
      for (const synonym of group) {
        const synTokens = tokenize(synonym);
        for (const st of synTokens) {
          expanded.add(st);
        }
      }
    }
  }
  return [...expanded];
}
