import { describe, it, expect } from 'vitest';
import { collectTokens } from './scan';

function dom(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

describe('collectTokens', () => {
  it('抓出文字節點裡的英文單字與位移', () => {
    const hits = collectTokens(dom('<p>We deploy today</p>'));
    expect(hits.map((h) => h.text)).toEqual(['We', 'deploy', 'today']);
    expect(hits[1]!.start).toBe(3);
    expect(hits[1]!.end).toBe(9);
  });

  it('跳過 script 與 style', () => {
    const hits = collectTokens(dom('<script>var deploy = 1</script><p>hello world</p>'));
    expect(hits.map((h) => h.text)).toEqual(['hello', 'world']);
  });

  it('跳過 code 與 pre', () => {
    const hits = collectTokens(dom('<pre>deploy</pre><code>staging</code><p>real text</p>'));
    expect(hits.map((h) => h.text)).toEqual(['real', 'text']);
  });

  it('跳過 contenteditable 區域', () => {
    const hits = collectTokens(dom('<div contenteditable="true">draft here</div><p>real text</p>'));
    expect(hits.map((h) => h.text)).toEqual(['real', 'text']);
  });

  it('跳過 textarea 與 input', () => {
    const hits = collectTokens(dom('<textarea>typed words</textarea><p>real text</p>'));
    expect(hits.map((h) => h.text)).toEqual(['real', 'text']);
  });

  it('不含字母的 token 不回傳', () => {
    const hits = collectTokens(dom('<p>abc 123 !!! def</p>'));
    expect(hits.map((h) => h.text)).toEqual(['abc', 'def']);
  });

  it('句號後的第一個字標記為 isSentenceStart', () => {
    const hits = collectTokens(dom('<p>One thing. Two things.</p>'));
    expect(hits.find((h) => h.text === 'One')!.isSentenceStart).toBe(true);
    expect(hits.find((h) => h.text === 'Two')!.isSentenceStart).toBe(true);
    expect(hits.find((h) => h.text === 'thing')!.isSentenceStart).toBe(false);
  });

  it('跨越多個文字節點時各自回報自己的 node', () => {
    const hits = collectTokens(dom('<p>alpha <em>beta</em> gamma</p>'));
    expect(hits).toHaveLength(3);
    expect(hits[1]!.node.textContent).toBe('beta');
    expect(hits[1]!.start).toBe(0);
  });
});
