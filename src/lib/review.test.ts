import { describe, expect, it } from 'vitest';
import { State } from 'ts-fsrs';
import { nextReview, restoreCard, storeCard, type StoredFsrsCard } from './review';

const DAY = 24 * 60 * 60 * 1000;
/** 2026-08-28 星期五 22:40，用來檢查跨日與午夜取整。 */
const NIGHT = new Date(2026, 7, 28, 22, 40).getTime();
const midnight = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);

const stored: StoredFsrsCard = {
  due: midnight(NIGHT),
  stability: 2.3,
  difficulty: 5.1,
  elapsed_days: 3,
  scheduled_days: 3,
  learning_steps: 0,
  reps: 1,
  lapses: 0,
  state: State.Review,
  last_review: NIGHT - 3 * DAY,
};

describe('nextReview', () => {
  it('沒有卡片時當作新卡，抓到了排得比又讓牠溜了遠', () => {
    const caught = nextReview(undefined, true, NIGHT)!;
    const escaped = nextReview(undefined, false, NIGHT)!;
    expect(caught.reps).toBe(1);
    expect(caught.due).toBeGreaterThan(escaped.due);
  });

  it('又讓牠溜了算一次失手，抓到了不算', () => {
    expect(nextReview(stored, true, NIGHT)!.lapses).toBe(0);
    expect(nextReview(stored, false, NIGHT)!.lapses).toBe(1);
  });

  it('關掉分鐘級 learning steps，同一晚不會再出同一張卡', () => {
    for (const remembered of [true, false]) {
      const card = nextReview(undefined, remembered, NIGHT)!;
      expect(card.learning_steps).toBe(0);
      expect(card.due).toBeGreaterThanOrEqual(midnight(NIGHT) + DAY);
    }
  });

  it('due 取整到當地午夜，last_review 保留作答時刻', () => {
    const card = nextReview(undefined, true, NIGHT)!;
    expect(card.due).toBe(midnight(card.due));
    expect(card.last_review).toBe(NIGHT);
  });

  it('晚上作答排到明天的卡，隔天白天就選得到', () => {
    const card = nextReview(undefined, false, NIGHT)!;
    expect(card.due).toBeLessThanOrEqual(new Date(2026, 7, 29, 9, 0).getTime());
  });

  it('卡片損壞時回傳 null，不偷偷重設成新卡', () => {
    expect(nextReview({ ...stored, stability: Number.NaN }, true, NIGHT)).toBeNull();
    expect(nextReview({ ...stored, due: Number.NaN }, true, NIGHT)).toBeNull();
    expect(nextReview({ ...stored, reps: -1 }, true, NIGHT)).toBeNull();
    expect(nextReview({ ...stored, state: 9 as State }, true, NIGHT)).toBeNull();
    expect(nextReview({ ...stored, stability: undefined } as unknown as StoredFsrsCard, true, NIGHT))
      .toBeNull();
  });

  it('超出 Date 範圍的時間戳不是有效卡片，finite 不等於有效時間', () => {
    // 1e20 是 finite number，但 new Date(1e20) 是 Invalid Date，算出來整張卡都是 NaN。
    expect(nextReview({ ...stored, last_review: 1e20 }, true, NIGHT)).toBeNull();
    expect(nextReview({ ...stored, due: 1e20 }, true, NIGHT)).toBeNull();
  });

  it('套件自己擋下的記憶狀態不會往外拋，改成可重試的 null', () => {
    // stability/difficulty 為 0 或負數，以及 last_review 比現在晚，ts-fsrs 會丟
    // FSRSValidationError。讓它冒出去會讓複習畫面卡在 busy，連錯誤訊息都沒有。
    expect(nextReview({ ...stored, stability: 0 }, true, NIGHT)).toBeNull();
    expect(nextReview({ ...stored, difficulty: -1 }, true, NIGHT)).toBeNull();
    expect(nextReview({ ...stored, last_review: NIGHT + DAY }, true, NIGHT)).toBeNull();
  });

  it('elapsed_days 缺少時仍是有效卡片，6.0 移除該欄不會讓既有卡片全壞掉', () => {
    const { elapsed_days: _drop, ...withoutElapsed } = stored;
    expect(nextReview(withoutElapsed, true, NIGHT)).not.toBeNull();
  });
});

describe('storeCard / restoreCard', () => {
  it('毫秒與 Date 之間來回轉換不掉欄位', () => {
    expect(storeCard(restoreCard(stored))).toEqual(stored);
  });

  it('沒複習過的新卡沒有 last_review', () => {
    const { last_review: _drop, ...fresh } = stored;
    expect(restoreCard(fresh).last_review).toBeUndefined();
    expect(storeCard(restoreCard(fresh)).last_review).toBeUndefined();
  });
});
