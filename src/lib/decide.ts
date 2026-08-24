import { lemmatize } from './lemmatize';

export type WordStatus = 'unknown' | 'known';

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
}

/**
 * 判定一個 token 該不該高亮。
 *
 * 優先序:使用者標記 > 專有名詞排除 > 詞頻閾值。
 * 使用者標記永遠贏,這是「words 表只記錄例外」這個設計的直接後果。
 */
export function shouldHighlight(token: string, ctx: DecideContext): Decision {
  const lemma = lemmatize(token, (w) => w in ctx.freq);

  if (lemma.length < 3) return { hit: false, lemma };

  const mark = ctx.marks.get(lemma);
  if (mark === 'unknown') return { hit: true, lemma };
  if (mark === 'known') return { hit: false, lemma };

  // 句中的首字母大寫,幾乎都是人名地名產品名。高亮它們只會製造噪音。
  const isCapitalized = token[0] === token[0]?.toUpperCase()
    && token[0] !== token[0]?.toLowerCase();
  if (isCapitalized && !ctx.isSentenceStart) return { hit: false, lemma };

  const rank = ctx.freq[lemma];
  const hit = rank === undefined || rank > ctx.threshold;
  return { hit, lemma };
}
