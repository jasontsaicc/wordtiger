import { handleMessage, type Msg } from '@/src/lib/messages';
import { loadSettings } from '@/src/lib/settings';

export default defineBackground(() => {
  // 用 sendResponse 加 return true,不用「listener 回傳 Promise」那種寫法。
  // 後者在不同瀏覽器和不同 polyfill 設定下的行為不一致,錯了會安靜地收不到回應。
  browser.runtime.onMessage.addListener((msg: Msg, _sender, sendResponse) => {
    // catch 不能省。上面已經 return true 答應瀏覽器「等我回話」,
    // handleMessage 一 reject 就再也沒人呼叫 sendResponse,通道會一直開著,
    // 呼叫端的 await 永遠不會 settle:不回應、不拋錯、不逾時,畫面就這樣白掉。
    // 回 undefined 至少讓呼叫端立刻拿到結果,錯誤留在 service worker console。
    handleMessage(msg)
      .then(sendResponse)
      .catch((err) => {
        console.error('[pv] handleMessage 失敗', msg.type, err);
        sendResponse(undefined);
      });
    return true; // 保持訊息通道開著,直到 sendResponse 被呼叫
  });

  // 兩個入口:Alt+U 和點工具列圖示。兩者都是「使用者手勢」,都會授予 activeTab,
  // 所以注入邏輯完全一樣,只有觸發方式不同。分成兩個 listener 共用一個函式,
  // 出問題時可以拿圖示當對照組,判斷是快捷鍵那一層壞了還是注入那一層壞了。
  browser.commands.onCommand.addListener(async (command) => {
    // 用原生 console,不用 WXT 的 logger。production build 會把 logger 換成空函式,
    // 出事時完全沒有輸出,這是這個擴充唯一的觀測點。
    console.log('[pv] command', command);
    if (command !== 'highlight') return;

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    await toggle(tab, 'command');
  });

  browser.action.onClicked.addListener(async (tab) => {
    await toggle(tab, 'icon');
  });
});

async function toggle(tab: Browser.tabs.Tab | undefined, via: string): Promise<void> {
  console.log('[pv] toggle via', via, '| tab', tab?.id, tab?.url);
  if (!tab?.id || !tab.url) return;

  const { blockedHosts } = await loadSettings();
  const host = new URL(tab.url).hostname;
  if (blockedHosts.some((h) => host === h || host.endsWith(`.${h}`))) {
    console.warn(`${host} 在黑名單內,不注入`);
    return;
  }

  // 這個手勢本身就授予 activeTab,所以這裡不需要 host_permissions
  const injected = await browser.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    files: ['/content-scripts/highlight.js'],
  });
  console.log('[pv] injected frames:', injected.length);
}
