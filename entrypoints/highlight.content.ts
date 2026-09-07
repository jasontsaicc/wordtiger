import { collectTokens, sentenceContextAround, type ConjunctionKind } from '@/src/content/scan';
import { buildRanges } from '@/src/content/paint';
import { shouldHighlight, type HighlightTier, type WordStatus } from '@/src/lib/decide';
import { wordAtPoint, textPositionAtPoint } from '@/src/content/locate';
import type { ExplainResult, Msg } from '@/src/lib/messages';
import { extractQuiz, extractTakeaway, stripQuiz } from '@/src/lib/prompt';
import { showCard, hideCard } from '@/src/content/card';
import { speak } from '@/src/content/speak';
import { captureYouTubeSubtitle, type YouTubeSubtitle } from '@/src/content/youtube';

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
    /** 本次啟用的監聽器生命週期。 */
    __wordTigerAbort?: AbortController;
  }
}

export default defineContentScript({
  matches: [],
  registration: 'runtime',
  cssInjectionMode: 'manual',

  async main() {
    // executeScript 每次都會重新註冊；關閉時同步移除舊監聽器。
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
        guessFirst: boolean;
      }>,
    ]);
    const {
      threshold, highlightColors, highlightTextColors,
      highlightUnderlineColors, markConjunctions, guessFirst,
    } = highlightSettings;
    injectStyle(highlightColors, highlightTextColors, highlightUnderlineColors);

    // 僅 DOM 變動時重新斷詞；標記狀態變更沿用既有 tokens。
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
    }

    paintHighlights();

    // ponytail: 300ms 防抖後全文掃描；出現可測延遲時再改為分區掃描。
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

    // 按 A 才查詞，避免未使用的整頁批次 API request。
    let pointerX = 0;
    let pointerY = 0;
    let current: Hover | null = null;
    let currentTakeaway: Takeaway | null = null;
    let currentSpeech = '';
    let currentDefinition = '';
    let currentSentenceSource: YouTubeSubtitle | null = null;
    const consumedVideoKeys = new Set<string>();
    interface Quiz {
      /** 出題當下對應的字;current 之後可能被別的按鍵改指到別的字,recordQuiz 要認這個而不是 current。 */
      word: string;
      /** 出題當下的實際字形與原句,用來畫題目;理由同 word,不能改讀 current。 */
      surface: string;
      sentence: string;
      previous: string;
      choices: [string, string, string];
      right: 0 | 1 | 2;
      /** 畫面第 i 個位置顯示 choices[order[i]]。元素型別是 `0 | 1 | 2`,不是 `number`。 */
      order: [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2];
      state: 'pending' | 'revealed';
      /** 揭曉時的原始索引；A 跳過時為 null。 */
      picked: 0 | 1 | 2 | null;
    }
    let currentQuiz: Quiz | null = null;
    /** A 跳過或選項還沒解析出來就按 A,跳過後不再重新出題,直到換一個字。 */
    let quizSkipped = false;
    /** SYSTEM_RULES 規定第一、二行固定是題目;累積內容一開頭就不是這個開頭,代表這次不會出題。 */
    const QUIZ_PREFIX = '選項｜';
    /**
     * true 代表目前沒有查詞請求在飛，或飛的那個已經有結果了；用來跟「currentQuiz 還是
     * null 是因為還沒解析出來」（true 的情況不該讓 A 被當成跳過鍵吃掉）分開判斷，
     * 否則一個字如果從頭到尾沒有解析出題目，A 會永遠被誤判成跳過鍵，查不了下一個字。
     */
    let lookupSettled = true;
    // 序號阻止舊 request 覆蓋較新的卡片狀態。
    let explainSeq = 0;
    let activeAi: AbortController | undefined;

    const cancelAi = () => {
      activeAi?.abort();
      activeAi = undefined;
    };
    const dismissAi = () => {
      cancelAi();
      explainSeq++;
      // 取消掉的請求永遠不會走到 runLookup 裡設 true 的那兩行（它們都在
      // seq !== explainSeq 的提前 return 之後）；不在這裡補上，字沒有題目又被
      // 取消時 lookupSettled 會卡在 false，A 會被永久誤判成跳過鍵。
      lookupSettled = true;
    };
    const closeAiCard = () => {
      current = null;
      currentTakeaway = null;
      currentSpeech = '';
      currentDefinition = '';
      currentSentenceSource = null;
      resetQuiz();
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
      return `${space} · ${known} · F AI 發音 · Esc 關閉`;
    };
    const takeawayHint = (phrase: string) =>
      `${marks.get(phrase) === 'unknown' ? 'Space 取消片語收藏' : 'Space 收藏片語'} · F AI 原句 · Esc 關閉`;
    const sentenceHint = 'F AI 原句 · Esc 關閉';
    const wordTitle = (hover: Hover) => hover.word.toLowerCase() === hover.lemma
      ? hover.word : `${hover.word} → ${hover.lemma}`;

    const resetQuiz = () => { currentQuiz = null; quizSkipped = false; };

    const retry = (hover: Hover, from: string) => () => void runLookup(hover, true, from);

    /** 查詞卡現在該顯示什麼；所有查詞卡的 showCard 呼叫都經過這裡,揭曉前絕不外流答案。 */
    const renderQuizCard = (baseHint: string): {
      body: string; hint: string; choices?: [string, string, string];
      verdict?: { kind: 'right' | 'wrong' | 'skipped'; text: string };
    } => {
      if (!guessFirst || !currentQuiz) return { body: currentDefinition, hint: baseHint };
      if (currentQuiz.state === 'pending') {
        const displayed = currentQuiz.order.map((i) => currentQuiz!.choices[i]) as [string, string, string];
        return {
          // 先給原句再問,不然使用者只看到三個中文選項,不知道要拿什麼去猜。
          // 代名詞或主題設定住在前一句時,只給目標句是無解而不是難,所以前一句要一起給。
          body: [
            currentQuiz.previous && `前一句｜${currentQuiz.previous}`,
            quizExcerpt(currentQuiz.sentence, currentQuiz.surface),
            '',
            `猜猜看:**${currentQuiz.surface}** 在這句是哪個意思?先猜再看答案,記得比較久。`,
          ].filter(Boolean).join('\n'),
          hint: '1／2／3 猜一個 · A 跳過',
          choices: displayed,
        };
      }
      const answer = `正解是「${currentQuiz.choices[currentQuiz.right]}」`;
      const verdict = currentQuiz.picked === null
        ? { kind: 'skipped' as const, text: `略過了,${answer}。` }
        : currentQuiz.picked === currentQuiz.right
          ? { kind: 'right' as const, text: `✓ 答對了！${answer},往下看它為什麼是這個意思。` }
          : {
              kind: 'wrong' as const,
              text: `✗ 答錯了。你猜「${currentQuiz.choices[currentQuiz.picked]}」,${answer}。`,
            };
      return { body: currentDefinition, hint: baseHint, verdict };
    };

    /** 只在還沒有題目、也還沒跳過時抓取；已揭曉或已跳過都不再洗牌或覆蓋。 */
    const applyQuizExtraction = (raw: string, hover: Hover) => {
      if (currentQuiz || quizSkipped) return;
      // 答案那行還沒收完就武裝，模型若把「2」續寫成「23」，題目會鎖在錯的正解上。
      // 等後面確定還有一行（代表答案行已換行）再洗牌。
      const lines = raw.split(/\r?\n/);
      let start = 0;
      while (start < lines.length && lines[start]!.trim() === '') start++;
      if (lines.length <= start + 2) return;

      const extracted = extractQuiz(raw);
      if (!extracted) return;
      currentQuiz = {
        ...extracted, word: hover.lemma, surface: hover.word, sentence: hover.sentence,
        previous: hover.previous,
        order: shuffleOrder(), state: 'pending', picked: null,
      };
    };

    /** position 是畫面位置索引;換算回原始索引才是 quizLog 要存的值。 */
    const onQuizPick = (position: 0 | 1 | 2) => {
      if (!current || !currentQuiz || currentQuiz.state !== 'pending') return;
      const hover = current;
      const picked = currentQuiz.order[position];
      // recordQuiz 認 quiz 出題當下綁定的字,不是這一刻的 current:current 可能已經
      // 被 X／S／D 移到別的字,用 current.lemma 會把這一題錯記到別的字頭上。
      const word = currentQuiz.word;
      currentQuiz = { ...currentQuiz, state: 'revealed', picked };
      void browser.runtime.sendMessage({
        type: 'recordQuiz', word,
        picked, right: currentQuiz.right, choices: currentQuiz.choices,
      });
      const view = renderQuizCard(wordHint(hover.lemma));
      showCard({
        title: wordTitle(hover), rect: hover.rect,
        body: view.body, hint: view.hint, choices: view.choices, verdict: view.verdict,
        marked: marks.get(hover.lemma) === 'unknown',
        // 答題當下串流可能還沒結束;維持 loading 才不會提早播完成動畫,
        // 下一個 delta 進來又把卡片打回 loading,造成動畫閃兩次。
        loading: !lookupSettled,
        onClose: closeAiCard, onRetry: retry(hover, currentDefinition),
      });
    };

    /**
     * 查詞卡的 AI 部分。重試鈕帶 fresh 繞過快取重問，但不重跑收藏與語境：
     * 收藏是「你遇到這個字」這個事件，重問一次答案並沒有再遇到一次。
     * previous 是重問前畫面上那份答案，重問失敗就退回去，錯誤放進 hint 那一排。
     */
    const runLookup = async (hover: Hover, fresh = false, previous = '') => {
      const hint = wordHint(hover.lemma);
      const marked = marks.get(hover.lemma) === 'unknown';
      // 已揭曉或已跳過的題目不重新武裝；重問只是換一個字的答案,不是重新考一次。
      const wasPending = currentQuiz?.state === 'pending';
      const keepQuiz = fresh && (currentQuiz?.state === 'revealed' || quizSkipped);
      if (!keepQuiz) resetQuiz();
      // 題目還沒作答就被重問（點↻或按 A）等於放棄這一題；previous 與 currentDefinition
      // 都是揭曉後才該外流的完整定義，這裡沒清掉的話，loading 卡片或緊接著的 A 跳過鍵
      // 都會在使用者答題之前把答案洩漏出去。
      if (wasPending && !keepQuiz) { previous = ''; currentDefinition = ''; }
      // 這個查詞請求還在飛,期間 currentQuiz 是 null 不代表「沒有題目」,
      // 而是「還沒解析出來」，A 鍵要能分辨這兩種情況。
      lookupSettled = false;

      showCard({
        title: wordTitle(hover), rect: hover.rect,
        body: previous || '老虎正在抓這個字…',
        hint: '', marked, loading: true, onClose: closeAiCard, onRetry: retry(hover, previous),
      });

      const seq = ++explainSeq;
      const result = await requestAi({
        type: 'lookup', word: hover.lemma, surface: hover.word, sentence: hover.sentence, fresh,
      }, (body) => {
        if (seq === explainSeq) {
          currentDefinition = stripQuiz(body);
          if (guessFirst) {
            applyQuizExtraction(body, hover);
            // 題目還沒武裝、也還沒被跳過,但累積內容一開頭就不是「選項｜」:
            // 代表這次模型沒有照格式先出題,不用等這次查詢結束就能確定沒有題目,
            // 不然 A 會在整個串流期間被誤判成跳過鍵吃掉,查不了下一個字。
            if (!currentQuiz && !quizSkipped && !lookupSettled) {
              const seen = body.replace(/^\s+/, '');
              if (seen && !QUIZ_PREFIX.startsWith(seen) && !seen.startsWith(QUIZ_PREFIX)) {
                lookupSettled = true;
              }
            }
          }
          const view = renderQuizCard(hint);
          showCard({
            title: wordTitle(hover), body: view.body, rect: hover.rect,
            hint: view.hint, choices: view.choices, verdict: view.verdict, marked, loading: true,
            onClose: closeAiCard, onRetry: retry(hover, previous), onPick: onQuizPick,
          });
        }
      });
      if (seq !== explainSeq) return;

      if (result?.ok) {
        currentDefinition = stripQuiz(result.text);
        if (guessFirst) applyQuizExtraction(result.text, hover);
        lookupSettled = true;
        const view = renderQuizCard(hint);
        showCard({
          title: wordTitle(hover), body: view.body, rect: hover.rect,
          hint: view.hint, choices: view.choices, verdict: view.verdict, marked,
          onClose: closeAiCard, onRetry: retry(hover, currentDefinition), onPick: onQuizPick,
        });
        return;
      }

      // 重問失敗留住舊答案，錯誤擠進本來就在的 hint 那排，不多佔一行高度。
      lookupSettled = true;
      // 題目在串流中武裝了,但最終查詢失敗:這一題沒有機會被回答,不能留著懸空。
      // 留著的話 1/2/3 還能對一題使用者根本沒看到的題目送出 recordQuiz,已揭曉
      // 則保留,讓失敗後重試仍維持原本的揭曉診斷。
      if (currentQuiz?.state === 'pending') resetQuiz();
      const error = result?.error ?? '背景程式沒有回應';
      currentDefinition = previous;
      showCard({
        title: wordTitle(hover),
        body: previous || `查詢失敗:${error}`,
        rect: hover.rect,
        hint: previous ? `重問失敗:${error}` : hint,
        marked,
        onClose: closeAiCard,
        onRetry: retry(hover, previous),
      });
    };

    /** 拆句卡的 AI 部分；msg 原樣重送，所以重試不會換句子也不會換 focus。 */
    const runExplain = async (
      msg: Extract<StreamMsg, { type: 'explain' }>,
      rect: DOMRect,
      fresh = false,
      previous = '',
      source?: YouTubeSubtitle,
    ) => {
      const { kind, sentence } = msg;
      const title = kind === 'translate' ? '快速看懂' : '拆懂這句';
      const cardBody = (body: string) => kind === 'translate'
        ? `原文｜${sentence}\n${body}`
        : body;
      const waiting = kind === 'translate' ? '老虎正在讀這句…' : '老虎正在拆這句…';
      const retry = (from: string) => () => void runExplain(msg, rect, true, from, source);

      showCard({
        title, body: cardBody(previous || waiting), rect, hint: sentenceHint,
        loading: true, onClose: closeAiCard, onRetry: retry(previous),
      });

      const seq = ++explainSeq;
      const result = await requestAi({ ...msg, fresh }, (body) => {
        if (seq === explainSeq) showCard({
          title, body: cardBody(body), rect,
          hint: sentenceHint, loading: true, onClose: closeAiCard, onRetry: retry(previous),
        });
      });
      if (seq !== explainSeq) return;

      if (!result.ok) {
        showCard({
          title, body: cardBody(previous || `查詢失敗:${result.error}`), rect,
          hint: previous ? `重問失敗:${result.error}` : sentenceHint,
          onClose: closeAiCard, onRetry: retry(previous),
        });
        return;
      }

      const phrase = kind === 'grammar' ? extractTakeaway(result.text) : null;
      if (phrase) currentTakeaway = { phrase, sentence, rect, body: result.text, source };
      showCard({
        title, body: cardBody(result.text), rect,
        hint: phrase ? takeawayHint(phrase) : sentenceHint,
        onClose: closeAiCard, onRetry: retry(result.text),
      });
    };

    // mousemove 僅記錄座標，命中測試延後到按鍵事件。
    document.addEventListener('mousemove', (e) => {
      pointerX = e.clientX;
      pointerY = e.clientY;
    }, { passive: true, signal: controller.signal });

    function hoveredWord(pauseVideo = false): Hover | null {
      const found = wordAtPoint(pointerX, pointerY);
      if (!found) return null;

      const range = document.createRange();
      range.setStart(found.node, found.span.start);
      range.setEnd(found.node, found.span.end);

      const decision = shouldHighlight(found.span.text, {
        freq, marks, threshold, isSentenceStart: false,
      });

      const youtube = captureYouTubeSubtitle(found.node, pauseVideo);
      const nearby = sentenceContextAround(found.node, found.span.start);
      return {
        word: found.span.text,
        lemma: decision.lemma,
        rect: range.getBoundingClientRect(),
        sentence: youtube?.sentence ?? nearby.sentence,
        // 字幕是一閃而過的一整塊,沒有「同段落前一句」可言。
        previous: youtube ? '' : nearby.previous,
        source: youtube,
      };
    }

    const consumeKey = (
      e: KeyboardEvent,
      source: YouTubeSubtitle | null = current?.source ?? currentTakeaway?.source ?? currentSentenceSource,
    ) => {
      e.preventDefault();
      if (source) {
        e.stopImmediatePropagation();
        consumedVideoKeys.add(e.key.toLowerCase());
      }
    };
    window.addEventListener('keydown', async (e) => {
      if (isTypingTarget(e.target)) return;
      if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey || (e.key === ' ' && e.shiftKey)) return;
      if (e.repeat && consumedVideoKeys.has(e.key.toLowerCase())) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (e.key === ' ' && e.repeat && (current || currentTakeaway || currentSentenceSource)) {
        consumeKey(e);
        return;
      }

      if (e.key === 'Escape') {
        if (current?.source || currentTakeaway?.source || currentSentenceSource) consumeKey(e);
        hideCard();
        current = null;
        currentTakeaway = null;
        currentSpeech = '';
        currentSentenceSource = null;
        currentDefinition = '';
        resetQuiz();
        dismissAi();
        return;
      }

      if ((e.key === '1' || e.key === '2' || e.key === '3')
        && guessFirst && current && currentQuiz?.state === 'pending') {
        consumeKey(e);
        onQuizPick((Number(e.key) - 1) as 0 | 1 | 2);
        return;
      }

      if (e.key === 'f' || e.key === 'F') {
        // 整句卡念原句；單字卡念實際字形；無卡片時念游標詞。
        const text = currentSpeech || current?.word || hoveredWord()?.word;
        if (!text) return;
        consumeKey(e);
        speak(text);
        return;
      }

      // 卡片開啟時固定操作卡片單字，避免游標移動造成誤標。
      if (e.key === 'x' || e.key === 'X') {
        const hover = current ?? hoveredWord();
        if (!hover) return;
        consumeKey(e, hover.source);
        dismissAi();
        currentTakeaway = null;
        currentSpeech = '';
        currentSentenceSource = null;
        current = hover;
        // 題目還沒作答就被藏起來(不是揭曉),不解除武裝的話 1/2/3 之後還能對著
        // 已經換過的 current 送出張冠李戴的 recordQuiz。
        resetQuiz();

        const status = await browser.runtime.sendMessage({
          type: 'toggleMark', word: hover.lemma, status: 'known',
        }) as WordStatus | null;
        if (status) marks.set(hover.lemma, status);
        else marks.delete(hover.lemma);
        paintHighlights();

        showCard({
          title: wordTitle(hover),
          body: status === 'known' ? '這隻已經馴服了，不再標示。' : '已恢復由詞頻判定。',
          rect: hover.rect,
          hint: wordHint(hover.lemma),
          celebrate: status === 'known',
          onClose: closeAiCard,
        });
        return;
      }

      if ((e.key === 'a' || e.key === 'A') && guessFirst && current && !quizSkipped
        && (currentQuiz?.state === 'pending' || (currentQuiz === null && !lookupSettled))) {
        consumeKey(e);
        quizSkipped = true;
        // 題目已經出來才跳過:揭曉正解而不是整題消失,renderQuizCard 裡
        // 「揭曉但 picked 是 null」那條診斷文字才有機會真的畫出來。題目根本還沒解析出來
        // 就按 A 的情況(currentQuiz 為 null)沒有正解可揭曉,維持原本直接顯示定義。
        if (currentQuiz) currentQuiz = { ...currentQuiz, state: 'revealed', picked: null };
        const hover = current;
        const view = renderQuizCard(wordHint(hover.lemma));
        showCard({
          title: wordTitle(hover), rect: hover.rect,
          body: view.body, hint: view.hint, choices: view.choices, verdict: view.verdict,
          marked: marks.get(hover.lemma) === 'unknown',
          onClose: closeAiCard, onRetry: retry(hover, currentDefinition),
        });
        return;
      }

      if (e.key === 'a' || e.key === 'A') {
        const hover = hoveredWord(true);
        if (!hover) return;
        consumeKey(e, hover.source);
        dismissAi();
        currentTakeaway = null;
        currentSpeech = '';
        currentDefinition = '';
        currentSentenceSource = null;
        current = hover;

        // 已收藏單字再次查詢時累積語境；addContext 負責去重。
        if (marks.get(hover.lemma) === 'unknown') void browser.runtime.sendMessage({
          type: 'saveContext', word: hover.lemma, sentence: hover.sentence,
          url: hover.source?.url ?? location.href, title: hover.source?.title ?? document.title,
        });

        await runLookup(hover);
        return;
      }

      if (e.key === 's' || e.key === 'S' || e.key === 'd' || e.key === 'D') {
        const pos = textPositionAtPoint(pointerX, pointerY);
        if (!pos) return;
        e.preventDefault();

        const { sentence: nearbySentence, previous } = sentenceContextAround(pos.node, pos.offset);
        const source = captureYouTubeSubtitle(pos.node, true);
        const sentence = source?.sentence ?? nearbySentence;
        if (!sentence) return;
        consumeKey(e, source);
        const focus = wordAtPoint(pointerX, pointerY)?.span.text ?? '';

        const range = document.createRange();
        range.selectNodeContents(pos.node);
        const rect = range.getBoundingClientRect();

        const kind = (e.key === 's' || e.key === 'S') ? 'translate' : 'grammar';
        // 整句卡不保留先前的單字操作目標。
        current = null;
        currentTakeaway = null;
        currentSpeech = sentence;
        currentDefinition = '';
        currentSentenceSource = source;
        // current 被清空後,原本掛在那個字上、還沒作答的題目一樣要解除武裝,
        // 不然接下來按 X 換一個字時,這題會被錯記到新換到的那個字上。
        resetQuiz();

        await runExplain(
          { type: 'explain', kind, sentence, previous, focus, title: document.title },
          rect,
          false, '', source ?? undefined,
        );
        return;
      }

      if (e.key === ' ' && currentSentenceSource && !currentTakeaway) {
        consumeKey(e);
        return;
      }

      if (e.key === ' ' && currentTakeaway) {
        consumeKey(e, currentTakeaway.source ?? null);
        const takeaway = currentTakeaway;
        dismissAi();
        const status = await browser.runtime.sendMessage({
          type: 'toggleMark', word: takeaway.phrase,
        }) as WordStatus | null;
        if (status === 'unknown') {
          marks.set(takeaway.phrase, status);
          await browser.runtime.sendMessage({
            type: 'saveContext', word: takeaway.phrase,
            sentence: takeaway.sentence, url: takeaway.source?.url ?? location.href,
            title: takeaway.source?.title ?? document.title,
          });
          // 收藏後沿用查詞流程建立片語詞典快取。
          void browser.runtime.sendMessage({
            type: 'lookup', word: takeaway.phrase, surface: takeaway.phrase,
            sentence: takeaway.sentence,
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

      // Space 固定操作卡片單字。
      if (e.key === ' ' && current) {
        consumeKey(e, current.source);
        const hover = current;
        // dismissAi() 在這支功能之前就會砍掉飛行中的請求,Space 收藏向來如此;
        // 差別是題目把答案擋住了,使用者看不到串流被腰斬。題目揭曉前不能播慶祝動畫
        // (卡片內容其實還是問題,不是剛拿到手的定義),也要留重試鈕撿回被砍掉的定義。
        const quizPending = currentQuiz?.state === 'pending';
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
            url: hover.source?.url ?? location.href,
            title: hover.source?.title ?? document.title,
          });
        } else {
          marks.delete(hover.lemma);
        }
        paintHighlights();

        const view = renderQuizCard(wordHint(hover.lemma));
        showCard({
          title: wordTitle(hover),
          body: view.body,
          rect: hover.rect,
          hint: view.hint,
          choices: view.choices, verdict: view.verdict,
          marked: status === 'unknown',
          celebrate: !quizPending && status === 'unknown',
          onClose: closeAiCard,
          onRetry: quizPending ? retry(hover, currentDefinition) : undefined,
          onPick: onQuizPick,
        });
      }
    }, { signal: controller.signal, capture: true });
    window.addEventListener('keyup', (e) => {
      const key = e.key.toLowerCase();
      if (consumedVideoKeys.delete(key)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }, { signal: controller.signal, capture: true });
  },
});

interface Hover {
  word: string;
  lemma: string;
  rect: DOMRect;
  sentence: string;
  /** 同段落的前一句;字幕與段落第一句沒有,是空字串。 */
  previous: string;
  source: YouTubeSubtitle | null;
}

interface Takeaway {
  phrase: string;
  sentence: string;
  rect: DOMRect;
  body: string;
  source?: YouTubeSubtitle;
}

/**
 * 題目上方那句原句,把查的字標粗。不自己截窗:句長已由 sentenceAround 收在 300 字內,
 * 而三個選項按鈕在 .body 之外,長句只會在 body 內捲動,推不掉按鈕。
 * 以字元數截窗會切在字中間（API 變成 I）,反而讓人猜不出意思。
 * 找不到字形時原樣顯示,寧可不標也不要錯標。
 */
export function quizExcerpt(sentence: string, surface: string): string {
  const text = sentence.trim().replace(/\s+/g, ' ');
  const at = surface ? text.toLowerCase().indexOf(surface.toLowerCase()) : -1;
  if (at < 0) return text;

  const end = at + surface.length;
  // 標粗用原文裡的那一份,大小寫才不會被查詢字形蓋掉。
  return `${text.slice(0, at)}**${text.slice(at, end)}**${text.slice(end)}`;
}

/**
 * Fisher-Yates,產生 [0,1,2] 的隨機排列。
 * 回傳元素型別必須是 `0 | 1 | 2` 而不是 `number`：`order[position]` 會直接存進
 * `Quiz.picked`（型別 `0 | 1 | 2 | null`）並送進 recordQuiz 訊息，元素型別是 number
 * 就過不了 `pnpm typecheck`。
 */
function shuffleOrder(): [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2] {
  const order = [0, 1, 2];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order as [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2];
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
