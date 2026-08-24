import { describe, it, expect } from 'vitest';
import { expandToWord } from './locate';

describe('expandToWord', () => {
  it('從字中間的位移往兩側擴張到完整單字', () => {
    expect(expandToWord('We deploy today', 5)).toEqual({ text: 'deploy', start: 3, end: 9 });
  });

  it('位移落在單字開頭', () => {
    expect(expandToWord('We deploy today', 3)).toEqual({ text: 'deploy', start: 3, end: 9 });
  });

  it('位移落在空白時回傳 null', () => {
    expect(expandToWord('We deploy today', 2)).toBe(null);
  });

  it('位移落在標點時回傳 null', () => {
    expect(expandToWord('deploy, now', 6)).toBe(null);
  });

  it('處理字串開頭', () => {
    expect(expandToWord('deploy now', 0)).toEqual({ text: 'deploy', start: 0, end: 6 });
  });

  it('處理字串結尾', () => {
    expect(expandToWord('run now', 6)).toEqual({ text: 'now', start: 4, end: 7 });
  });

  it('位移超出範圍時回傳 null', () => {
    expect(expandToWord('run', 99)).toBe(null);
  });
});
