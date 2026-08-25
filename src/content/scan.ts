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
 * ponytail: 這是字面詞表，不做句法解析；誤標真的影響閱讀時再接 NLP parser。
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
    // 屬性和 isContentEditable 都看。jsdom 沒實作後者,瀏覽器則靠後者處理繼承來的可編輯狀態。
    const attr = el.getAttribute('contenteditable');
    if (attr !== null && attr !== 'false') return true;
    if (el.isContentEditable) return true;
    el = el.parentElement;
  }
  return false;
}

/**
 * 走訪文字節點並斷詞。
 *
 * 用 Intl.Segmenter 而不是 regex,因為它處理縮寫、連字號和 Unicode
 * 的規則跟瀏覽器選字一致,不用自己維護一套邊界規則。
 */
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

/** 取文字位移所在的那一句和前一句,跨行內元素也能正確計算。 */
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

/** 只要目前句的舊呼叫端不用知道上下文。 */
export function sentenceAround(node: Text, offsetInNode = 0): string {
  return sentenceContextAround(node, offsetInNode).sentence;
}
