import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { ContentScriptContext } from 'wxt/utils/content-script-context';

const card = vi.hoisted(() => ({ body: '' }));
vi.mock('@/src/content/card', () => ({
  showCard: (opts: { body: string }) => { card.body = opts.body; },
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
  });
});
