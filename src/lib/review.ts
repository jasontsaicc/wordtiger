import { createEmptyCard, fsrs, Rating, State, type Card } from 'ts-fsrs';

/**
 * ts-fsrs `Card` 的可儲存形式：欄位同名，`Date` 換成毫秒整數。
 * IndexedDB、runtime message 與同步 JSON 因此都只搬 plain data。
 */
export interface StoredFsrsCard {
  due: number;
  stability: number;
  difficulty: number;
  /** ts-fsrs 已標記它在 6.0 移除，讀取時視為選填，升版當天既有卡片才不會全被判成損壞。 */
  elapsed_days?: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: State;
  last_review?: number;
}

/**
 * 使用者只在有空時打開，關掉分鐘級 learning steps，排程一律以天為尺度。
 * 其餘沿用套件預設權重與 90% requested retention，不自行實作公式。
 */
const scheduler = fsrs({
  enable_short_term: false,
  learning_steps: [],
  relearning_steps: [],
});

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** 從 IndexedDB 或 Supabase 讀出的卡片先驗證，損壞的不能餵給套件。 */
export function isStoredFsrsCard(value: unknown): value is StoredFsrsCard {
  if (typeof value !== 'object' || value === null) return false;
  const card = value as Record<string, unknown>;
  return finite(card.due)
    && finite(card.stability)
    && finite(card.difficulty)
    && finite(card.scheduled_days)
    && (card.elapsed_days == null || finite(card.elapsed_days))
    && (card.last_review == null || finite(card.last_review))
    && [card.reps, card.lapses, card.learning_steps].every((n) => finite(n) && n >= 0)
    && typeof card.state === 'number' && State[card.state] !== undefined;
}

export function restoreCard(stored: StoredFsrsCard): Card {
  return {
    ...stored,
    elapsed_days: stored.elapsed_days ?? 0,
    due: new Date(stored.due),
    last_review: stored.last_review == null ? undefined : new Date(stored.last_review),
  };
}

/**
 * `due` 往下取整到當地午夜，`last_review` 保留原時刻。
 * 晚上 22:40 作答排到「明天」，不取整的話隔天 21:00 打開還沒到期，畫面講的日期就跳票。
 * 取整只影響本機的到期判斷：`next()` 由 `last_review` 與當下時間算 elapsed days。
 */
export function storeCard(card: Card): StoredFsrsCard {
  return {
    ...card,
    due: new Date(card.due).setHours(0, 0, 0, 0),
    last_review: card.last_review?.getTime(),
  };
}

/**
 * 缺少卡片是合法新卡；卡片存在但損壞則回傳 null，由呼叫端停止寫入。
 * 偷偷重設會蓋掉同步或版本問題的證據。
 */
export function nextReview(
  stored: StoredFsrsCard | undefined,
  remembered: boolean,
  now = Date.now(),
): StoredFsrsCard | null {
  if (stored !== undefined && !isStoredFsrsCard(stored)) return null;
  const card = stored ? restoreCard(stored) : createEmptyCard(new Date(now));
  const rating = remembered ? Rating.Good : Rating.Again;
  return storeCard(scheduler.next(card, new Date(now), rating).card);
}
