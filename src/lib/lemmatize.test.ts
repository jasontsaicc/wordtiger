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
    // university 的 -ies 反向規則會產生不存在的 universit。
    expect(lemmatize('university', inDict)).toBe('university');
  });

  it('不規則表優先於原字詞典命中', () => {
    expect(lemmatize('is', inDict)).toBe('be');
  });

  it('大寫轉小寫', () => {
    expect(lemmatize('Runs', inDict)).toBe('run');
  });

  it('字根本身也是常見字時,仍優先採用補回 e 的候選', () => {
    // 補回 e 的候選必須優先，避免 using 被還原為 us。
    const withUs = (w: string) => DICT.has(w) || w === 'us' || w === 'hop' || w === 'hope';
    expect(lemmatize('using', withUs)).toBe('use');
    expect(lemmatize('hoping', withUs)).toBe('hope');
  });

  it('太短的字不處理', () => {
    expect(lemmatize('as', inDict)).toBe('as');
  });
});
