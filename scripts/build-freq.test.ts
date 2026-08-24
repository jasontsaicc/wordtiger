import { describe, it, expect } from 'vitest';
import { buildFreqMap } from './build-freq';

describe('buildFreqMap', () => {
  it('把已排序的 entry 陣列轉成 rank 對照表,rank 從 1 起算', () => {
    const entries = [
      { word: 'you', count: 2134713 },
      { word: 'I', count: 2038529 },
      { word: 'the', count: 1501908 },
    ];
    expect(buildFreqMap(entries, 10)).toEqual({ you: 1, i: 2, the: 3 });
  });

  it('key 一律轉小寫', () => {
    const entries = [{ word: 'NASA', count: 100 }];
    expect(buildFreqMap(entries, 10)).toEqual({ nasa: 1 });
  });

  it('同一個字重複出現時保留較前面的 rank', () => {
    const entries = [
      { word: 'It', count: 500 },
      { word: 'it', count: 400 },
    ];
    expect(buildFreqMap(entries, 10)).toEqual({ it: 1 });
  });

  it('只保留前 limit 筆', () => {
    const entries = [
      { word: 'a', count: 3 },
      { word: 'b', count: 2 },
      { word: 'c', count: 1 },
    ];
    expect(buildFreqMap(entries, 2)).toEqual({ a: 1, b: 2 });
  });

  it('跳過含非字母字元的 entry', () => {
    const entries = [
      { word: 'well-known', count: 100 },
      { word: "don't", count: 90 },
      { word: 'ok', count: 80 },
    ];
    expect(buildFreqMap(entries, 10)).toEqual({ ok: 1 });
  });
});
