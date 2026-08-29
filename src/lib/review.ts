import { createEmptyCard, fsrs, Rating, State, type Card } from 'ts-fsrs';
import type { WordStatus } from './decide';

/** 排到 30 天以上就算穩定：複習畫面給「已經馴服」，總表顯示「漸漸穩定」。 */
export const MASTER_INTERVAL_DAYS = 30;

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

/** JS Date 能表示的毫秒上限。1e20 是 finite 卻是 Invalid Date，整張卡會算成 NaN。 */
const MAX_TIMESTAMP = 8.64e15;
const timestamp = (value: unknown): value is number =>
  finite(value) && Math.abs(value) <= MAX_TIMESTAMP;

/** 從 IndexedDB 或 Supabase 讀出的卡片先驗證，損壞的不能餵給套件。 */
export function isStoredFsrsCard(value: unknown): value is StoredFsrsCard {
  if (typeof value !== 'object' || value === null) return false;
  const card = value as Record<string, unknown>;
  return timestamp(card.due)
    && finite(card.stability)
    && finite(card.difficulty)
    && finite(card.scheduled_days)
    && (card.elapsed_days == null || finite(card.elapsed_days))
    && (card.last_review == null || timestamp(card.last_review))
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
 *
 * 型別驗證擋不掉全部：stability 或 difficulty 為 0、負數，或 last_review 比現在晚
 * （多裝置時鐘不同步就會發生），ts-fsrs 會丟 FSRSValidationError。讓它冒到 UI 只會
 * 讓畫面卡在 busy，連錯誤訊息都沒有，所以一律收斂成同一個可重試的 null。
 */
export function nextReview(
  stored: StoredFsrsCard | undefined,
  remembered: boolean,
  now = Date.now(),
): StoredFsrsCard | null {
  if (stored !== undefined && !isStoredFsrsCard(stored)) return null;
  const card = stored ? restoreCard(stored) : createEmptyCard(new Date(now));
  const rating = remembered ? Rating.Good : Rating.Again;
  try {
    return storeCard(scheduler.next(card, new Date(now), rating).card);
  } catch {
    return null;
  }
}

/**
 * 可信的到期時間；缺少或損壞時沒有。
 * 直接讀 `fsrsCard.due` 會讓 due 是 NaN 的卡片永遠落選，等於靜靜消失，
 * 使用者也就永遠看不到規格要求的可重試錯誤。損壞的卡片一律當作可出題。
 */
export function dueAt(card: StoredFsrsCard | undefined): number | undefined {
  return isStoredFsrsCard(card) ? card.due : undefined;
}

/** 出題需要可核對的答案材料：一律要 AI 詞典，片語另外要來源語境。 */
export function canAnswer(word: string, hasDefinition: boolean, hasContext: boolean): boolean {
  return hasDefinition && (hasContext || !/\s/.test(word));
}

export type WordProgress =
  | 'excluded' | 'mastered' | 'needsLookup' | 'fresh' | 'due' | 'stable' | 'scheduled';

/**
 * 總表的學習狀態。規則會重疊，取第一個成立的，順序是規格的一部分。
 * 選題與總表共用這裡的判斷，總表的數字才會跟實際題數一致。
 */
export function wordProgress(
  row: {
    word: string;
    status: WordStatus;
    collectedAt?: number | null;
    fsrsCard?: StoredFsrsCard;
  },
  material: { hasDefinition: boolean; hasContext: boolean },
  now = Date.now(),
): WordProgress {
  // 按 X 排除的字從來不是卡片，不能灌進「已馴服」的數字。
  if (row.status === 'known') return row.collectedAt == null ? 'excluded' : 'mastered';
  if (!canAnswer(row.word, material.hasDefinition, material.hasContext)) return 'needsLookup';
  if (row.fsrsCard === undefined) return 'fresh';
  const due = dueAt(row.fsrsCard);
  if (due === undefined || due <= now) return 'due';
  return row.fsrsCard.scheduled_days >= MASTER_INTERVAL_DAYS ? 'stable' : 'scheduled';
}
