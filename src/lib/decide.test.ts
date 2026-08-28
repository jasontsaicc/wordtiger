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

  it('詞頻表外的網址、品牌或領域術語不自動高亮', () => {
    expect(shouldHighlight('github', ctx())).toMatchObject({ hit: false, tier: null });
  });

  it('詞頻查詢不能把 Object prototype 當成詞表項目', () => {
    expect(shouldHighlight('constructors', ctx({ freq: {} }))).toEqual({
      hit: false, lemma: 'constructors', tier: null,
    });
  });

  it('標記成 known 的字一律不高亮,即使排名落後', () => {
    const marks = new Map([['perplexing', 'known' as const]]);
    expect(shouldHighlight('perplexing', ctx({ marks })).hit).toBe(false);
  });

  it('標記成 unknown 的字一律高亮,即使排名很前面', () => {
    const marks = new Map([
      ['deploy', 'unknown' as const],
      ['github', 'unknown' as const],
    ]);
    expect(shouldHighlight('deploy', ctx({ marks }))).toMatchObject({ hit: true, tier: 'saved' });
    expect(shouldHighlight('github', ctx({ marks }))).toMatchObject({ hit: true, tier: 'saved' });
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
    expect(shouldHighlight('Perplexing', ctx({ isSentenceStart: true })).hit).toBe(true);
  });

  it('少於三個字母的 token 不高亮', () => {
    expect(shouldHighlight('an', ctx()).hit).toBe(false);
  });

  it('marks 的 key 是原形,變化形也要命中', () => {
    const marks = new Map([['deploy', 'unknown' as const]]);
    expect(shouldHighlight('deploying', ctx({ marks })).hit).toBe(true);
  });

  it('三個自動色階跟著使用者的程度門檻移動', () => {
    const ranked = { common: 8000, useful: 10000, advanced: 18000, obscure: 21000 };
    const level8000 = ctx({ freq: ranked, threshold: 8000 });
    expect(shouldHighlight('common', level8000).hit).toBe(false);
    expect(shouldHighlight('useful', level8000).tier).toBe('learning');
    expect(shouldHighlight('advanced', level8000).tier).toBe('advanced');
    expect(shouldHighlight('obscure', level8000).tier).toBe('rare');
  });
});
