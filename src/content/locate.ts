export interface WordSpan {
  text: string;
  start: number;
  end: number;
}

const LETTER = /[a-zA-Z]/;

/** 從字元位移向兩側擴張，取出完整單字。 */
export function expandToWord(text: string, offset: number): WordSpan | null {
  if (offset < 0 || offset >= text.length) return null;
  if (!LETTER.test(text.charAt(offset))) return null;

  let start = offset;
  while (start > 0 && LETTER.test(text.charAt(start - 1))) start--;

  let end = offset;
  while (end < text.length && LETTER.test(text.charAt(end))) end++;

  return { text: text.slice(start, end), start, end };
}

/** 從座標找出單字；舊 Blink 退回 caretRangeFromPoint。 */
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

/** 取得座標下的文字位置，允許空白與標點供 S/D 使用。 */
export function textNodeAtPoint(x: number, y: number): Text | null {
  return textPositionAtPoint(x, y)?.node ?? null;
}

/** 取得 S/D 定位多句段落所需的文字節點位移。 */
export function textPositionAtPoint(
  x: number,
  y: number,
): { node: Text; offset: number } | null {
  const doc = document as any;
  let node: Node | null = null;
  let offset = 0;

  if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(x, y);
    node = pos?.offsetNode ?? null;
    offset = pos?.offset ?? 0;
  } else if (doc.caretRangeFromPoint) {
    const range = doc.caretRangeFromPoint(x, y);
    node = range?.startContainer ?? null;
    offset = range?.startOffset ?? 0;
  }

  return node?.nodeType === Node.TEXT_NODE ? { node: node as Text, offset } : null;
}
