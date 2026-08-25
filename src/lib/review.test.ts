import { describe, expect, it } from 'vitest';
import { maskPhrase, nextReview } from './review';

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

describe('maskPhrase', () => {
  it('不分大小寫遮住片語並保留句子', () => {
    expect(maskPhrase('We need to Roll Back now.', 'roll back'))
      .toBe('We need to ______ ______ now.');
  });

  it('句子找不到片語時保持原文', () => {
    expect(maskPhrase('Keep the service running.', 'roll back'))
      .toBe('Keep the service running.');
  });
});
