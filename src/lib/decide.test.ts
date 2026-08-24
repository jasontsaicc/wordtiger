import { describe, it, expect } from 'vitest';
import { shouldHighlight, type DecideContext } from './decide';

const freq = { the: 1, deploy: 800, perplexing: 12000, run: 500, universities: 9000 };

function ctx(over: Partial<DecideContext> = {}): DecideContext {
  return {
    freq,
    marks: new Map(),
    threshold: 5000,
    isSentenceStart: false,
    ...over,
  };
}

describe('shouldHighlight', () => {
  it('排名優於閾值的字不高亮', () => {
    expect(shouldHighlight('deploy', ctx()).hit).toBe(false);
  });

  it('排名落後於閾值的字要高亮', () => {
    expect(shouldHighlight('perplexing', ctx()).hit).toBe(true);
  });

  it('完全不在詞頻表裡的字要高亮', () => {
    expect(shouldHighlight('kubernetes', ctx()).hit).toBe(true);
  });

  it('標記成 known 的字一律不高亮,即使排名落後', () => {
    const marks = new Map([['perplexing', 'known' as const]]);
    expect(shouldHighlight('perplexing', ctx({ marks })).hit).toBe(false);
  });

  it('標記成 unknown 的字一律高亮,即使排名很前面', () => {
    const marks = new Map([['deploy', 'unknown' as const]]);
    expect(shouldHighlight('deploy', ctx({ marks })).hit).toBe(true);
  });

  it('判定用的是還原後的原形', () => {
    const result = shouldHighlight('deployed', ctx());
    expect(result.lemma).toBe('deploy');
    expect(result.hit).toBe(false);
  });

  it('句中的大寫字視為專有名詞,不高亮', () => {
    expect(shouldHighlight('Kubernetes', ctx()).hit).toBe(false);
  });

  it('句首的大寫字仍照常判定', () => {
    expect(shouldHighlight('Kubernetes', ctx({ isSentenceStart: true })).hit).toBe(true);
  });

  it('少於三個字母的 token 不高亮', () => {
    expect(shouldHighlight('an', ctx()).hit).toBe(false);
  });

  it('marks 的 key 是原形,變化形也要命中', () => {
    const marks = new Map([['deploy', 'unknown' as const]]);
    expect(shouldHighlight('deploying', ctx({ marks })).hit).toBe(true);
  });
});
