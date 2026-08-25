import { describe, it, expect } from 'vitest';
import { collectTokens } from './scan';
import { buildRanges } from './paint';
import type { WordStatus } from '../lib/decide';

const freq = { deploy: 800, tricky: 6000, perplexing: 12000, arcane: 40000 };

function dom(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.append(el);
  return el;
}

function ctx(marks: Map<string, WordStatus> = new Map()) {
  return { freq, marks, threshold: 5000 };
}

describe('buildRanges', () => {
  it('依詞頻把字分到對應的層', () => {
    const tokens = collectTokens(dom('<p>we deploy tricky perplexing arcane things</p>'));
    const { tiers } = buildRanges(tokens, ctx(), false);

    expect(tiers.learning.map((r) => r.toString())).toEqual(['tricky']);
    expect(tiers.advanced.map((r) => r.toString())).toEqual(['perplexing']);
    expect(tiers.rare.map((r) => r.toString())).toEqual(['arcane']);
    expect(tiers.saved).toEqual([]);
  });

  it('手動收藏的字用 saved 層,不受詞頻影響', () => {
    const tokens = collectTokens(dom('<p>we deploy today</p>'));
    const { tiers } = buildRanges(tokens, ctx(new Map([['deploy', 'unknown']])), false);

    expect(tiers.saved.map((r) => r.toString())).toEqual(['deploy']);
  });

  it('關掉連詞標記時不產生連詞 Range', () => {
    const tokens = collectTokens(dom('<p>we ship and we deploy</p>'));

    expect(buildRanges(tokens, ctx(), true).conjunctions.coordinating).toHaveLength(1);
    expect(buildRanges(tokens, ctx(), false).conjunctions.coordinating).toEqual([]);
  });

  // 快取 token 之後才會踩到:節點文字被改短,舊的 end 就超出範圍。
  it('文字節點縮短時跳過過期的 token,其餘照畫', () => {
    const root = dom('<p>perplexing</p><p>arcane</p>');
    const tokens = collectTokens(root);
    (root.firstChild!.firstChild as Text).data = 'a';

    const { tiers } = buildRanges(tokens, ctx(), false);
    expect(tiers.advanced).toEqual([]);
    expect(tiers.rare.map((r) => r.toString())).toEqual(['arcane']);
  });
});
