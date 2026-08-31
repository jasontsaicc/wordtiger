import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { ContentScriptContext } from 'wxt/utils/content-script-context';

// bodies 記錄每一次 showCard 被呼叫時的 body，讓測試能單獨檢查串流那一幀，
// 不會被 done 事件蓋掉 body 之後就看不到。
const card = vi.hoisted(() => ({
  body: '', bodies: [] as string[], choices: undefined as string[] | undefined,
}));
vi.mock('@/src/content/card', () => ({
  showCard: (opts: { body: string; choices?: string[] }) => {
    card.body = opts.body;
    card.bodies.push(opts.body);
    card.choices = opts.choices;
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

import contentScript from '../../entrypoints/highlight.content';

describe('highlight content 快捷鍵', () => {
  let guessFirst = true;
  let recorded: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    fakeBrowser.reset();
    card.body = '';
    card.choices = undefined;
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
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // 讓洗牌結果等於原始順序,方便斷言
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

    await vi.waitFor(() => expect(card.choices).toEqual(['甲', '乙', '丙']));
    expect(card.body).not.toContain('答案｜');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: '2' }));

    await vi.waitFor(() => expect(card.body).toContain('答對了'));
    expect(card.body).toContain('忙翻');
    expect(recorded.some((m) => m.type === 'recordQuiz' && m.picked === 1 && m.right === 1)).toBe(true);
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

    await vi.waitFor(() => expect(card.body).toBe('忙翻'));
    expect(card.choices).toBeUndefined();
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
});
