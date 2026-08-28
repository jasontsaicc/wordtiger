import { describe, it, expect } from 'vitest';
import { lemmatize } from './lemmatize';

const DICT = new Set([
  'run', 'box', 'study', 'deploy', 'university', 'child', 'be',
  'go', 'happy', 'use', 'stop', 'carry', 'is', 'universities',
]);
const rankOf = (w: string) => DICT.has(w) ? 1000 : undefined;

describe('lemmatize', () => {
  it('原形直接回傳', () => {
    expect(lemmatize('run', rankOf)).toBe('run');
  });

  it('普通單字不能命中 Object prototype', () => {
    expect(lemmatize('constructor', () => undefined)).toBe('constructor');
  });

  it('去複數 -s', () => {
    expect(lemmatize('runs', rankOf)).toBe('run');
  });

  it('去複數 -es', () => {
    expect(lemmatize('boxes', rankOf)).toBe('box');
  });

  it('非嘶音字尾的 -es 只去 s，不多刪一個字母', () => {
    const ranks: Record<string, number> = {
      notes: 1200, note: 1500, not: 20,
      boxes: 3000, box: 2000,
      wishes: 2500, wish: 1800,
    };
    const ranked = (w: string) => ranks[w];
    expect(lemmatize('notes', ranked)).toBe('note');
    expect(lemmatize('boxes', ranked)).toBe('box');
    expect(lemmatize('wishes', ranked)).toBe('wish');
  });

  it('-ies 還原成 -y', () => {
    expect(lemmatize('studies', rankOf)).toBe('study');
  });

  it('去 -ed', () => {
    expect(lemmatize('deployed', rankOf)).toBe('deploy');
  });

  it('去 -ing', () => {
    expect(lemmatize('deploying', rankOf)).toBe('deploy');
  });

  it('還原重複子音 -ing', () => {
    expect(lemmatize('stopping', rankOf)).toBe('stop');
  });

  it('還原被吃掉的 e', () => {
    expect(lemmatize('using', rankOf)).toBe('use');
  });

  it('不規則變化查表', () => {
    expect(lemmatize('children', rankOf)).toBe('child');
    expect(lemmatize('went', rankOf)).toBe('go');
    expect(lemmatize('was', rankOf)).toBe('be');
  });

  it('候選不在詞典裡就退回原字', () => {
    // university 的 -ies 反向規則會產生不存在的 universit。
    expect(lemmatize('university', rankOf)).toBe('university');
  });

  it('不規則表優先於原字詞典命中', () => {
    expect(lemmatize('is', rankOf)).toBe('be');
  });

  it('大寫轉小寫', () => {
    expect(lemmatize('Runs', rankOf)).toBe('run');
  });

  it('字根本身也是常見字時,仍優先採用補回 e 的候選', () => {
    // 補回 e 的候選必須優先，避免 using 被還原為 us。
    const withUs = (w: string) => DICT.has(w) || w === 'us' || w === 'hop' || w === 'hope'
      ? 1000 : undefined;
    expect(lemmatize('using', withUs)).toBe('use');
    expect(lemmatize('hoping', withUs)).toBe('hope');
  });

  it('原字比候選常見時保留原字', () => {
    const ranks: Record<string, number> = { morning: 262, morn: 18600 };
    expect(lemmatize('morning', (w) => ranks[w])).toBe('morning');
  });

  it('原形只比變化形稍少見時仍還原', () => {
    const ranks: Record<string, number> = {
      building: 759, build: 1354, allowed: 1435, allow: 1447,
    };
    expect(lemmatize('building', (w) => ranks[w])).toBe('build');
    expect(lemmatize('allowed', (w) => ranks[w])).toBe('allow');
  });

  it('原形以 ss 結尾時不截成另一個常見字', () => {
    const ranks: Record<string, number> = {
      hissing: 14340, hiss: 18265, his: 73,
      dissed: 23396, diss: 26359, dis: 13981,
    };
    expect(lemmatize('hissing', (w) => ranks[w])).toBe('hiss');
    expect(lemmatize('dissed', (w) => ranks[w])).toBe('diss');
  });

  it('重複子音先還原再考慮補 e', () => {
    const ranks: Record<string, number> = {
      programming: 5000, program: 1000, programme: 3000, slam: 9000,
    };
    const ranked = (w: string) => ranks[w];
    expect(lemmatize('programming', ranked)).toBe('program');
    expect(lemmatize('slammed', ranked)).toBe('slam');
  });

  it('原形本來以雙子音結尾時不多刪一個字母', () => {
    const ranks: Record<string, number> = { added: 5000, add: 1000, ad: 500 };
    expect(lemmatize('added', (w) => ranks[w])).toBe('add');
  });

  it('太短的字不處理', () => {
    expect(lemmatize('as', rankOf)).toBe('as');
  });
});
