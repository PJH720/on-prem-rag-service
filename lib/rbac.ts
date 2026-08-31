/**
 * RBAC (Role-Based Access Control) Types and Access Rules
 */

/** 질문자의 조회 권한. 'all' = 최소 권한(일반 직원). */
export type ViewerRole = 'all' | 'hr' | 'eng' | 'finance';

/** 문서의 공개 범위. 'all' = 전사 공개. */
export type AccessRole = 'all' | 'hr' | 'eng' | 'finance';

/**
 * RBAC 판정의 단일 진실 원천 (Single Source of Truth).
 * 객체 파라미터로 인자 순서 혼용 방지.
 */
export function canView(args: { viewer: ViewerRole; access: AccessRole }): boolean {
  if (args.access === 'all') return true; // 전사 공개 문서는 모든 역할이 열람 가능
  return args.viewer === args.access; // 부서 전용 문서는 정확히 일치할 때만 열람 가능
}
