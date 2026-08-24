import { describe, it, expect } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

describe('測試環境', () => {
  it('fakeBrowser 的 storage 可以讀寫', async () => {
    await fakeBrowser.storage.local.set({ hello: 'world' });
    const got = await fakeBrowser.storage.local.get('hello');
    expect(got.hello).toBe('world');
  });
});
