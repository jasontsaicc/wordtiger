import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { ContentScriptContext } from 'wxt/utils/content-script-context';

// bodies 記錄每一次 showCard 被呼叫時的 body，讓測試能單獨檢查串流那一幀，
// 不會被 done 事件蓋掉 body 之後就看不到。
const card = vi.hoisted(() => ({ body: '', bodies: [] as string[] }));
vi.mock('@/src/content/card', () => ({
  showCard: (opts: { body: string }) => { card.body = opts.body; card.bodies.push(opts.body); },
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
  beforeEach(() => {
    fakeBrowser.reset();
    card.body = '';
    card.bodies = [];
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
      if (msg.type === 'getMarks') sendResponse([]);
      else if (msg.type === 'getHighlightSettings') sendResponse({
        threshold: 5000,
        highlightColors: {},
        highlightTextColors: {},
        highlightUnderlineColors: {},
        markConjunctions: false,
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
      postMessage: () => queueMicrotask(() => {
        listeners.forEach((listener) => listener({
          type: 'delta', delta: '選項｜A｜B｜C\n答案｜1\n忙翻',
        }));
        listeners.forEach((listener) => listener({
          type: 'done', result: { ok: true, text: '選項｜A｜B｜C\n答案｜1\n忙翻' },
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
});
