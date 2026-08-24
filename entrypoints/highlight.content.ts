import { collectTokens } from '@/src/content/scan';
import { shouldHighlight, type WordStatus } from '@/src/lib/decide';
import { wordAtPoint } from '@/src/content/locate';
import { showCard, hideCard } from '@/src/content/card';

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

    const defs = new Map<string, string>();
    let pointerX = 0;
    let pointerY = 0;
    let current: Hover | null = null;
    let expanded = false;

    // mousemove 只記座標。命中測試留到按鍵時才做,滑鼠移動每秒觸發幾十次,
    // 在這裡做 caretPositionFromPoint 加 getBoundingClientRect 會逼出重複的版面計算。
    document.addEventListener('mousemove', (e) => {
      pointerX = e.clientX;
      pointerY = e.clientY;
    }, { passive: true });

    function hoveredWord(): Hover | null {
      const found = wordAtPoint(pointerX, pointerY);
      if (!found) return null;

      const range = document.createRange();
      range.setStart(found.node, found.span.start);
      range.setEnd(found.node, found.span.end);

      const decision = shouldHighlight(found.span.text, {
        freq, marks, threshold, isSentenceStart: false,
      });

      return {
        word: found.span.text,
        lemma: decision.lemma,
        rect: range.getBoundingClientRect(),
        sentence: sentenceAround(found.node),
      };
    }

    document.addEventListener('keydown', async (e) => {
      if (isTypingTarget(e.target)) return;

      if (e.key === 'Escape') {
        hideCard();
        expanded = false;
        return;
      }

      if (e.key === 'a' || e.key === 'A') {
        const hover = hoveredWord();
        if (!hover) return;
        e.preventDefault();

        // 換到別的字時要收掉展開狀態,不然在 A 字展開後移到 B 字按一次 A
        // 會直接跳到完整卡片,漸進揭露就失效了
        if (current?.lemma !== hover.lemma) expanded = false;
        current = hover;

        if (!defs.has(hover.lemma)) {
          const entries = await browser.runtime.sendMessage({
            type: 'lookup',
            items: [{ w: hover.lemma, s: hover.sentence }],
          }) as Array<[string, string]>;
          for (const [word, def] of entries) defs.set(word, def);
        }

        showCard({
          word: hover.lemma,
          definition: defs.get(hover.lemma) ?? '(查不到,檢查 options 頁的 AI 設定)',
          rect: hover.rect,
          expanded,
          marked: marks.get(hover.lemma) === 'unknown',
        });
        expanded = true;
        return;
      }

      // Space 標記的是卡片上那個字,不是滑鼠現在指到的字
      if (e.key === ' ' && current && expanded) {
        e.preventDefault();
        const hover = current;
        const status = await browser.runtime.sendMessage({
          type: 'toggleMark', word: hover.lemma,
        }) as WordStatus | null;

        if (status === 'unknown') {
          marks.set(hover.lemma, status);
          void browser.runtime.sendMessage({
            type: 'saveContext',
            word: hover.lemma,
            sentence: hover.sentence,
            url: location.href,
            title: document.title,
          });
        } else {
          marks.delete(hover.lemma);
        }

        showCard({
          word: hover.lemma,
          definition: defs.get(hover.lemma) ?? '',
          rect: hover.rect,
          expanded: true,
          marked: status === 'unknown',
        });
      }
    });
  },
});

interface Hover {
  word: string;
  lemma: string;
  rect: DOMRect;
  sentence: string;
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT'
    || el.tagName === 'TEXTAREA'
    || el.isContentEditable;
}

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
