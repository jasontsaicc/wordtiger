import { afterEach, expect, it, vi } from 'vitest';
import { createApp } from 'vue';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import App from './App.vue';

let cleanup = () => {};
afterEach(() => { cleanup(); vi.restoreAllMocks(); fakeBrowser.reset(); history.replaceState(null, '', '/'); });

it('keeps same-document deep links in sync with the visible screen', async () => {
  vi.spyOn(fakeBrowser.runtime, 'getManifest').mockReturnValue({ manifest_version: 3, name: 'WordTiger', version: '1.8.11' });
  fakeBrowser.runtime.onMessage.addListener((_message, _sender, respond) => { respond([]); return true; });
  history.replaceState(null, '', '#review');
  const root = document.createElement('div');
  const app = createApp(App);
  app.mount(root);
  cleanup = () => app.unmount();
  await vi.waitFor(() => expect(root.querySelector('.brand-hero')).not.toBeNull());
  location.hash = '#contexts';
  await vi.waitFor(() => expect(root.querySelector('input[aria-label="搜尋單字或片語"]')).not.toBeNull());
  expect(root.querySelector('nav [aria-current="page"]')?.textContent).toContain('我的攔路虎');
  location.hash = '#settings';
  await vi.waitFor(() => expect(root.querySelector('.getting-started')).not.toBeNull());
});
