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
    console.log('[pv] content script in', location.href, 'CSS.highlights:', !!CSS.highlights);

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
    }

    console.log('[pv] threshold', threshold, 'marks', marks.size, 'ranges', ranges.length);
    CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));

    // 沒有批次預取了。查詞改成單字一次完整輸出,一頁 30 個字先打 30 通
    // 每通幾百 token 的請求,絕大多數還用不到。改成按 A 才查。
    const defs = new Map<string, string>();
    let pointerX = 0;
    let pointerY = 0;
    let current: Hover | null = null;
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
        current = null;
        explainSeq++;
        return;
      }

      if (e.key === 'f' || e.key === 'F') {
        // 卡片開著就念卡片上那個字,不然念滑鼠底下的字
        const word = current ? current.lemma : hoveredWord()?.word;
        if (!word) return;
        e.preventDefault();
        speak(word);
        return;
      }

      if (e.key === 'a' || e.key === 'A') {
        const hover = hoveredWord();
        if (!hover) return;
        e.preventDefault();
        current = hover;

        const hint = 'Space 標記 · F 發音 · Esc 關閉';
        const marked = marks.get(hover.lemma) === 'unknown';
        const cached = defs.get(hover.lemma);

        if (cached !== undefined) {
          showCard({ title: hover.lemma, body: cached, rect: hover.rect, hint, marked });
          return;
        }

        // 完整查詞要好幾秒,沒有回饋會讓人以為按鍵沒進去
        showCard({ title: hover.lemma, body: '查詢中…', rect: hover.rect, hint: '', marked });

        const seq = ++explainSeq;
        const result = await browser.runtime.sendMessage({
          type: 'lookup', word: hover.lemma, sentence: hover.sentence,
        }) as ExplainResult | undefined;
        if (seq !== explainSeq) return;

        if (result?.ok) defs.set(hover.lemma, result.text);

        showCard({
          title: hover.lemma,
          body: result?.ok ? result.text : `查詢失敗:${result?.error ?? '背景程式沒有回應'}`,
          rect: hover.rect,
          hint,
          marked,
        });
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
        // 卡片換成整句的內容了,Space 不該再標記剛才那個單字
        current = null;

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
      if (e.key === ' ' && current) {
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

