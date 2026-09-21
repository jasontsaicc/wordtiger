import { afterEach, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { observeAppearance } from './appearance';

let stop = () => {};
afterEach(() => { stop(); fakeBrowser.reset(); vi.restoreAllMocks(); });

it('restores appearance, validates storage events, and stops observing on cleanup', async () => {
  await fakeBrowser.storage.local.set({ uiTheme: 'night', uiReducedMotion: true, settings: { apiKey: 'untouched' } });
  const target = document.createElement('div');
  const change = vi.fn();
  stop = observeAppearance(target, change);
  await vi.waitFor(() => expect(target.dataset.theme).toBe('night'));
  expect(target.dataset.motion).toBe('reduce');
  await fakeBrowser.storage.local.set({ uiTheme: 'day', uiReducedMotion: false });
  await vi.waitFor(() => expect(target.dataset.theme).toBe('day'));
  expect(target.dataset.motion).toBe('full');
  expect((await fakeBrowser.storage.local.get('settings')).settings).toEqual({ apiKey: 'untouched' });
  await fakeBrowser.storage.local.set({ uiTheme: 'invalid', uiReducedMotion: 'yes' });
  await vi.waitFor(() => expect(target.dataset.theme).toBe('system'));
  expect(target.dataset.motion).toBe('full');
  stop();
  await fakeBrowser.storage.local.set({ uiTheme: 'night' });
  expect(target.dataset.theme).toBe('system');
});
