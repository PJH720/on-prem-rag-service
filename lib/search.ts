import { BM25Index, Chunk, Role, ScoredChunk } from './types';
import { tokenize } from './tokenizer';
import indexDataRaw from '../data/index.json';

const indexData = indexDataRaw as unknown as BM25Index;

const K1 = 1.2;
const B = 0.75;

// Rejection threshold: raw BM25 score below this indicates lack of relevant context
export const REJECTION_THRESHOLD = 3.0;

/**
 * Searches knowledge chunks using BM25 with strict RBAC pre-filtering.
 *
 * @param query - User query string
 * @param role  - User role ('all' | 'hr' | 'eng' | 'finance')
 * @param topK  - Number of top results to return (default: 4)
 */
export function searchChunks(query: string, role: Role = 'all', topK: number = 4): ScoredChunk[] {
  if (!query || query.trim().length === 0) {
    return [];
  }

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return [];
  }

  // 1. RBAC Pre-Filter: NEVER allow unauthorized chunks into candidate pool
  const candidateChunks = indexData.chunks.filter((chunk: Chunk) => {
    if (role === 'all') {
      return chunk.access_role === 'all';
    }
    // Specific roles can access general ('all') docs + their role-specific docs
    return chunk.access_role === 'all' || chunk.access_role === role;
  });

  const { avgdl, idf } = indexData;
  const scoredChunks: ScoredChunk[] = [];

  for (const chunk of candidateChunks) {
    let score = 0;
    const matchedTerms: string[] = [];

    for (const term of queryTokens) {
      const termFreq = chunk.terms[term] || 0;
      if (termFreq > 0) {
        matchedTerms.push(term);
        const termIdf = idf[term] || 0.1;

        // BM25 term weighting
        const numerator = termFreq * (K1 + 1);
        const denominator = termFreq + K1 * (1 - B + B * (chunk.length / avgdl));
        score += termIdf * (numerator / denominator);
      }
    }

    if (score > 0) {
      // Normalization formula for UI score badge (0.00 ~ 1.00)
      const normalizedScore = Math.min(1.0, score / (score + 10));
      scoredChunks.push({
        chunk,
        score,
        normalizedScore: Math.round(normalizedScore * 100) / 100,
        matchedTerms: Array.from(new Set(matchedTerms)),
      });
    }
  }

  // Sort descending by score
  scoredChunks.sort((a, b) => b.score - a.score);

  return scoredChunks.slice(0, topK);
}

/**
 * Checks if search results meet the confidence threshold and query coverage
 */
export function hasSufficientGrounding(results: ScoredChunk[], query?: string): boolean {
  if (!results || results.length === 0) return false;
  const top = results[0];

  // If query is provided, check distinct word match ratio
  if (query) {
    const rawWords = query
      .replace(/[^\w\s가-힣0-9]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 2);
    
    // Check how many of user's core query words are represented in matched terms
    const matchedWordCount = rawWords.filter(w =>
      top.matchedTerms.some(t => t.includes(w) || w.includes(t))
    ).length;

    const coverage = rawWords.length > 0 ? matchedWordCount / rawWords.length : 0;
    
    // For single-word queries, require score >= 12; for multi-word queries, require >= 2 matched words or >= 40% coverage and score >= 12
    if (rawWords.length >= 2 && (matchedWordCount < 2 || coverage < 0.35)) {
      return false;
    }
  }

  return top.score >= 12.0;
}

