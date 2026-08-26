import { collectTokens, sentenceAround, sentenceContextAround, type ConjunctionKind } from '@/src/content/scan';
import { buildRanges } from '@/src/content/paint';
import { shouldHighlight, type HighlightTier, type WordStatus } from '@/src/lib/decide';
import { wordAtPoint, textPositionAtPoint } from '@/src/content/locate';
import type { ExplainResult, Msg } from '@/src/lib/messages';
import { extractTakeaway } from '@/src/lib/prompt';
import { showCard, hideCard } from '@/src/content/card';
import { speak } from '@/src/content/speak';

const HIGHLIGHT_NAMES: Record<HighlightTier, string> = {
  saved: 'wordtiger-saved',
  learning: 'wordtiger-learning',
  advanced: 'wordtiger-advanced',
  rare: 'wordtiger-rare',
};
const CONJUNCTION_NAMES: Record<ConjunctionKind, string> = {
  coordinating: 'wordtiger-conjunction-coordinating',
  clause: 'wordtiger-conjunction-clause',
};
const STYLE_ID = 'wordtiger-highlight-style';

declare global {
  interface Window {
    /** 這次啟用註冊的事件監聽器,關閉時用它一次拔掉 */
    __wordTigerAbort?: AbortController;
  }
}

export default defineContentScript({
  matches: [],
  registration: 'runtime',
  cssInjectionMode: 'manual',

  async main() {
    console.log('[wordtiger] content script in', location.href, 'CSS.highlights:', !!CSS.highlights);

    // 重複按 Alt+U 時關閉。每按一次 Alt+U 都是一次全新的 executeScript,
    // 只清掉高亮而不解除監聽器的話,舊的監聽器會留著,下一次啟用再疊一組上去。
    if (window.__wordTigerAbort) {
      [...Object.values(HIGHLIGHT_NAMES), ...Object.values(CONJUNCTION_NAMES)]
        .forEach((name) => CSS.highlights.delete(name));
      document.getElementById(STYLE_ID)?.remove();
      hideCard();
      window.__wordTigerAbort.abort();
      window.__wordTigerAbort = undefined;
      return;
    }
    const controller = new AbortController();
    window.__wordTigerAbort = controller;

    const [freq, marks, highlightSettings] = await Promise.all([
      fetchFreq(),
      browser.runtime.sendMessage({ type: 'getMarks' })
        .then((e: Array<[string, WordStatus]>) => new Map(e)),
      browser.runtime.sendMessage({ type: 'getHighlightSettings' }) as Promise<{
        threshold: number;
        highlightColors: Record<HighlightTier, string>;
        highlightTextColors: Record<HighlightTier, string>;
        highlightUnderlineColors: Record<HighlightTier, string>;
        markConjunctions: boolean;
      }>,
    ]);
    const {
      threshold, highlightColors, highlightTextColors,
      highlightUnderlineColors, markConjunctions,
    } = highlightSettings;
    injectStyle(highlightColors, highlightTextColors, highlightUnderlineColors);

    // 斷詞結果留著重用。改一個字的狀態不該把整頁重新走一遍 TreeWalker 和 Segmenter,
    // 只有 DOM 真的變過才需要 rescan。
    let tokens = collectTokens(document.body);

    function paintHighlights(rescan = false) {
      if (rescan) tokens = collectTokens(document.body);
      const { tiers, conjunctions } = buildRanges(
        tokens, { freq, marks, threshold }, markConjunctions,
      );

      for (const tier of Object.keys(HIGHLIGHT_NAMES) as HighlightTier[]) {
        CSS.highlights.set(HIGHLIGHT_NAMES[tier], new Highlight(...tiers[tier]));
      }
      for (const kind of Object.keys(CONJUNCTION_NAMES) as ConjunctionKind[]) {
        CSS.highlights.set(CONJUNCTION_NAMES[kind], new Highlight(...conjunctions[kind]));
      }
      // 只印數量。印 Range 物件的話,DevTools 開著時 console 會一直抓住它們。
      console.log('[wordtiger] threshold', threshold, 'marks', marks.size, 'tokens', tokens.length);
    }

    paintHighlights();

    // ponytail: 先用 300ms 防抖後全文補掃；大型即時頁面真的卡頓時再升級成分區 IntersectionObserver。
    let scanTimer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => {
      clearTimeout(scanTimer);
      scanTimer = setTimeout(() => paintHighlights(true), 300);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    controller.signal.addEventListener('abort', () => {
      observer.disconnect();
      clearTimeout(scanTimer);
    }, { once: true });

    // 沒有批次預取了。查詞改成單字一次完整輸出,一頁 30 個字先打 30 通
    // 每通幾百 token 的請求,絕大多數還用不到。改成按 A 才查。
    const defs = new Map<string, string>();
    let pointerX = 0;
    let pointerY = 0;
    let current: Hover | null = null;
    let currentTakeaway: Takeaway | null = null;
    // 每次查詢配一個序號。等回應的時候使用者可能已經按 Esc 或換一句了,
    // 那時候這次的結果就該丟掉,不能覆蓋畫面上比較新的東西。
    let explainSeq = 0;
    let activeAi: AbortController | undefined;

    const cancelAi = () => {
      activeAi?.abort();
      activeAi = undefined;
    };
    const dismissAi = () => {
      cancelAi();
      explainSeq++;
    };
    const closeAiCard = () => {
      current = null;
      currentTakeaway = null;
      dismissAi();
    };
    const requestAi = async (msg: StreamMsg, onText: (text: string) => void) => {
      cancelAi();
      const request = new AbortController();
      activeAi = request;
      const result = await streamAi(msg, onText, request.signal);
      if (activeAi === request) activeAi = undefined;
      return result;
    };
    controller.signal.addEventListener('abort', cancelAi, { once: true });

    const wordHint = (lemma: string) => {
      const space = marks.get(lemma) === 'unknown' ? 'Space 取消收藏' : 'Space 收藏';
      const known = marks.get(lemma) === 'known' ? 'X 恢復標示' : 'X 已認得';
      return `${space} · ${known} · F 發音 · Esc 關閉`;
    };
    const takeawayHint = (phrase: string) =>
      `${marks.get(phrase) === 'unknown' ? 'Space 取消片語收藏' : 'Space 收藏片語'} · Esc 關閉`;

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
        sentence: sentenceAround(found.node, found.span.start),
      };
    }

    document.addEventListener('keydown', async (e) => {
      if (isTypingTarget(e.target)) return;

      if (e.key === 'Escape') {
        hideCard();
        current = null;
        currentTakeaway = null;
        dismissAi();
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

      // 已經認得的字不值得先花一次 AI 查詢；直接指著按 X 就能排除。
      // 卡片開著時則固定作用在卡片單字，避免滑鼠稍微移動就標錯字。
      if (e.key === 'x' || e.key === 'X') {
        const hover = current ?? hoveredWord();
        if (!hover) return;
        e.preventDefault();
        dismissAi();
        currentTakeaway = null;
        current = hover;

        const status = await browser.runtime.sendMessage({
          type: 'toggleMark', word: hover.lemma, status: 'known',
        }) as WordStatus | null;
        if (status) marks.set(hover.lemma, status);
        else marks.delete(hover.lemma);
        paintHighlights();

        showCard({
          title: hover.lemma,
          body: status === 'known' ? '這隻已經馴服了，不再標示。' : '已恢復由詞頻判定。',
          rect: hover.rect,
          hint: wordHint(hover.lemma),
          celebrate: status === 'known',
          onClose: closeAiCard,
        });
        return;
      }

      if (e.key === 'a' || e.key === 'A') {
        const hover = hoveredWord();
        if (!hover) return;
        e.preventDefault();
        dismissAi();
        currentTakeaway = null;
        current = hover;

        const hint = wordHint(hover.lemma);
        const marked = marks.get(hover.lemma) === 'unknown';
        const cached = defs.get(hover.lemma);

        if (cached !== undefined) {
          showCard({
            title: hover.lemma, body: cached, rect: hover.rect,
            hint, marked, onClose: closeAiCard,
          });
          return;
        }

        // 完整查詞要好幾秒,沒有回饋會讓人以為按鍵沒進去
        showCard({
          title: hover.lemma, body: '老虎正在抓這個字…', rect: hover.rect,
          hint: '', marked, loading: true, onClose: closeAiCard,
        });

        const seq = ++explainSeq;
        const result = await requestAi({
          type: 'lookup', word: hover.lemma, sentence: hover.sentence,
        }, (body) => {
          if (seq === explainSeq) showCard({
            title: hover.lemma, body, rect: hover.rect,
            hint, marked, loading: true, onClose: closeAiCard,
          });
        });
        if (seq !== explainSeq) return;

        if (result?.ok) defs.set(hover.lemma, result.text);

        showCard({
          title: hover.lemma,
          body: result?.ok ? result.text : `查詢失敗:${result?.error ?? '背景程式沒有回應'}`,
          rect: hover.rect,
          hint,
          marked,
          onClose: closeAiCard,
        });
        return;
      }

      if (e.key === 's' || e.key === 'S' || e.key === 'd' || e.key === 'D') {
        const pos = textPositionAtPoint(pointerX, pointerY);
        if (!pos) return;
        e.preventDefault();

        const { sentence, previous } = sentenceContextAround(pos.node, pos.offset);
        if (!sentence) return;
        const focus = wordAtPoint(pointerX, pointerY)?.span.text ?? '';

        const range = document.createRange();
        range.selectNodeContents(pos.node);
        const rect = range.getBoundingClientRect();

        const kind = (e.key === 's' || e.key === 'S') ? 'translate' : 'grammar';
        const title = kind === 'translate' ? '快速看懂' : '拆懂這句';
        const cardBody = (body: string) => kind === 'translate'
          ? `原文｜${sentence}\n${body}`
          : body;
        // 卡片換成整句的內容了,Space 不該再標記剛才那個單字
        current = null;
        currentTakeaway = null;

        // 先畫「查詢中」。這一趟可能要好幾秒,沒有回饋會讓人以為按鍵沒進去
        showCard({
          title,
          body: cardBody(kind === 'translate' ? '老虎正在讀這句…' : '老虎正在拆這句…'),
          rect, hint: 'Esc 關閉',
          loading: true, onClose: closeAiCard,
        });

        const seq = ++explainSeq;
        const result = await requestAi({
          type: 'explain', kind, sentence, previous, focus, title: document.title,
        }, (body) => {
          if (seq === explainSeq) showCard({
            title, body: cardBody(body), rect,
            hint: 'Esc 關閉', loading: true, onClose: closeAiCard,
          });
        });
        if (seq !== explainSeq) return;

        let phrase: string | null = null;
        if (result.ok && kind === 'grammar') {
          phrase = extractTakeaway(result.text);
          if (phrase) currentTakeaway = { phrase, sentence, rect, body: result.text };
        }

        showCard({
          title,
          body: cardBody(result.ok ? result.text : `查詢失敗:${result.error}`),
          rect,
          hint: phrase ? takeawayHint(phrase) : 'Esc 關閉',
          onClose: closeAiCard,
        });
        return;
      }

      if (e.key === ' ' && currentTakeaway) {
        e.preventDefault();
        const takeaway = currentTakeaway;
        dismissAi();
        const status = await browser.runtime.sendMessage({
          type: 'toggleMark', word: takeaway.phrase,
        }) as WordStatus | null;
        if (status === 'unknown') {
          marks.set(takeaway.phrase, status);
          await browser.runtime.sendMessage({
            type: 'saveContext', word: takeaway.phrase,
            sentence: takeaway.sentence, url: location.href, title: document.title,
          });
          // 拆句已經找出片語；收藏後沿用查詞入口補齊片語詞典並寫入同一份快取。
          void browser.runtime.sendMessage({
            type: 'lookup', word: takeaway.phrase, sentence: takeaway.sentence,
          }).catch((err) => console.error('[wordtiger] 建立片語詞典失敗', err));
        } else {
          marks.delete(takeaway.phrase);
        }
        currentTakeaway = takeaway;
        showCard({
          title: '拆懂這句', body: takeaway.body, rect: takeaway.rect,
          hint: takeawayHint(takeaway.phrase), celebrate: status === 'unknown',
          onClose: closeAiCard,
        });
        return;
      }

      // Space 標記的是卡片上那個字,不是滑鼠現在指到的字
      if (e.key === ' ' && current) {
        e.preventDefault();
        const hover = current;
        dismissAi();
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
        paintHighlights();

        showCard({
          title: hover.lemma,
          body: defs.get(hover.lemma) ?? '',
          rect: hover.rect,
          hint: wordHint(hover.lemma),
          marked: status === 'unknown',
          celebrate: status === 'unknown',
          onClose: closeAiCard,
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

interface Takeaway {
  phrase: string;
  sentence: string;
  rect: DOMRect;
  body: string;
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT'
    || el.tagName === 'TEXTAREA'
    || el.isContentEditable;
}

function injectStyle(
  backgrounds: Record<HighlightTier, string>,
  texts: Record<HighlightTier, string>,
  underlines: Record<HighlightTier, string>,
) {
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `${(Object.keys(HIGHLIGHT_NAMES) as HighlightTier[])
    .map((tier) => `::highlight(${HIGHLIGHT_NAMES[tier]}) {
      background-color: ${backgrounds[tier]}; color: ${texts[tier]};
      text-decoration: underline solid ${underlines[tier]} 2px; text-underline-offset: 2px;
    }`)
    .join('\n')}
    ::highlight(${CONJUNCTION_NAMES.coordinating}) {
      text-decoration: underline dotted #334155 2px; text-underline-offset: 3px;
    }
    ::highlight(${CONJUNCTION_NAMES.clause}) {
      text-decoration: underline double #334155 2px; text-underline-offset: 3px;
    }`;
  document.head.appendChild(style);
}

async function fetchFreq(): Promise<Record<string, number>> {
  const res = await fetch(browser.runtime.getURL('/freq.json'));
  return res.json();
}

type StreamMsg = Extract<Msg, { type: 'lookup' | 'explain' }>;

function streamAi(
  msg: StreamMsg,
  onText: (text: string) => void,
  signal?: AbortSignal,
): Promise<ExplainResult> {
  const port = browser.runtime.connect({ name: 'wordtiger-ai-stream' });
  return new Promise((resolve) => {
    let text = '';
    let settled = false;
    const cancel = () => finish({ ok: false, error: 'AI 請求已取消' });
    const finish = (result: ExplainResult, disconnect = true) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', cancel);
      resolve(result);
      if (disconnect) port.disconnect();
    };
    port.onMessage.addListener((event) => {
      if (event.type === 'delta') {
        text += event.delta;
        onText(text);
      } else if (event.type === 'done') {
        finish(event.result);
      }
    });
    port.onDisconnect.addListener(() => {
      if (!settled) finish({ ok: false, error: 'AI 串流連線中斷' }, false);
    });
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    else port.postMessage(msg);
  });
}
