import { BaseRetriever, type BaseRetrieverInput } from '@langchain/core/retrievers';
import { Document } from '@langchain/core/documents';
import { tokenize } from './tokenizer';
import { canView, type ViewerRole, type AccessRole } from './rbac';
import rawIndex from '../data/index.json';

const K1 = 1.2;
const B = 0.75;

export interface ChunkMetadata {
  doc_id: string;
  doc_title: string;
  section_title: string;
  category: string;
  access_role: AccessRole;
  owner: string;
  file_name: string;
}

/** index.json의 한 항목. terms/length는 BM25 통계이며 LLM 컨텍스트로는 나가지 않는다. */
interface IndexedDoc {
  id: string;
  pageContent: string;
  metadata: ChunkMetadata;
  terms: Record<string, number>;
  length: number;
}

interface SerializedIndex {
  version: string;
  updated_at: string;
  total_docs: number;
  avgdl: number;
  df: Record<string, number>;
  idf: Record<string, number>;
  documents: IndexedDoc[];
}

const INDEX = rawIndex as unknown as SerializedIndex;

export interface RetrievedMetadata extends ChunkMetadata {
  score: number;
  normalizedScore: number;
  matchedTerms: string[];
}

/** Document.metadata를 타입 안전하게 읽는다. */
export function readMeta(doc: Document): RetrievedMetadata {
  return doc.metadata as RetrievedMetadata;
}

export interface RbacBm25RetrieverInput extends BaseRetrieverInput {
  role: ViewerRole;
  k?: number;
}

export class RbacBm25Retriever extends BaseRetriever {
  static lc_name() {
    return 'RbacBm25Retriever';
  }

  lc_namespace = ['nexatech', 'retrievers', 'rbac_bm25'];

  readonly role: ViewerRole;
  readonly k: number;

  /**
   * 보안 핵심: RBAC를 생성자에서 적용한다.
   * 권한 없는 청크는 이 인스턴스에서 도달 자체가 불가능하므로,
   * _getRelevantDocuments에 어떤 버그가 있어도 유출될 수 없다.
   */
  private readonly permitted: readonly IndexedDoc[];

  constructor(fields: RbacBm25RetrieverInput) {
    super(fields);
    this.role = fields.role;
    this.k = fields.k ?? 4;
    this.permitted = INDEX.documents.filter((d) =>
      canView({ viewer: fields.role, access: d.metadata.access_role })
    );
  }

  async _getRelevantDocuments(query: string): Promise<Document[]> {
    const queryTerms = tokenize(query);
    if (queryTerms.length === 0) return [];

    const scored: Array<{ doc: IndexedDoc; score: number; matched: string[] }> = [];

    for (const doc of this.permitted) {
      let score = 0;
      const matched = new Set<string>();

      for (const term of queryTerms) {
        const tf = doc.terms[term] ?? 0;
        if (tf === 0) continue;
        matched.add(term);
        const idf = INDEX.idf[term] ?? 0.1;
        const norm = 1 - B + B * (doc.length / INDEX.avgdl);
        score += idf * ((tf * (K1 + 1)) / (tf + K1 * norm));
      }

      if (score > 0) scored.push({ doc, score, matched: [...matched] });
    }

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, this.k).map(
      ({ doc, score, matched }) =>
        new Document({
          id: doc.id,
          pageContent: doc.pageContent,
          metadata: {
            ...doc.metadata,
            score,
            normalizedScore: Math.round((score / (score + 10)) * 100) / 100,
            matchedTerms: matched,
          } satisfies RetrievedMetadata,
        })
    );
  }
}

// ---------------------------------------------------------------------------
// 신뢰도 게이트 — LLM 호출 전에 판정한다.
// ---------------------------------------------------------------------------

const MIN_SCORE = Number(process.env.RAG_REJECTION_THRESHOLD ?? 10);
const MIN_SHALLOW_SCORE = Number(process.env.RAG_SHALLOW_SCORE ?? 18);

export type GateReason = 'ok' | 'no_results' | 'below_threshold' | 'shallow_match';

export interface GroundingGate {
  grounded: boolean;
  topScore: number;
  reason: GateReason;
}

export function evaluateGrounding(docs: Document[]): GroundingGate {
  if (docs.length === 0) return { grounded: false, topScore: 0, reason: 'no_results' };

  const top = readMeta(docs[0]);

  if (top.score < MIN_SCORE) {
    return { grounded: false, topScore: top.score, reason: 'below_threshold' };
  }
  // 단일 어휘만 스친 얕은 매칭은 근거로 보지 않는다.
  if (top.matchedTerms.length < 2 && top.score < MIN_SHALLOW_SCORE) {
    return { grounded: false, topScore: top.score, reason: 'shallow_match' };
  }
  return { grounded: true, topScore: top.score, reason: 'ok' };
}
