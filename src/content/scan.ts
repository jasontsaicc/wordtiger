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
