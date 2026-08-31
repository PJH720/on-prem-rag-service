import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { tokenize } from '../lib/tokenizer';
import { BM25Index, Chunk, DocFrontmatter } from '../lib/types';

const CORPUS_DIR = path.join(process.cwd(), 'data', 'corpus');
const OUTPUT_PATH = path.join(process.cwd(), 'data', 'index.json');

function main() {
  console.log(`[Ingest] Reading corpus from: ${CORPUS_DIR}`);

  if (!fs.existsSync(CORPUS_DIR)) {
    console.error(`[Error] Corpus directory does not exist: ${CORPUS_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(CORPUS_DIR).filter(f => f.endsWith('.md')).sort();
  console.log(`[Ingest] Found ${files.length} markdown files`);

  const chunks: Chunk[] = [];
  const df: Record<string, number> = {};

  let chunkIndex = 0;

  for (const fileName of files) {
    const filePath = path.join(CORPUS_DIR, fileName);
    const rawContent = fs.readFileSync(filePath, 'utf-8');
    const { data, content } = matter(rawContent);

    const frontmatter = data as Partial<DocFrontmatter>;
    if (!frontmatter.doc_id || !frontmatter.access_role || !frontmatter.title) {
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
      const fullText = `${frontmatter.title} ${sectionTitle}\n${sectionBody}`;
      const tokens = tokenize(fullText);

      const terms: Record<string, number> = {};
      for (const t of tokens) {
        terms[t] = (terms[t] || 0) + 1;
      }

      const chunk: Chunk = {
        id: `chunk_${String(++chunkIndex).padStart(3, '0')}`,
        doc_id: frontmatter.doc_id,
        doc_title: frontmatter.title,
        file_name: fileName,
        category: frontmatter.category || '기타',
        access_role: frontmatter.access_role,
        owner: frontmatter.owner || '사내',
        section_title: sectionTitle,
        content: sectionBody,
        terms,
        length: tokens.length,
      };

      chunks.push(chunk);

      // Update DF (Document Frequency in term count across chunks)
      const uniqueTerms = new Set(tokens);
      for (const t of uniqueTerms) {
        df[t] = (df[t] || 0) + 1;
      }
    }

    // If no ## headings found, use the entire document as a chunk
    if (sectionCount === 0 && content.trim().length > 0) {
      const fullText = `${frontmatter.title}\n${content.trim()}`;
      const tokens = tokenize(fullText);
      const terms: Record<string, number> = {};
      for (const t of tokens) {
        terms[t] = (terms[t] || 0) + 1;
      }

      const chunk: Chunk = {
        id: `chunk_${String(++chunkIndex).padStart(3, '0')}`,
        doc_id: frontmatter.doc_id,
        doc_title: frontmatter.title,
        file_name: fileName,
        category: frontmatter.category || '기타',
        access_role: frontmatter.access_role,
        owner: frontmatter.owner || '사내',
        section_title: frontmatter.title,
        content: content.trim(),
        terms,
        length: tokens.length,
      };

      chunks.push(chunk);
      for (const t of new Set(tokens)) {
        df[t] = (df[t] || 0) + 1;
      }
    }
  }

  const N = chunks.length;
  if (N === 0) {
    console.error('[Error] No chunks generated!');
    process.exit(1);
  }

  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const avgdl = totalLength / N;

  // Calculate IDF for each term: ln((N - df + 0.5) / (df + 0.5) + 1)
  const idf: Record<string, number> = {};
  for (const [term, freq] of Object.entries(df)) {
    idf[term] = Math.log((N - freq + 0.5) / (freq + 0.5) + 1);
  }

  const indexData: BM25Index = {
    version: '1.0.0',
    updated_at: new Date().toISOString(),
    total_docs: N,
    avgdl,
    df,
    idf,
    chunks,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(indexData, null, 2), 'utf-8');

  console.log(`\n=== [Ingest Complete] ===`);
  console.log(`- Total Files Processed: ${files.length}`);
  console.log(`- Total Chunks Created : ${N}`);
  console.log(`- Vocabulary Size (Terms): ${Object.keys(df).length}`);
  console.log(`- Avg Chunk Token Length: ${avgdl.toFixed(1)} tokens`);
  console.log(`- Saved Index to: ${OUTPUT_PATH} (${(fs.statSync(OUTPUT_PATH).size / 1024).toFixed(1)} KB)`);
}

main();
