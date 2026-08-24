import { lemmatize } from './lemmatize';

export type WordStatus = 'unknown' | 'known';
export type HighlightTier = 'saved' | 'learning' | 'advanced' | 'rare';

export interface DecideContext {
  /** 單字小寫 -> 詞頻排名,1 最常見 */
  freq: Record<string, number>;
  /** 原形 -> 使用者標記。沒有記錄代表交給詞頻決定 */
  marks: Map<string, WordStatus>;
  /** 排名落後於這個數字的字視為生詞 */
  threshold: number;
  /** 這個 token 是不是句子的第一個字 */
  isSentenceStart: boolean;
}

export interface Decision {
  hit: boolean;
  lemma: string;
  tier: HighlightTier | null;
}

/**
 * 判定一個 token 該不該高亮。
 *
 * 優先序:使用者標記 > 專有名詞排除 > 詞頻閾值。
 * 使用者標記永遠贏,這是「words 表只記錄例外」這個設計的直接後果。
 */
export function shouldHighlight(token: string, ctx: DecideContext): Decision {
  const lemma = lemmatize(token, (w) => w in ctx.freq);

  if (lemma.length < 3) return { hit: false, lemma, tier: null };

  const mark = ctx.marks.get(lemma);
  if (mark === 'unknown') return { hit: true, lemma, tier: 'saved' };
  if (mark === 'known') return { hit: false, lemma, tier: null };

  // 句中的首字母大寫,幾乎都是人名地名產品名。高亮它們只會製造噪音。
  const isCapitalized = token[0] === token[0]?.toUpperCase()
    && token[0] !== token[0]?.toLowerCase();
  if (isCapitalized && !ctx.isSentenceStart) return { hit: false, lemma, tier: null };

  const rank = ctx.freq[lemma];
  const hit = rank === undefined || rank > ctx.threshold;
  if (!hit) return { hit: false, lemma, tier: null };
  // 三層跟著程度移動：門檻後 50%、再後 100%，更後面的字通常不值得優先背。
  const tier: HighlightTier = rank === undefined || rank > ctx.threshold * 2.5
    ? 'rare'
    : rank > ctx.threshold * 1.5
      ? 'advanced'
      : 'learning';
  return { hit: true, lemma, tier };
}
