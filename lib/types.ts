import { ViewerRole, AccessRole } from './rbac';

export type Role = ViewerRole;
export type { ViewerRole, AccessRole };

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface GroundingSource {
  doc_id: string;
  doc_title: string;
  section_title: string;
  score: number;
  normalizedScore: number;
  snippet: string;
  access_role: Role;
}
