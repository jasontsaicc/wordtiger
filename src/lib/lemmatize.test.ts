import { describe, it, expect } from 'vitest';
import { lemmatize } from './lemmatize';

const DICT = new Set([
  'run', 'box', 'study', 'deploy', 'university', 'child', 'be',
  'go', 'happy', 'use', 'stop', 'carry', 'is', 'universities',
]);
const inDict = (w: string) => DICT.has(w);

describe('lemmatize', () => {
  it('原形直接回傳', () => {
    expect(lemmatize('run', inDict)).toBe('run');
  });

  it('去複數 -s', () => {
    expect(lemmatize('runs', inDict)).toBe('run');
  });

  it('去複數 -es', () => {
    expect(lemmatize('boxes', inDict)).toBe('box');
  });

  it('-ies 還原成 -y', () => {
    expect(lemmatize('studies', inDict)).toBe('study');
  });

  it('去 -ed', () => {
    expect(lemmatize('deployed', inDict)).toBe('deploy');
  });

  it('去 -ing', () => {
    expect(lemmatize('deploying', inDict)).toBe('deploy');
  });

  it('還原重複子音 -ing', () => {
    expect(lemmatize('stopping', inDict)).toBe('stop');
  });

  it('還原被吃掉的 e', () => {
    expect(lemmatize('using', inDict)).toBe('use');
  });

  it('不規則變化查表', () => {
    expect(lemmatize('children', inDict)).toBe('child');
    expect(lemmatize('went', inDict)).toBe('go');
    expect(lemmatize('was', inDict)).toBe('be');
  });

  it('候選不在詞典裡就退回原字', () => {
    // university 去 -y 加 -ies 的反向規則會產生 universit,不在詞典
    expect(lemmatize('university', inDict)).toBe('university');
  });

  it('原字本身在詞典時,優先採用原字不做還原', () => {
    // is 是 be 的變化,但 is 本身在詞典裡,仍應還原成 be(不規則表優先)
    expect(lemmatize('is', inDict)).toBe('be');
  });

  it('大寫轉小寫', () => {
    expect(lemmatize('Runs', inDict)).toBe('run');
  });

  it('字根本身也是常見字時,仍優先採用補回 e 的候選', () => {
    // 真實詞頻表裡 us 存在。先試 us 會讓 using 還原成 us,所以 use 必須排在前面。
    const withUs = (w: string) => DICT.has(w) || w === 'us' || w === 'hop' || w === 'hope';
    expect(lemmatize('using', withUs)).toBe('use');
    expect(lemmatize('hoping', withUs)).toBe('hope');
  });

  it('太短的字不處理', () => {
    expect(lemmatize('as', inDict)).toBe('as');
  });
});
