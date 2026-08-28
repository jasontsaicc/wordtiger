import { lemmatize } from './lemmatize';

export type WordStatus = 'unknown' | 'known';
export type HighlightTier = 'saved' | 'learning' | 'advanced' | 'rare';

export interface DecideContext {
  /** 小寫單字對應詞頻排名；1 最常見。 */
  freq: Record<string, number>;
  /** 原形對應使用者標記；未記錄時由詞頻決定。 */
  marks: Map<string, WordStatus>;
  /** 詞頻排名落後於此門檻的字視為生詞。 */
  threshold: number;
  /** 此 token 是否為句首字。 */
  isSentenceStart: boolean;
}

export interface Decision {
  hit: boolean;
  lemma: string;
  tier: HighlightTier | null;
}

/** 優先序：使用者標記、專有名詞排除、詞頻門檻。 */
export function shouldHighlight(token: string, ctx: DecideContext): Decision {
  const rankOf = (word: string) => Object.hasOwn(ctx.freq, word) ? ctx.freq[word] : undefined;
  const lemma = lemmatize(token, rankOf);

  if (lemma.length < 3) return { hit: false, lemma, tier: null };

  const mark = ctx.marks.get(lemma);
  if (mark === 'unknown') return { hit: true, lemma, tier: 'saved' };
  if (mark === 'known') return { hit: false, lemma, tier: null };

  // 排除非句首大寫詞，避免人名、地名與產品名噪音。
  const isCapitalized = token[0] === token[0]?.toUpperCase()
    && token[0] !== token[0]?.toLowerCase();
  if (isCapitalized && !ctx.isSentenceStart) return { hit: false, lemma, tier: null };

  const rank = rankOf(lemma);
  // 詞表外多為網址、品牌或領域術語，不自動視為生詞。
  if (rank === undefined || rank <= ctx.threshold) return { hit: false, lemma, tier: null };
  // 色階相對於使用者門檻分為 1.5 倍與 2.5 倍。
  const tier: HighlightTier = rank > ctx.threshold * 2.5
    ? 'rare'
    : rank > ctx.threshold * 1.5
      ? 'advanced'
      : 'learning';
  return { hit: true, lemma, tier };
}
