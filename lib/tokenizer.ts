/**
 * Korean hybrid tokenizer: word-level tokens + character bi-grams
 * Designed for Korean text retrieval without external morphological analyzer dependencies.
 */
export function tokenize(text: string): string[] {
  if (!text) return [];

  // Normalize: lower case and clean special punctuation
  const clean = text
    .toLowerCase()
    .replace(/[^\w\s가-힣0-9\-_]/g, ' ')
    .trim();

  const words = clean.split(/\s+/).filter(w => w.length > 0);
  const tokens: string[] = [];

  for (const word of words) {
    // 1. Add the full word token
    tokens.push(word);

    // 2. If it contains Korean characters and length >= 2, extract character bi-grams
    const isKorean = /[가-힣]/.test(word);
    if (isKorean && word.length >= 2) {
      for (let i = 0; i < word.length - 1; i++) {
        tokens.push(word.slice(i, i + 2));
      }
    }
    
    // 3. For words with 3+ Korean characters, also extract tri-grams if helpful
    if (isKorean && word.length >= 3) {
      for (let i = 0; i < word.length - 2; i++) {
        tokens.push(word.slice(i, i + 3));
      }
    }
  }

  return tokens;
}
