import { describe, expect, it } from 'vitest';
import { nextReview } from './review';

const DAY = 24 * 60 * 60 * 1000;

describe('nextReview', () => {
  it('記得時依 1、3、7、14、30 天逐步延長', () => {
    expect(nextReview(0, true, 100)).toEqual({ reviewStep: 1, reviewDueAt: 100 + DAY });
    expect(nextReview(1, true, 100)).toEqual({ reviewStep: 2, reviewDueAt: 100 + 3 * DAY });
    expect(nextReview(4, true, 100)).toEqual({ reviewStep: 5, reviewDueAt: 100 + 30 * DAY });
    expect(nextReview(5, true, 100)).toEqual({ reviewStep: 5, reviewDueAt: 100 + 30 * DAY });
  });

  it('還是攔路虎時回到第一階並排到明天', () => {
    expect(nextReview(4, false, 100)).toEqual({ reviewStep: 0, reviewDueAt: 100 + DAY });
  });
});
