export type Role = 'all' | 'hr' | 'eng' | 'finance';

export interface DocFrontmatter {
  title: string;
  category: string;
  access_role: Role;
  owner: string;
  updated_at: string;
  doc_id: string;
}

export interface Chunk {
  id: string;
  doc_id: string;
  doc_title: string;
  file_name: string;
  category: string;
  access_role: Role;
  owner: string;
  section_title: string;
  content: string;
  terms: Record<string, number>; // term -> frequency
  length: number;
}

export interface BM25Index {
  version: string;
  updated_at: string;
  total_docs: number;
  avgdl: number;
  df: Record<string, number>; // term -> doc frequency
  idf: Record<string, number>; // term -> idf
  chunks: Chunk[];
}

export interface ScoredChunk {
  chunk: Chunk;
  score: number;
  normalizedScore: number;
  matchedTerms: string[];
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface GroundingSource {
  doc_id: string;
  doc_title: string;
  section_title: string;
  score: number;
  snippet: string;
  access_role: Role;
}
