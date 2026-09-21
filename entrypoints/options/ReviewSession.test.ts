import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import ReviewSession from './ReviewSession.vue';
import type { ReviewItem } from '@/src/lib/db';

vi.mock('@/src/content/speak', () => ({ speak: vi.fn() }));

let cleanup = () => {};
afterEach(() => { cleanup(); vi.restoreAllMocks(); fakeBrowser.reset(); });

it('先回想原句，揭曉才自評，換題後隱藏答案並支援無原句的單字', async () => {
  fakeBrowser.runtime.onMessage.addListener((_message, _sender, sendResponse) => {
    sendResponse(Date.now());
    return true;
  });
  const sendMessage = vi.spyOn(fakeBrowser.runtime, 'sendMessage');
  const item = ref<ReviewItem>({
    word: 'deploy', definition: '部署', isPhrase: false, isPattern: false,
    canMaster: false,
    context: { sentence: 'We deploy the update tonight.', url: '', title: '' },
  });
  const reviewed = vi.fn(() => {
    item.value = { ...item.value, word: 'reliable', definition: '可靠的', context: undefined };
  });
  const root = document.createElement('div');
  document.body.append(root);
  const app = createApp({ render: () => h(ReviewSession, {
    key: item.value.word, item: item.value, done: 0, total: 2,
    caught: 0, todayDone: 0, onReviewed: reviewed,
  }) });
  app.mount(root);
  cleanup = () => { app.unmount(); root.remove(); };
  const click = async (label: string) => {
    const button = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
    expect(button, label).toBeDefined();
    button!.click();
    await nextTick();
    await nextTick();
  };

  expect(root.querySelector('blockquote')?.textContent).toBe('We deploy the update tonight.');
  expect(root.textContent).not.toContain('部署');
  expect(root.querySelector('.grade-actions')).toBeNull();
  await click('看答案');
  expect(root.textContent).toContain('部署');
  expect(sendMessage).not.toHaveBeenCalled();
  await click('記得');
  expect(sendMessage).toHaveBeenCalledWith({ type: 'reviewWord', word: 'deploy', remembered: true });
  await vi.waitFor(() => expect(reviewed).toHaveBeenCalledWith({ word: 'deploy', remembered: true }));
  await nextTick();
  expect(root.querySelector('.word')?.textContent).toBe('reliable');
  expect(root.querySelector('blockquote')).toBeNull();
  expect(root.textContent).not.toContain('可靠的');
  await click('看答案');
  await click('忘了');
  expect(sendMessage).toHaveBeenLastCalledWith({ type: 'reviewWord', word: 'reliable', remembered: false });
  await vi.waitFor(() => expect(reviewed).toHaveBeenCalledWith({ word: 'reliable', remembered: false }));
});

it('完成畫面使用本輪實際成績；沒有題目時不顯示慶祝', async () => {
  const root = document.createElement('div');
  const total = ref(5);
  const app = createApp({ render: () => h(ReviewSession, {
    item: null, done: 5, total: total.value, caught: 3, todayDone: 8,
  }) });
  app.mount(root);
  cleanup = () => app.unmount();
  expect(root.querySelector('.finish h3')?.textContent).toBe('這一輪，又前進了。');
  expect(root.querySelector('.finish')?.textContent).toContain('3／5');
  expect(root.querySelector('.confetti')).not.toBeNull();
  total.value = 0;
  await nextTick();
  expect(root.querySelector('.finish')).toBeNull();
  expect(root.querySelector('.confetti')).toBeNull();
});
