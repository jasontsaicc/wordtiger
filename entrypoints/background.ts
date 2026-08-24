import { handleMessage, type Msg } from '@/src/lib/messages';
import { loadSettings } from '@/src/lib/settings';

export default defineBackground(() => {
  // 用 sendResponse 加 return true,不用「listener 回傳 Promise」那種寫法。
  // 後者在不同瀏覽器和不同 polyfill 設定下的行為不一致,錯了會安靜地收不到回應。
  browser.runtime.onMessage.addListener((msg: Msg, _sender, sendResponse) => {
    handleMessage(msg).then(sendResponse);
    return true; // 保持訊息通道開著,直到 sendResponse 被呼叫
  });

  browser.commands.onCommand.addListener(async (command) => {
    if (command !== 'highlight') return;

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) return;

    const { blockedHosts } = await loadSettings();
    const host = new URL(tab.url).hostname;
    if (blockedHosts.some((h) => host === h || host.endsWith(`.${h}`))) {
      console.warn(`${host} 在黑名單內,不注入`);
      return;
    }

    // Alt+U 這個手勢本身就授予 activeTab,所以這裡不需要 host_permissions
    await browser.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ['content-scripts/highlight.js'],
    });
  });
});
