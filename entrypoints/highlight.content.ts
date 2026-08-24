import { collectTokens, sentenceAround } from '@/src/content/scan';
import { shouldHighlight, type WordStatus } from '@/src/lib/decide';
import { wordAtPoint, textNodeAtPoint } from '@/src/content/locate';
import type { ExplainResult } from '@/src/lib/messages';
import { showCard, hideCard } from '@/src/content/card';
import { speak } from '@/src/content/speak';

const HIGHLIGHT_NAME = 'pv-unknown';
const STYLE_ID = 'pv-highlight-style';

declare global {
  interface Window {
    /** 這次啟用註冊的事件監聽器,關閉時用它一次拔掉 */
    __pvAbort?: AbortController;
  }
}

export default defineContentScript({
  matches: [],
  registration: 'runtime',
  cssInjectionMode: 'manual',

  async main() {
    // 重複按 Alt+U 時關閉。每按一次 Alt+U 都是一次全新的 executeScript,
    // 只清掉高亮而不解除監聽器的話,舊的監聽器會留著,下一次啟用再疊一組上去。
    if (window.__pvAbort) {
      CSS.highlights.delete(HIGHLIGHT_NAME);
      document.getElementById(STYLE_ID)?.remove();
      hideCard();
      window.__pvAbort.abort();
      window.__pvAbort = undefined;
      return;
    }
    const controller = new AbortController();
    window.__pvAbort = controller;

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
    // 每次查詢配一個序號。等回應的時候使用者可能已經按 Esc 或換一句了,
    // 那時候這次的結果就該丟掉,不能覆蓋畫面上比較新的東西。
    let explainSeq = 0;

    // mousemove 只記座標。命中測試留到按鍵時才做,滑鼠移動每秒觸發幾十次,
    // 在這裡做 caretPositionFromPoint 加 getBoundingClientRect 會逼出重複的版面計算。
    document.addEventListener('mousemove', (e) => {
      pointerX = e.clientX;
      pointerY = e.clientY;
    }, { passive: true, signal: controller.signal });

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
        explainSeq++;
        return;
      }

      if (e.key === 'f' || e.key === 'F') {
        // 卡片開著就念卡片上那個字,不然念滑鼠底下的字
        const word = (expanded && current) ? current.lemma : hoveredWord()?.word;
        if (!word) return;
        e.preventDefault();
        speak(word);
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
          title: expanded ? hover.lemma : '',
          body: defs.get(hover.lemma) ?? '(查不到,檢查 options 頁的 AI 設定)',
          rect: hover.rect,
          hint: expanded ? 'Space 標記 · F 發音 · Esc 關閉' : '',
          marked: marks.get(hover.lemma) === 'unknown',
        });
        expanded = true;
        return;
      }

      if (e.key === 's' || e.key === 'S' || e.key === 'd' || e.key === 'D') {
        const node = textNodeAtPoint(pointerX, pointerY);
        if (!node) return;
        e.preventDefault();

        const sentence = sentenceAround(node);
        if (!sentence) return;

        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();

        const kind = (e.key === 's' || e.key === 'S') ? 'translate' : 'grammar';
        const title = kind === 'translate' ? '整句翻譯' : '文法分析';

        // 先畫「查詢中」。這一趟可能要好幾秒,沒有回饋會讓人以為按鍵沒進去
        showCard({ title, body: '查詢中…', rect, hint: 'Esc 關閉' });

        const seq = ++explainSeq;
        const result = await browser.runtime.sendMessage({
          type: 'explain', kind, sentence,
        }) as ExplainResult;
        if (seq !== explainSeq) return;

        showCard({
          title,
          body: result.ok ? result.text : `查詢失敗:${result.error}`,
          rect,
          hint: 'Esc 關閉',
        });
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
          title: hover.lemma,
          body: defs.get(hover.lemma) ?? '',
          rect: hover.rect,
          hint: 'Space 取消標記 · F 發音 · Esc 關閉',
          marked: status === 'unknown',
        });
      }
    }, { signal: controller.signal });
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

