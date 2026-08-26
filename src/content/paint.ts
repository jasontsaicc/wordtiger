import { conjunctionKind, type ConjunctionKind, type TokenHit } from './scan';
import { shouldHighlight, type DecideContext, type HighlightTier } from '../lib/decide';

export interface PaintRanges {
  tiers: Record<HighlightTier, Range[]>;
  conjunctions: Record<ConjunctionKind, Range[]>;
}

/** 將 tokens 分配至詞頻層級與連詞 Range。 */
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

    // DOM 變更可能使快取 token 越界；跳過以保留其他高亮。
    if (hit.end > hit.node.data.length) continue;

    const range = document.createRange();
    range.setStart(hit.node, hit.start);
    range.setEnd(hit.node, hit.end);
    if (decision.hit) tiers[decision.tier!].push(range);
    if (conjunction) conjunctions[conjunction].push(range);
  }

  return { tiers, conjunctions };
}
