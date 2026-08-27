import { describe, expect, it } from 'vitest';
import { groupActivity, localDay, monthCells } from './activity';

describe('學習足跡', () => {
  it('依本地日期合併同頁收藏，並建立含閏日的月曆', () => {
    const morning = new Date(2024, 1, 29, 9).getTime();
    const evening = new Date(2024, 1, 29, 18).getTime();
    const rows = groupActivity([
      { word: 'deploy', status: 'unknown', createdAt: morning, contexts: [
        { createdAt: morning, url: 'https://example.com/a', title: 'Guide' },
      ] },
      { word: 'rollback', status: 'unknown', createdAt: evening, contexts: [
        { createdAt: evening, url: 'https://example.com/a', title: 'Guide' },
      ] },
    ]);

    expect(rows).toEqual([{
      date: localDay(morning), newWords: ['deploy', 'rollback'],
      pages: [{
        url: 'https://example.com/a', title: 'Guide', words: ['deploy', 'rollback'],
      }],
      reviews: [],
    }]);
    expect(monthCells('2024-02').filter(Boolean)).toHaveLength(29);
  });

  it('標成已馴服的字不算新收藏，只按 X 排除生詞不會產生足跡', () => {
    const now = new Date(2024, 1, 29, 9).getTime();
    const rows = groupActivity([
      { word: 'the', status: 'known', createdAt: now, contexts: [] },
      { word: 'deploy', status: 'unknown', createdAt: now, contexts: [] },
    ]);

    expect(rows).toEqual([{
      date: localDay(now), newWords: ['deploy'], pages: [], reviews: [],
    }]);
  });

  it('已馴服但收藏過的字保留來源文章', () => {
    const now = new Date(2024, 1, 29, 9).getTime();
    const rows = groupActivity([
      { word: 'deploy', status: 'known', createdAt: now, contexts: [
        { createdAt: now, url: 'https://example.com/a', title: 'Guide' },
      ] },
    ]);

    expect(rows[0]!.newWords).toEqual([]);
    expect(rows[0]!.pages).toEqual([
      { url: 'https://example.com/a', title: 'Guide', words: ['deploy'] },
    ]);
  });

  it('依日期統計每個字的練習次數與抓到次數', () => {
    const day1 = new Date(2024, 1, 28, 21).getTime();
    const day2 = new Date(2024, 1, 29, 21).getTime();
    const rows = groupActivity([], [
      { word: 'deploy', remembered: true, at: day1 },
      { word: 'deploy', remembered: false, at: day1 },
      { word: 'roll back', remembered: true, at: day1 },
      { word: 'deploy', remembered: true, at: day2 },
    ]);

    expect(rows.map((row) => row.date)).toEqual([localDay(day2), localDay(day1)]);
    expect(rows[1]!.reviews).toEqual([
      { word: 'deploy', caught: 1, total: 2 },
      { word: 'roll back', caught: 1, total: 1 },
    ]);
    expect(rows[0]!.reviews).toEqual([{ word: 'deploy', caught: 1, total: 1 }]);
  });
});
