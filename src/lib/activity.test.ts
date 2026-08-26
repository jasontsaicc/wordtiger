import { describe, expect, it } from 'vitest';
import { groupActivity, localDay, monthCells } from './activity';

describe('學習足跡', () => {
  it('依本地日期合併同頁收藏，並建立含閏日的月曆', () => {
    const morning = new Date(2024, 1, 29, 9).getTime();
    const evening = new Date(2024, 1, 29, 18).getTime();
    const rows = groupActivity([
      { word: 'deploy', createdAt: morning, contexts: [
        { createdAt: morning, url: 'https://example.com/a', title: 'Guide' },
      ] },
      { word: 'rollback', createdAt: evening, contexts: [
        { createdAt: evening, url: 'https://example.com/a', title: 'Guide' },
      ] },
    ]);

    expect(rows).toEqual([{
      date: localDay(morning), newWords: ['deploy', 'rollback'],
      pages: [{
        url: 'https://example.com/a', title: 'Guide', words: ['deploy', 'rollback'],
      }],
    }]);
    expect(monthCells('2024-02').filter(Boolean)).toHaveLength(29);
  });
});
