import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { ContentScriptContext } from 'wxt/utils/content-script-context';

// bodies 記錄每一次 showCard 被呼叫時的 body，讓測試能單獨檢查串流那一幀，
// 不會被 done 事件蓋掉 body 之後就看不到。
const card = vi.hoisted(() => ({
  body: '', bodies: [] as string[], choices: undefined as string[] | undefined,
  onRetry: undefined as (() => void) | undefined,
  celebrate: undefined as boolean | undefined,
  loading: undefined as boolean | undefined,
  verdict: undefined as { kind: string; text: string } | undefined,
}));
vi.mock('@/src/content/card', () => ({
  showCard: (opts: {
    body: string; choices?: string[]; onRetry?: () => void;
    celebrate?: boolean; loading?: boolean;
    verdict?: { kind: string; text: string };
  }) => {
    card.body = opts.body;
    card.bodies.push(opts.body);
    card.choices = opts.choices;
    card.onRetry = opts.onRetry;
    card.celebrate = opts.celebrate;
    card.loading = opts.loading;
    card.verdict = opts.verdict;
  },
  hideCard: vi.fn(),
}));
vi.mock('@/src/content/paint', () => ({
  buildRanges: () => ({
    tiers: { saved: [], learning: [], advanced: [], rare: [] },
    conjunctions: { coordinating: [], clause: [] },
  }),
}));
vi.mock('@/src/content/speak', () => ({ speak: vi.fn() }));

import contentScript, { quizExcerpt } from '../../entrypoints/highlight.content';

describe('highlight content 快捷鍵', () => {
  let guessFirst = true;
  let recorded: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    fakeBrowser.reset();
    card.body = '';
    card.choices = undefined;
    card.onRetry = undefined;
    card.celebrate = undefined;
    card.loading = undefined;
    card.verdict = undefined;
    recorded = [];
    guessFirst = false;
    guessFirst = true;
    card.bodies = [];
    recorded = [];
    document.body.textContent = 'We got slammed with alerts.';
    const text = document.body.firstChild!;
    Object.defineProperty(document, 'caretPositionFromPoint', {
      configurable: true,
      value: () => ({ offsetNode: text, offset: 8 }),
    });
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true, value: () => new DOMRect(),
    });
    vi.stubGlobal('CSS', { highlights: { set: vi.fn(), delete: vi.fn() } });
    vi.stubGlobal('Highlight', class {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({ slam: 6000, slammed: 7000 }),
    }));

    fakeBrowser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      recorded.push(msg);
      if (msg.type === 'getMarks') sendResponse([]);
      else if (msg.type === 'getHighlightSettings') sendResponse({
        threshold: 5000,
        highlightColors: {},
        highlightTextColors: {},
        highlightUnderlineColors: {},
        markConjunctions: false,
        guessFirst,
      });
      else if (msg.type === 'toggleMark') sendResponse(msg.status ?? 'unknown');
      else sendResponse(true);
      return true;
    });

    const listeners: Array<(event: any) => void> = [];
    vi.spyOn(fakeBrowser.runtime, 'connect').mockReturnValue({
      onMessage: { addListener: (listener: (event: any) => void) => listeners.push(listener) },
      onDisconnect: { addListener: vi.fn() },
      postMessage: () => queueMicrotask(() => {
        listeners.forEach((listener) => listener({ type: 'delta', delta: '忙翻' }));
        listeners.forEach((listener) => listener({
          type: 'done', result: { ok: true, text: '忙翻' },
        }));
      }),
      disconnect: vi.fn(),
    } as any);
  });

  afterEach(() => {
    window.__wordTigerAbort?.abort();
    window.__wordTigerAbort = undefined;
    delete (Range.prototype as any).getBoundingClientRect;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('查詞後按 X 再按 Space 仍保留定義', async () => {
    await contentScript.main(new ContentScriptContext('test'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));
    await vi.waitFor(() => expect(card.body).toBe('忙翻'));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'X' }));
    await vi.waitFor(() => expect(card.body).toContain('馴服'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));

    await vi.waitFor(() => expect(card.body).toBe('忙翻'));
  });

  it('串流與結果都會剝除選項與答案行,不外流到畫面上', async () => {
    const listeners: Array<(event: any) => void> = [];
    vi.spyOn(fakeBrowser.runtime, 'connect').mockReturnValue({
      onMessage: { addListener: (listener: (event: any) => void) => listeners.push(listener) },
      onDisconnect: { addListener: vi.fn() },
      // 答案｜9 超出 1-3,extractQuiz 刻意讓它回 null,這樣才是在測「就算抽取失敗仍要
      // 剝除」這個 stripQuiz 的不變式,而不是被 Task 11 的 guessFirst 出題流程接手蓋掉。
      // 抽取成功時的作答流程,由下面 guessFirst 的專屬測試涵蓋。
      postMessage: () => queueMicrotask(() => {
        listeners.forEach((listener) => listener({
          type: 'delta', delta: '選項｜A｜B｜C\n答案｜9\n忙翻',
        }));
        listeners.forEach((listener) => listener({
          type: 'done', result: { ok: true, text: '選項｜A｜B｜C\n答案｜9\n忙翻' },
        }));
      }),
      disconnect: vi.fn(),
    } as any);

    await contentScript.main(new ContentScriptContext('test'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));

    await vi.waitFor(() => expect(card.body).toBe('忙翻'));
    expect(card.body).not.toContain('選項｜');

    // delta 與 done 幾乎同一個 microtask 內連發，只看最終 card.body 會被 done
    // 那次呼叫蓋掉，測不出串流那次剝除有沒有做。改查完整呼叫紀錄，
    // 確保串流那一次的 showCard 呼叫本身也沒有帶著選項／答案行。
    expect(card.bodies.some((body) => body.includes('選項｜'))).toBe(false);
  });

  it('guessFirst 開啟時,選項出現後可以用數字鍵作答,答對會揭曉完整定義並寫入 quizLog', async () => {
    // random() 回 0 讓 shuffleOrder 洗出 [1,2,0]（不是原始順序 [0,1,2]），這樣才會
    // 真的驗證到「畫面位置換算回原始索引」這件事：如果程式錯誤地直接把畫面位置存進
    // picked，這裡選第 1 個位置會答錯（原始順序時兩者長得一樣,測不出差異）。
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const listeners: Array<(event: any) => void> = [];
    vi.spyOn(fakeBrowser.runtime, 'connect').mockReturnValue({
      onMessage: { addListener: (listener: (event: any) => void) => listeners.push(listener) },
      onDisconnect: { addListener: vi.fn() },
      postMessage: () => queueMicrotask(() => {
        const text = '選項｜甲｜乙｜丙\n答案｜2\n忙翻';
        listeners.forEach((listener) => listener({ type: 'delta', delta: text }));
        listeners.forEach((listener) => listener({ type: 'done', result: { ok: true, text } }));
      }),
      disconnect: vi.fn(),
    } as any);

    await contentScript.main(new ContentScriptContext('test'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));

    // order=[1,2,0]:畫面第 0 個位置顯示 choices[1]='乙',第 1 個顯示 choices[2]='丙',
    // 第 2 個顯示 choices[0]='甲'。
    await vi.waitFor(() => expect(card.choices).toEqual(['乙', '丙', '甲']));
    expect(card.body).not.toContain('答案｜');

    // 正解原始索引是 1（答案｜2）,對應畫面第 0 個位置（order[0] === 1）,按鍵是 '1'。
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));

    await vi.waitFor(() => expect(card.verdict?.kind).toBe('right'));
    expect(card.verdict?.text).toContain('答對了');
    expect(card.body).toContain('忙翻');
    // 揭曉後 body 只有詞典本文,對錯回饋走 verdict,不再混在 Markdown 裡。
    expect(card.body).not.toContain('答對了');
    expect(recorded.some((m) => m.type === 'recordQuiz' && m.picked === 1 && m.right === 1)).toBe(true);
  });

  it('題目要帶著原句和被查的字,不然不知道拿什麼去猜', async () => {
    const listeners: Array<(event: any) => void> = [];
    vi.spyOn(fakeBrowser.runtime, 'connect').mockReturnValue({
      onMessage: { addListener: (listener: (event: any) => void) => listeners.push(listener) },
      onDisconnect: { addListener: vi.fn() },
      postMessage: () => queueMicrotask(() => {
        const text = '選項｜甲｜乙｜丙\n答案｜2\n忙翻';
        listeners.forEach((listener) => listener({ type: 'delta', delta: text }));
        listeners.forEach((listener) => listener({ type: 'done', result: { ok: true, text } }));
      }),
      disconnect: vi.fn(),
    } as any);

    await contentScript.main(new ContentScriptContext('test'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));

    await vi.waitFor(() => expect(card.choices).toHaveLength(3));
    expect(card.body).toContain('We got **slammed** with alerts.');
    expect(card.body).toContain('猜猜看');
    // 段落第一句沒有前一句,不能留一行空標籤佔位。
    expect(card.body).not.toContain('前一句');
    // 題目階段仍然不能外洩定義。
    expect(card.body).not.toContain('忙翻');
  });

  // 目標句只有代名詞時,線索住在前一句。少了它不是題目難,是無解,只能亂猜。
  it('原句帶代名詞時,同段落前一句要一起給', async () => {
    document.body.innerHTML =
      '<p>The gateway tracks each client. It was slammed with alerts.</p>';
    const node = document.querySelector('p')!.firstChild as Text;
    Object.defineProperty(document, 'caretPositionFromPoint', {
      configurable: true,
      value: () => ({ offsetNode: node, offset: node.data.indexOf('slammed') + 1 }),
    });

    const listeners: Array<(event: any) => void> = [];
    vi.spyOn(fakeBrowser.runtime, 'connect').mockReturnValue({
      onMessage: { addListener: (listener: (event: any) => void) => listeners.push(listener) },
      onDisconnect: { addListener: vi.fn() },
      postMessage: () => queueMicrotask(() => {
        const text = '選項｜甲｜乙｜丙\n答案｜2\n忙翻';
        listeners.forEach((listener) => listener({ type: 'delta', delta: text }));
        listeners.forEach((listener) => listener({ type: 'done', result: { ok: true, text } }));
      }),
      disconnect: vi.fn(),
    } as any);

    await contentScript.main(new ContentScriptContext('test'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));

    await vi.waitFor(() => expect(card.choices).toHaveLength(3));
    expect(card.body).toContain('前一句｜The gateway tracks each client.');
    expect(card.body).toContain('It was **slammed** with alerts.');
    expect(card.body).not.toContain('忙翻');
  });

  it('guessFirst 開啟時,選項出現後按 A 直接跳過,不寫入 quizLog', async () => {
    const listeners: Array<(event: any) => void> = [];
    vi.spyOn(fakeBrowser.runtime, 'connect').mockReturnValue({
      onMessage: { addListener: (listener: (event: any) => void) => listeners.push(listener) },
      onDisconnect: { addListener: vi.fn() },
      postMessage: () => queueMicrotask(() => {
        const text = '選項｜甲｜乙｜丙\n答案｜2\n忙翻';
        listeners.forEach((listener) => listener({ type: 'delta', delta: text }));
        listeners.forEach((listener) => listener({ type: 'done', result: { ok: true, text } }));
      }),
      disconnect: vi.fn(),
    } as any);

    await contentScript.main(new ContentScriptContext('test'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));
    await vi.waitFor(() => expect(card.choices).toBeTruthy());

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));

    // 跳過會揭曉正解(見「題目已出現時按 A 跳過」那個測試),不是整題消失,
    // 但重點是不寫入 quizLog:略過不算作答。
    await vi.waitFor(() => expect(card.verdict?.kind).toBe('skipped'));
    expect(card.body).toContain('忙翻');
    expect(card.choices).toBeUndefined();
    expect(recorded.some((m) => m.type === 'recordQuiz')).toBe(false);
  });

  it('題目還沒作答時點重試鈕,不會把答案洩漏到 loading 畫面上', async () => {
    // 一定要真的送 done、讓 result?.ok 那個分支跑完,漏洞就在那個分支的
    // onRetry: retry(hover, currentDefinition)。只送 delta 拿到的是串流那次
    // showCard 的 onRetry（retry(hover, previous)，previous 本來就是空字串)，
    // 測不出這個漏洞。
    const listeners: Array<(event: any) => void> = [];
    vi.spyOn(fakeBrowser.runtime, 'connect').mockReturnValue({
      onMessage: { addListener: (listener: (event: any) => void) => listeners.push(listener) },
      onDisconnect: { addListener: vi.fn() },
      postMessage: () => queueMicrotask(() => {
        const text = '選項｜甲｜乙｜丙\n答案｜2\n忙翻';
        listeners.forEach((listener) => listener({ type: 'delta', delta: text }));
        listeners.forEach((listener) => listener({ type: 'done', result: { ok: true, text } }));
      }),
      disconnect: vi.fn(),
    } as any);

    await contentScript.main(new ContentScriptContext('test'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));

    await vi.waitFor(() => expect(card.choices).toHaveLength(3)); // 洗牌順序不是本測試重點

    const onRetry = card.onRetry;
    expect(onRetry).toBeTypeOf('function');
    onRetry!();

    // 重試鈕點下去的當下同步執行到 loading 卡片那次 showCard,還沒有新的串流資料進來。
    expect(card.body).not.toContain('忙翻');
    expect(card.body).toBe('老虎正在抓這個字…');
    expect(card.choices).toBeUndefined();
  });

  it('串流先出現題目後卻查詢失敗時,不留下懸空的題目狀態(不能再被作答)', async () => {
    const listeners: Array<(event: any) => void> = [];
    vi.spyOn(fakeBrowser.runtime, 'connect').mockReturnValue({
      onMessage: { addListener: (listener: (event: any) => void) => listeners.push(listener) },
      onDisconnect: { addListener: vi.fn() },
      postMessage: () => queueMicrotask(() => {
        listeners.forEach((listener) => listener({
          type: 'delta', delta: '選項｜甲｜乙｜丙\n答案｜2\n忙翻',
        }));
        listeners.forEach((listener) => listener({
          type: 'done', result: { ok: false, error: '模擬失敗' },
        }));
      }),
      disconnect: vi.fn(),
    } as any);

    await contentScript.main(new ContentScriptContext('test'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));

    await vi.waitFor(() => expect(card.body).toContain('查詢失敗'));

    // 題目在串流時已經武裝過,但最終查詢失敗,使用者從沒看過選項畫面。
    // 這一題不該再能被作答,按數字鍵不該送出 recordQuiz。
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '2' }));
    expect(recorded.some((m) => m.type === 'recordQuiz')).toBe(false);
  });

  it('guessFirst 關閉時,卡片不含答案｜也不顯示選項', async () => {
    guessFirst = false;
    const listeners: Array<(event: any) => void> = [];
    vi.spyOn(fakeBrowser.runtime, 'connect').mockReturnValue({
      onMessage: { addListener: (listener: (event: any) => void) => listeners.push(listener) },
      onDisconnect: { addListener: vi.fn() },
      postMessage: () => queueMicrotask(() => {
        const text = '選項｜甲｜乙｜丙\n答案｜2\n忙翻';
        listeners.forEach((listener) => listener({ type: 'delta', delta: text }));
        listeners.forEach((listener) => listener({ type: 'done', result: { ok: true, text } }));
      }),
      disconnect: vi.fn(),
    } as any);

    await contentScript.main(new ContentScriptContext('test'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));

    await vi.waitFor(() => expect(card.body).toBe('忙翻'));
    expect(card.body).not.toContain('答案｜');
    expect(card.choices).toBeUndefined();
  });

  it('題目從頭到尾沒有解析出來時,A 仍會對游標下的字重新查詞,不會被誤判成跳過鍵', async () => {
    let lookups = 0;
    const listeners: Array<(event: any) => void> = [];
    vi.spyOn(fakeBrowser.runtime, 'connect').mockImplementation(() => {
      lookups++;
      return {
        onMessage: { addListener: (listener: (event: any) => void) => listeners.push(listener) },
        onDisconnect: { addListener: vi.fn() },
        postMessage: () => queueMicrotask(() => {
          listeners.forEach((listener) => listener({ type: 'delta', delta: '忙翻' }));
          listeners.forEach((listener) => listener({ type: 'done', result: { ok: true, text: '忙翻' } }));
        }),
        disconnect: vi.fn(),
      } as any;
    });

    await contentScript.main(new ContentScriptContext('test'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));
    await vi.waitFor(() => expect(card.body).toBe('忙翻'));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));

    await vi.waitFor(() => expect(lookups).toBe(2));
  });

  it('Space 收藏取消了還在飛的查詢後,按 A 查下一個字不會被誤判成跳過鍵', async () => {
    let lookups = 0;
    vi.spyOn(fakeBrowser.runtime, 'connect').mockImplementation(() => {
      lookups++;
      return {
        onMessage: { addListener: vi.fn() },
        onDisconnect: { addListener: vi.fn() },
        // 永遠不觸發 delta/done,模擬這個字的查詢一直卡在飛行中,直到被 dismissAi() 取消。
        postMessage: vi.fn(),
        disconnect: vi.fn(),
      } as any;
    });

    await contentScript.main(new ContentScriptContext('test'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' })); // word1,查詢卡在飛行中
    expect(lookups).toBe(1);

    // Space 收藏會呼叫 dismissAi() 取消飛行中的查詢,但不會再另外開一次 runLookup。
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    expect(lookups).toBe(1);

    // 這個字從頭到尾沒有 lookupSettled=true 的機會(直到 dismissAi 自己補上),
    // A 不該被永遠卡在跳過分支,查下一個字要正常觸發新的查詢連線。
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));
    expect(lookups).toBe(2);
  });

  it('答案那行還沒收到換行前不出題,收到換行與後續內容後才出題', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // 讓洗牌結果等於原始順序,方便斷言
    const listeners: Array<(event: any) => void> = [];
    vi.spyOn(fakeBrowser.runtime, 'connect').mockReturnValue({
      onMessage: { addListener: (listener: (event: any) => void) => listeners.push(listener) },
      onDisconnect: { addListener: vi.fn() },
      postMessage: vi.fn(), // 手動控制每一幀 delta，不靠自動觸發
      disconnect: vi.fn(),
    } as any);

    await contentScript.main(new ContentScriptContext('test'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));

    // 答案行收到「2」但還沒收到換行，extractQuiz 就算能解析出合法結果也不該武裝。
    listeners.forEach((listener) => listener({
      type: 'delta', delta: '選項｜甲｜乙｜丙\n答案｜2',
    }));
    await vi.waitFor(() => expect(card.body).toBe(''));
    expect(card.choices).toBeUndefined();

    // 換行與後續內容都到了，答案行確定收完，才出題。
    listeners.forEach((listener) => listener({ type: 'delta', delta: '\n忙翻' }));
    await vi.waitFor(() => expect(card.choices).toEqual(['甲', '乙', '丙']));
  });

  it('題目還沒解析出來、查詢也還在飛時按 A,會被當成跳過鍵,不會誤判成查下一個字,也不會等換行後補武裝', async () => {
    const listeners: Array<(event: any) => void> = [];
    vi.spyOn(fakeBrowser.runtime, 'connect').mockReturnValue({
      onMessage: { addListener: (listener: (event: any) => void) => listeners.push(listener) },
      onDisconnect: { addListener: vi.fn() },
      postMessage: vi.fn(), // 手動控制每一幀 delta，不靠自動觸發、也不送 done
      disconnect: vi.fn(),
    } as any);

    await contentScript.main(new ContentScriptContext('test'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));
    expect(fakeBrowser.runtime.connect).toHaveBeenCalledTimes(1);

    // 答案行還沒換行,currentQuiz 仍是 null,但查詢還在飛(lookupSettled 是 false)。
    // 這正是「還不確定有沒有題目」的中間態,A 要落在跳過分支,不能落到查下一個字的分支。
    listeners.forEach((listener) => listener({
      type: 'delta', delta: '選項｜甲｜乙｜丙\n答案｜2',
    }));
    await vi.waitFor(() => expect(card.body).toBe(''));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));

    // 落在跳過分支的話不會呼叫 hoveredWord() 重新查詞,不會有新的 connect()。
    expect(fakeBrowser.runtime.connect).toHaveBeenCalledTimes(1);
    expect(card.choices).toBeUndefined();

    // 就算後面確定還有一行(代表答案行已換行),題目已經被跳過就不該補武裝,
    // 應該直接顯示串流累積出的完整定義。
    listeners.forEach((listener) => listener({ type: 'delta', delta: '\n忙翻' }));
    await vi.waitFor(() => expect(card.body).toBe('忙翻'));
    expect(card.choices).toBeUndefined();
  });

  it('題目已出現時按 A 跳過,揭曉正解而不是整題消失', async () => {
    const listeners: Array<(event: any) => void> = [];
    vi.spyOn(fakeBrowser.runtime, 'connect').mockReturnValue({
      onMessage: { addListener: (listener: (event: any) => void) => listeners.push(listener) },
      onDisconnect: { addListener: vi.fn() },
      postMessage: () => queueMicrotask(() => {
        const text = '選項｜甲｜乙｜丙\n答案｜2\n忙翻';
        listeners.forEach((listener) => listener({ type: 'delta', delta: text }));
        listeners.forEach((listener) => listener({ type: 'done', result: { ok: true, text } }));
      }),
      disconnect: vi.fn(),
    } as any);

    await contentScript.main(new ContentScriptContext('test'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));
    await vi.waitFor(() => expect(card.choices).toHaveLength(3));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));

    await vi.waitFor(() => expect(card.verdict?.kind).toBe('skipped'));
    expect(card.verdict?.text).toContain('乙'); // 正解(答案｜2 → 原始索引 1)是「乙」
    expect(card.body).toContain('忙翻');
    expect(card.choices).toBeUndefined();
  });

  it('題目還沒作答時按 X,題目會解除武裝,之後按數字鍵不會誤送 recordQuiz', async () => {
    const listeners: Array<(event: any) => void> = [];
    vi.spyOn(fakeBrowser.runtime, 'connect').mockReturnValue({
      onMessage: { addListener: (listener: (event: any) => void) => listeners.push(listener) },
      onDisconnect: { addListener: vi.fn() },
      postMessage: () => queueMicrotask(() => {
        const text = '選項｜甲｜乙｜丙\n答案｜2\n忙翻';
        listeners.forEach((listener) => listener({ type: 'delta', delta: text }));
        listeners.forEach((listener) => listener({ type: 'done', result: { ok: true, text } }));
      }),
      disconnect: vi.fn(),
    } as any);

    await contentScript.main(new ContentScriptContext('test'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));
    await vi.waitFor(() => expect(card.choices).toHaveLength(3));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'X' }));
    await vi.waitFor(() => expect(card.body).toContain('馴服'));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    expect(recorded.some((m) => m.type === 'recordQuiz')).toBe(false);
  });

  it('題目還沒作答時按 S 開整句卡,題目會解除武裝,之後 X 換字再按數字鍵不會誤送 recordQuiz', async () => {
    const listeners: Array<(event: any) => void> = [];
    vi.spyOn(fakeBrowser.runtime, 'connect').mockReturnValue({
      onMessage: { addListener: (listener: (event: any) => void) => listeners.push(listener) },
      onDisconnect: { addListener: vi.fn() },
      postMessage: () => queueMicrotask(() => {
        const text = '選項｜甲｜乙｜丙\n答案｜2\n忙翻';
        listeners.forEach((listener) => listener({ type: 'delta', delta: text }));
        listeners.forEach((listener) => listener({ type: 'done', result: { ok: true, text } }));
      }),
      disconnect: vi.fn(),
    } as any);

    await contentScript.main(new ContentScriptContext('test'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));
    await vi.waitFor(() => expect(card.choices).toHaveLength(3));

    // S 開整句卡:current 被清空,舊題目此時也要被解除武裝(修正前只有 current 被清空)。
    // 整句卡的 AI 請求走 port,不是 sendMessage,用 connect 被呼叫的次數確認流程真的跑了。
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'S' }));
    await vi.waitFor(() => expect(fakeBrowser.runtime.connect).toHaveBeenCalledTimes(2));

    // 換一個字(這裡的座標 stub 固定指回同一個字,重點是 current 重新指過一輪)。
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'X' }));
    await vi.waitFor(() => expect(card.body).toContain('馴服'));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    expect(recorded.some((m) => m.type === 'recordQuiz')).toBe(false);
  });

  it('題目未答完時按 Space 收藏,串流雖然被砍斷,但不播慶祝動畫且留著重試鈕撿回定義', async () => {
    const listeners: Array<(event: any) => void> = [];
    vi.spyOn(fakeBrowser.runtime, 'connect').mockReturnValue({
      onMessage: { addListener: (listener: (event: any) => void) => listeners.push(listener) },
      onDisconnect: { addListener: vi.fn() },
      postMessage: () => queueMicrotask(() => {
        listeners.forEach((listener) => listener({
          type: 'delta', delta: '選項｜甲｜乙｜丙\n答案｜2\n忙翻',
        }));
        // 故意不送 done:模擬 Space 砍斷串流前,這次查詢還在飛。
      }),
      disconnect: vi.fn(),
    } as any);

    await contentScript.main(new ContentScriptContext('test'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));
    await vi.waitFor(() => expect(card.choices).toHaveLength(3));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await vi.waitFor(() => expect(card.celebrate).toBe(false));

    // 題目還在畫面上(沒有被 Space 意外揭曉或清空),且留著重試鈕。
    expect(card.choices).toHaveLength(3);
    expect(card.onRetry).toBeTypeOf('function');
  });

  it('第一個 delta 就是一般字典內容(模型沒出題)時,查詢還沒 done,A 也要立刻可用', async () => {
    let lookups = 0;
    const listeners: Array<(event: any) => void> = [];
    vi.spyOn(fakeBrowser.runtime, 'connect').mockImplementation(() => {
      lookups++;
      return {
        onMessage: { addListener: (listener: (event: any) => void) => listeners.push(listener) },
        onDisconnect: { addListener: vi.fn() },
        postMessage: vi.fn(), // 手動控制 delta,不送 done,模擬還在飛
        disconnect: vi.fn(),
      } as any;
    });

    await contentScript.main(new ContentScriptContext('test'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));
    expect(lookups).toBe(1);

    // 模型沒有照格式先出題,第一行就是一般字典內容。
    listeners.forEach((listener) => listener({ type: 'delta', delta: '這個字常見的意思是…' }));
    await vi.waitFor(() => expect(card.body).toBe('這個字常見的意思是…'));

    // 這次查詢還沒 done,但已經知道不會有題目了,A 不該被當跳過鍵吃掉,
    // 應該直接對游標下的字重新查詞。
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));
    expect(lookups).toBe(2);
  });

  it('題目還沒作答完就在串流中被回答,答題當下的卡片仍是 loading,避免完成動畫提早播放又被打斷', async () => {
    const listeners: Array<(event: any) => void> = [];
    vi.spyOn(fakeBrowser.runtime, 'connect').mockReturnValue({
      onMessage: { addListener: (listener: (event: any) => void) => listeners.push(listener) },
      onDisconnect: { addListener: vi.fn() },
      postMessage: vi.fn(), // 手動控制,不自動送 done
      disconnect: vi.fn(),
    } as any);

    await contentScript.main(new ContentScriptContext('test'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));

    listeners.forEach((listener) => listener({
      type: 'delta', delta: '選項｜甲｜乙｜丙\n答案｜2\n忙翻',
    }));
    await vi.waitFor(() => expect(card.choices).toHaveLength(3));

    // 串流還沒送 done,這時候答題,卡片要維持 loading。
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    expect(card.loading).toBe(true);
  });
});

describe('quizExcerpt', () => {
  it('把查到的字標粗,大小寫以原文為準', () => {
    expect(quizExcerpt('We got Slammed with alerts.', 'slammed'))
      .toBe('We got **Slammed** with alerts.');
  });

  // 舊版以字元數截前後各 40,會把 API 切成 I、consecutive 切成 cons,
  // 猜題的人看到殘句反而猜不出來。整句照出,長度由 sentenceAround 收在 300 字內。
  it('長句整句照出,不切在字中間', () => {
    const long = 'When a request exceeds the configured quota, the API gateway'
      + ' returns 429 and the client is throttled until the window resets.';

    expect(quizExcerpt(long, 'throttled')).toBe(
      'When a request exceeds the configured quota, the API gateway'
      + ' returns 429 and the client is **throttled** until the window resets.',
    );
  });

  it('句子裡找不到那個字形時整句照出,不硬標也不截頭', () => {
    const text = `The gateway rejected the request ${'and retried '.repeat(20)}once more.`;
    expect(quizExcerpt(text, 'throttle')).toBe(text);
    expect(quizExcerpt(text, 'throttle')).not.toContain('**');
    expect(quizExcerpt(text, 'throttle')).not.toContain('…');
  });

  it('換行與連續空白收成單一空格,卡片不會被撐開', () => {
    expect(quizExcerpt('We got\n  slammed\twith alerts.', 'slammed'))
      .toBe('We got **slammed** with alerts.');
  });
});

describe('YouTube 字幕快捷鍵整合', () => {
  let originalTitle = '';
  let playerEvents: AbortController;
  let youtubeRecorded: Array<Record<string, unknown>> = [];
  beforeEach(() => {
    fakeBrowser.reset();
    playerEvents = new AbortController();
    originalTitle = document.title;
    card.body = '';
    card.bodies = [];
    card.choices = undefined;
    card.onRetry = undefined;
    card.celebrate = undefined;
    card.loading = undefined;
    card.verdict = undefined;
    youtubeRecorded = [];
    document.body.textContent = 'We got slammed with alerts.';
    const text = document.body.firstChild!;
    Object.defineProperty(document, 'caretPositionFromPoint', {
      configurable: true, value: () => ({ offsetNode: text, offset: 8 }),
    });
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true, value: () => new DOMRect(),
    });
    vi.stubGlobal('CSS', { highlights: { set: vi.fn(), delete: vi.fn() } });
    vi.stubGlobal('Highlight', class {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ slam: 6000, slammed: 7000 }) }));
    fakeBrowser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      youtubeRecorded.push(msg);
      if (msg.type === 'getMarks') sendResponse([]);
      else if (msg.type === 'getHighlightSettings') sendResponse({
        threshold: 5000, highlightColors: {}, highlightTextColors: {},
        highlightUnderlineColors: {}, markConjunctions: false, guessFirst: false,
      });
      else if (msg.type === 'toggleMark') sendResponse(msg.status ?? 'unknown');
      else sendResponse(true);
      return true;
    });
    const streamListeners: Array<(event: any) => void> = [];
    vi.spyOn(fakeBrowser.runtime, 'connect').mockReturnValue({
      onMessage: { addListener: (listener: (event: any) => void) => streamListeners.push(listener) },
      onDisconnect: { addListener: vi.fn() },
      postMessage: () => queueMicrotask(() => {
        streamListeners.forEach((listener) => listener({ type: 'delta', delta: '忙翻' }));
        streamListeners.forEach((listener) => listener({ type: 'done', result: { ok: true, text: '忙翻' } }));
      }),
      disconnect: vi.fn(),
    } as any);
  });
  afterEach(() => {
    playerEvents.abort();
    window.__wordTigerAbort?.abort();
    window.__wordTigerAbort = undefined;
    document.title = originalTitle;
    delete (Range.prototype as any).getBoundingClientRect;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const youtubeFixture = (time = 125) => {
    document.body.innerHTML = `
      <div class="html5-video-player"><video></video>
        <div class="ytp-caption-window-container"><span class="ytp-caption-segment">We got slammed with alerts.</span></div>
      </div>`;
    const text = document.querySelector('.ytp-caption-segment')!.firstChild!;
    const video = document.querySelector('video')!;
    Object.defineProperty(document, 'caretPositionFromPoint', {
      configurable: true, value: () => ({ offsetNode: text, offset: 8 }),
    });
    Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: time });
    Object.defineProperty(video, 'pause', { configurable: true, value: vi.fn() });
    vi.stubGlobal('location', new URL('https://www.youtube.com/watch?v=abc'));
    document.title = 'A video';
    return video as HTMLVideoElement;
  };

  it('A 暫停並固定 125 秒來源,之後 Space 只收藏一次且沿用原標題與時間', async () => {
    const video = youtubeFixture();
    await contentScript.main(new ContentScriptContext('youtube'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));
    await vi.waitFor(() => expect(card.body).toBe('忙翻'));
    expect(video.pause).toHaveBeenCalledTimes(1);

    Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 300 });
    document.title = 'Changed title';
    vi.stubGlobal('location', new URL('https://www.youtube.com/watch?v=other'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await vi.waitFor(() => expect(youtubeRecorded.some((m) => m.type === 'saveContext')).toBe(true));
    expect(youtubeRecorded.filter((m) => m.type === 'toggleMark')).toHaveLength(1);
    const saved = youtubeRecorded.find((m) => m.type === 'saveContext')!;
    expect(saved.url).toBe('https://www.youtube.com/watch?v=abc&t=125s');
    expect(saved.title).toBe('A video · 2:05');
  });

  it('Space 的 down/repeat/up 與 Escape up 隔離播放器,關卡後新的 Space 可傳播放器', async () => {
    youtubeFixture();
    const playerKeys: string[] = [];
    document.addEventListener('keydown', (e) => playerKeys.push(`down:${e.key}`), { signal: playerEvents.signal });
    document.addEventListener('keyup', (e) => playerKeys.push(`up:${e.key}`), { signal: playerEvents.signal });
    await contentScript.main(new ContentScriptContext('youtube'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));
    await vi.waitFor(() => expect(card.body).toBe('忙翻'));
    playerKeys.length = 0;

    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', repeat: false }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', repeat: true }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: ' ' }));
    expect(playerKeys).toEqual([]);
    expect(youtubeRecorded.filter((m) => m.type === 'toggleMark')).toHaveLength(1);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape' }));
    expect(playerKeys).toEqual([]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    expect(playerKeys).toEqual(['down: ']);
  });

  it('S 暫停但沒有帶走片語時 Space 不收藏也不傳播放器', async () => {
    const video = youtubeFixture();
    const player = vi.fn();
    document.addEventListener('keydown', player, { signal: playerEvents.signal });
    vi.spyOn(fakeBrowser.runtime, 'connect').mockImplementation(() => ({
      onMessage: { addListener: (listener: (event: any) => void) => queueMicrotask(() => listener({ type: 'done', result: { ok: true, text: '只有句意' } })) },
      onDisconnect: { addListener: vi.fn() }, postMessage: vi.fn(), disconnect: vi.fn(),
    } as any));
    await contentScript.main(new ContentScriptContext('youtube'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'S' }));
    await vi.waitFor(() => expect(card.body).toContain('只有句意'));
    expect(video.pause).toHaveBeenCalledTimes(1);
    const before = youtubeRecorded.filter((m) => m.type === 'toggleMark').length;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    expect(youtubeRecorded.filter((m) => m.type === 'toggleMark')).toHaveLength(before);
    expect(player).not.toHaveBeenCalled();
  });

  it('D 重試仍以第一次暫停的時間與標題收藏帶走片語', async () => {
    const video = youtubeFixture();
    const first = '意思｜若失敗就回滾\n帶走｜be rolled back｜被回滾';
    const listeners: Array<(event: any) => void> = [];
    vi.spyOn(fakeBrowser.runtime, 'connect').mockReturnValue({
      onMessage: { addListener: (listener: (event: any) => void) => listeners.push(listener) },
      onDisconnect: { addListener: vi.fn() },
      postMessage: () => queueMicrotask(() => listeners.at(-1)?.({ type: 'done', result: { ok: true, text: first } })),
      disconnect: vi.fn(),
    } as any);
    await contentScript.main(new ContentScriptContext('youtube'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'D' }));
    await vi.waitFor(() => expect(card.body).toContain('帶走'));
    expect(video.pause).toHaveBeenCalledTimes(1);
    Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 300 });
    document.title = 'Changed title';
    card.onRetry?.();
    expect(card.loading).toBe(true);
    await vi.waitFor(() => expect(card.loading).not.toBe(true));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await vi.waitFor(() => expect(youtubeRecorded.some((m) => m.type === 'saveContext' && m.word === 'be rolled back')).toBe(true));
    const saved = youtubeRecorded.find((m) => m.type === 'saveContext' && m.word === 'be rolled back')!;
    expect(saved.url).toBe('https://www.youtube.com/watch?v=abc&t=125s');
    expect(saved.title).toBe('A video · 2:05');
  });

  it('普通 p 文字不暫停,輸入框與 Ctrl key passthrough', async () => {
    document.body.innerHTML = '<div class="html5-video-player"><video></video><p>We got slammed.</p></div>';
    const text = document.querySelector('p')!.firstChild!;
    const video = document.querySelector('video')!;
    Object.defineProperty(document, 'caretPositionFromPoint', { configurable: true, value: () => ({ offsetNode: text, offset: 8 }) });
    Object.defineProperty(video, 'pause', { configurable: true, value: vi.fn() });
    vi.stubGlobal('location', new URL('https://www.youtube.com/watch?v=abc'));
    const player = vi.fn();
    document.addEventListener('keydown', player, { signal: playerEvents.signal });
    await contentScript.main(new ContentScriptContext('youtube'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A', ctrlKey: true }));
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'A', bubbles: true }));
    expect(video.pause).not.toHaveBeenCalled();
    expect(player).toHaveBeenCalled();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));
    await vi.waitFor(() => expect(card.body).toBe('忙翻'));
    expect(video.pause).not.toHaveBeenCalled();
  });
});
