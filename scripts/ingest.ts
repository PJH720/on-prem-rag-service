import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { tokenize } from '../lib/tokenizer';
import { AccessRole } from '../lib/rbac';

const CORPUS_DIR = path.join(process.cwd(), 'data', 'corpus');
const OUTPUT_PATH = path.join(process.cwd(), 'data', 'index.json');

export interface DocMetadata {
  doc_id: string;
  doc_title: string;
  section_title: string;
  category: string;
  access_role: AccessRole;
  owner: string;
  file_name: string;
}

export interface RawFrontmatter {
  title?: string;
  doc_title?: string;
  doc_id?: string;
  category?: string;
  access_role?: AccessRole;
  owner?: string;
  updated_at?: string;
}

export interface IndexedDocument {
  id: string;
  pageContent: string;
  metadata: DocMetadata;
  terms: Record<string, number>;
  length: number;
}

function main() {
  console.log(`[Ingest] Reading corpus from: ${CORPUS_DIR}`);

  if (!fs.existsSync(CORPUS_DIR)) {
    console.error(`[Error] Corpus directory does not exist: ${CORPUS_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(CORPUS_DIR).filter(f => f.endsWith('.md')).sort();
  console.log(`[Ingest] Found ${files.length} markdown files`);

  const documents: IndexedDocument[] = [];
  const df: Record<string, number> = {};

  let chunkIndex = 0;

  for (const fileName of files) {
    const filePath = path.join(CORPUS_DIR, fileName);
    const rawContent = fs.readFileSync(filePath, 'utf-8');
    const { data, content } = matter(rawContent);

    const frontmatter = data as RawFrontmatter;
    const title = frontmatter.title || frontmatter.doc_title;
    if (!frontmatter.doc_id || !frontmatter.access_role || !title) {
      console.warn(`[Warning] Skipping ${fileName}: Missing required frontmatter`);
      continue;
    }

    // Split content by ## headings
    const sectionRegex = /(?:^|\n)##\s+([^\n]+)\n([\s\S]*?)(?=\n##\s+|$)/g;
    let match: RegExpExecArray | null;
    let sectionCount = 0;

    while ((match = sectionRegex.exec(content)) !== null) {
      const sectionTitle = match[1].trim();
      const sectionBody = match[2].trim();

      if (!sectionBody) continue;

      sectionCount++;
      const fullText = `${title} ${sectionTitle}\n${sectionBody}`;
      const tokens = tokenize(fullText);

      const terms: Record<string, number> = {};
      for (const t of tokens) {
        terms[t] = (terms[t] || 0) + 1;
      }

      const doc: IndexedDocument = {
        id: `chunk_${String(++chunkIndex).padStart(3, '0')}`,
        pageContent: sectionBody,
        metadata: {
          doc_id: frontmatter.doc_id,
          doc_title: title,
          section_title: sectionTitle,
          category: frontmatter.category || '기타',
          access_role: frontmatter.access_role,
          owner: frontmatter.owner || '사내',
          file_name: fileName,
        },
        terms,
        length: tokens.length,
      };

      documents.push(doc);

      const uniqueTerms = new Set(tokens);
      for (const t of uniqueTerms) {
        df[t] = (df[t] || 0) + 1;
      }
    }

    // Fallback if no ## headings
    if (sectionCount === 0 && content.trim().length > 0) {
      const fullText = `${title}\n${content.trim()}`;
      const tokens = tokenize(fullText);
      const terms: Record<string, number> = {};
      for (const t of tokens) {
        terms[t] = (terms[t] || 0) + 1;
      }

      const doc: IndexedDocument = {
        id: `chunk_${String(++chunkIndex).padStart(3, '0')}`,
        pageContent: content.trim(),
        metadata: {
          doc_id: frontmatter.doc_id,
          doc_title: title,
          section_title: title,
          category: frontmatter.category || '기타',
          access_role: frontmatter.access_role,
          owner: frontmatter.owner || '사내',
          file_name: fileName,
        },
        terms,
        length: tokens.length,
      };

      documents.push(doc);
      for (const t of new Set(tokens)) {
        df[t] = (df[t] || 0) + 1;
      }
    }
  }

  const N = documents.length;
  if (N === 0) {
    console.error('[Error] No documents generated!');
    process.exit(1);
  }

  const totalLength = documents.reduce((sum, c) => sum + c.length, 0);
  const avgdl = totalLength / N;

  const idf: Record<string, number> = {};
  for (const [term, freq] of Object.entries(df)) {
    idf[term] = Math.log((N - freq + 0.5) / (freq + 0.5) + 1);
  }

  const indexData = {
    version: '2.0.0',
    updated_at: new Date().toISOString(),
    total_docs: N,
    avgdl,
    df,
    idf,
    documents,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(indexData, null, 2), 'utf-8');

  console.log(`\n=== [Ingest Complete: LangChain Document Index] ===`);
  console.log(`- Total Files Processed: ${files.length}`);
  console.log(`- Total Documents Created: ${N}`);
  console.log(`- Vocabulary Size: ${Object.keys(df).length}`);
  console.log(`- Avg Token Length: ${avgdl.toFixed(1)} tokens`);
  console.log(`- Saved Index to: ${OUTPUT_PATH}`);
}

main();
