import { conjunctionKind, type ConjunctionKind, type TokenHit } from './scan';
import { shouldHighlight, type DecideContext, type HighlightTier } from '../lib/decide';

export interface PaintRanges {
  tiers: Record<HighlightTier, Range[]>;
  conjunctions: Record<ConjunctionKind, Range[]>;
}

/**
 * 把 token 分到各層與連詞的 Range 桶裡。
 *
 * 抽出來是為了能測。呼叫端只負責把結果交給 CSS.highlights。
 */
export function buildRanges(
  tokens: TokenHit[],
  ctx: Omit<DecideContext, 'isSentenceStart'>,
  markConjunctions: boolean,
): PaintRanges {
  const tiers: Record<HighlightTier, Range[]> = {
    saved: [], learning: [], advanced: [], rare: [],
  };
  const conjunctions: Record<ConjunctionKind, Range[]> = {
    coordinating: [], clause: [],
  };

  for (const hit of tokens) {
    const decision = shouldHighlight(hit.text, { ...ctx, isSentenceStart: hit.isSentenceStart });
    const conjunction = markConjunctions ? conjunctionKind(hit.text) : null;
    if (!decision.hit && !conjunction) continue;

    // token 可能比目前的文字節點舊。setStart 超出長度會丟 IndexSizeError,
    // 那會讓整批高亮一起畫不出來,所以這裡跳過而不是讓它炸。
    if (hit.end > hit.node.data.length) continue;

    const range = document.createRange();
    range.setStart(hit.node, hit.start);
    range.setEnd(hit.node, hit.end);
    if (decision.hit) tiers[decision.tier!].push(range);
    if (conjunction) conjunctions[conjunction].push(range);
  }

  return { tiers, conjunctions };
}
