import { collectTokens } from '@/src/content/scan';
import { shouldHighlight, type WordStatus } from '@/src/lib/decide';

const HIGHLIGHT_NAME = 'pv-unknown';
const STYLE_ID = 'pv-highlight-style';

export default defineContentScript({
  matches: [],
  registration: 'runtime',
  cssInjectionMode: 'manual',

  async main() {
    // 重複按 Alt+U 時關閉,不重複注入
    if ((window as any).__pvActive) {
      CSS.highlights.delete(HIGHLIGHT_NAME);
      document.getElementById(STYLE_ID)?.remove();
      (window as any).__pvActive = false;
      return;
    }
    (window as any).__pvActive = true;

    injectStyle();

    const [freq, marks, threshold] = await Promise.all([
      fetchFreq(),
      browser.runtime.sendMessage({ type: 'getMarks' })
        .then((e: Array<[string, WordStatus]>) => new Map(e)),
      browser.runtime.sendMessage({ type: 'getThreshold' }) as Promise<number>,
    ]);

    const ranges: Range[] = [];
    const lookupItems: Array<{ w: string; s: string }> = [];
    const seen = new Set<string>();

    for (const hit of collectTokens(document.body)) {
      const decision = shouldHighlight(hit.text, {
        freq,
        marks,
        threshold,
        isSentenceStart: hit.isSentenceStart,
      });
      if (!decision.hit) continue;

      const range = document.createRange();
      range.setStart(hit.node, hit.start);
      range.setEnd(hit.node, hit.end);
      ranges.push(range);

      if (!seen.has(decision.lemma)) {
        seen.add(decision.lemma);
        lookupItems.push({ w: decision.lemma, s: sentenceAround(hit.node) });
      }
    }

    CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));

    // 批次預取:掃描一完成就把整頁生詞打包送出,之後按 A 是讀本地快取
    void browser.runtime.sendMessage({ type: 'lookup', items: lookupItems.slice(0, 30) });
  },
});

function injectStyle() {
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `::highlight(${HIGHLIGHT_NAME}) { background-color: #c8c0ff; }`;
  document.head.appendChild(style);
}

async function fetchFreq(): Promise<Record<string, number>> {
  const res = await fetch(browser.runtime.getURL('/freq.json'));
  return res.json();
}

/** 取這個文字節點所屬區塊的完整文字,當作語境句 */
export function sentenceAround(node: Text): string {
  const block = node.parentElement?.closest('p, li, td, h1, h2, h3, h4, div');
  return (block?.textContent ?? node.data).trim().slice(0, 300);
}
