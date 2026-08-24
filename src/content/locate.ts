export interface WordSpan {
  text: string;
  start: number;
  end: number;
}

const LETTER = /[a-zA-Z]/;

/** 從一個字元位移往兩側擴張,取出完整單字 */
export function expandToWord(text: string, offset: number): WordSpan | null {
  if (offset < 0 || offset >= text.length) return null;
  if (!LETTER.test(text.charAt(offset))) return null;

  let start = offset;
  while (start > 0 && LETTER.test(text.charAt(start - 1))) start--;

  let end = offset;
  while (end < text.length && LETTER.test(text.charAt(end))) end++;

  return { text: text.slice(start, end), start, end };
}

/**
 * 從畫面座標找出滑鼠底下的單字。
 *
 * caretPositionFromPoint 是標準 API 且支援 Shadow DOM。
 * caretRangeFromPoint 是舊 Blink 的非標準版本,留著當 fallback。
 */
export function wordAtPoint(
  x: number,
  y: number,
): { node: Text; span: WordSpan } | null {
  let node: Node | null = null;
  let offset = 0;

  const doc = document as any;
  if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(x, y);
    if (!pos) return null;
    node = pos.offsetNode;
    offset = pos.offset;
  } else if (doc.caretRangeFromPoint) {
    const range = doc.caretRangeFromPoint(x, y);
    if (!range) return null;
    node = range.startContainer;
    offset = range.startOffset;
  }

  if (!node || node.nodeType !== Node.TEXT_NODE) return null;

  const textNode = node as Text;
  const span = expandToWord(textNode.data, offset);
  return span ? { node: textNode, span } : null;
}

/**
 * 只取座標底下的文字節點,不要求一定落在字母上。
 * S 和 D 針對整句,滑鼠停在空白或標點上時也該有反應。
 */
export function textNodeAtPoint(x: number, y: number): Text | null {
  const doc = document as any;
  let node: Node | null = null;

  if (doc.caretPositionFromPoint) {
    node = doc.caretPositionFromPoint(x, y)?.offsetNode ?? null;
  } else if (doc.caretRangeFromPoint) {
    node = doc.caretRangeFromPoint(x, y)?.startContainer ?? null;
  }

  return node?.nodeType === Node.TEXT_NODE ? (node as Text) : null;
}
