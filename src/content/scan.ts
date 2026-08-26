export interface TokenHit {
  node: Text;
  start: number;
  end: number;
  text: string;
  isSentenceStart: boolean;
}

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT',
  'CODE', 'PRE', 'KBD', 'SAMP',
]);

// 保留在閱讀時最有助於看出句子骨架的常見連詞。
const COORDINATING_CONJUNCTIONS = new Set(['and', 'or', 'nor', 'but', 'yet']);
const CLAUSE_CONJUNCTIONS = new Set([
  'as', 'since', 'because', 'although', 'though', 'that', 'which', 'where', 'what',
  'who', 'whom', 'whose', 'why', 'when', 'how', 'while',
]);

export type ConjunctionKind = 'coordinating' | 'clause';

/**
 * ponytail: 這是字面詞表，不做句法解析；誤標造成可測干擾時再引入 NLP parser。
 */
export function conjunctionKind(word: string): ConjunctionKind | null {
  const normalized = word.toLowerCase();
  if (COORDINATING_CONJUNCTIONS.has(normalized)) return 'coordinating';
  if (CLAUSE_CONJUNCTIONS.has(normalized)) return 'clause';
  return null;
}

function shouldSkip(node: Text): boolean {
  let el = node.parentElement;
  while (el) {
    if (SKIP_TAGS.has(el.tagName)) return true;
    // 瀏覽器以 isContentEditable 處理繼承；jsdom 需檢查屬性。
    const attr = el.getAttribute('contenteditable');
    if (attr !== null && attr !== 'false') return true;
    if (el.isContentEditable) return true;
    el = el.parentElement;
  }
  return false;
}

/** 使用 Intl.Segmenter 取得 Unicode-aware 單字邊界。 */
export function collectTokens(root: Node): TokenHit[] {
  const segmenter = new Intl.Segmenter('en', { granularity: 'word' });
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const hits: TokenHit[] = [];

  let sentenceStartPending = true;
  let node = walker.nextNode() as Text | null;

  while (node) {
    if (shouldSkip(node)) {
      node = walker.nextNode() as Text | null;
      continue;
    }

    const text = node.data;
    for (const seg of segmenter.segment(text)) {
      if (!seg.isWordLike) {
        if (/[.!?]/.test(seg.segment)) sentenceStartPending = true;
        continue;
      }
      if (!/[a-zA-Z]/.test(seg.segment)) continue;

      hits.push({
        node,
        start: seg.index,
        end: seg.index + seg.segment.length,
        text: seg.segment,
        isSentenceStart: sentenceStartPending,
      });
      sentenceStartPending = false;
    }

    node = walker.nextNode() as Text | null;
  }

  return hits;
}

export interface SentenceContext {
  sentence: string;
  previous: string;
}

/** 取得文字位移所在句與前一句，並支援跨行內元素。 */
export function sentenceContextAround(node: Text, offsetInNode = 0): SentenceContext {
  const block = node.parentElement?.closest('p, li, td, h1, h2, h3, h4, div');
  if (!block) return { sentence: node.data.trim().slice(0, 300), previous: '' };

  const text = block.textContent ?? node.data;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let current = walker.nextNode() as Text | null;
  while (current && current !== node) {
    offset += current.data.length;
    current = walker.nextNode() as Text | null;
  }
  offset += Math.max(0, Math.min(offsetInNode, node.data.length));

  const parts = [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text)];
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!;
    if (offset >= part.index && offset < part.index + part.segment.length) {
      return {
        sentence: part.segment.trim().slice(0, 300),
        previous: index > 0 ? parts[index - 1]!.segment.trim().slice(0, 300) : '',
      };
    }
  }
  return { sentence: text.trim().slice(0, 300), previous: '' };
}

/** 僅回傳目前句子。 */
export function sentenceAround(node: Text, offsetInNode = 0): string {
  return sentenceContextAround(node, offsetInNode).sentence;
}
