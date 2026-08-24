import { handleMessage, handleStreamMessage, type Msg } from '@/src/lib/messages';
import { loadSettings, pageOrigin } from '@/src/lib/settings';

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

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== 'pv-ai-stream') return;
    let connected = true;
    port.onDisconnect.addListener(() => { connected = false; });
    port.onMessage.addListener((msg: Extract<Msg, { type: 'lookup' | 'explain' }>) => {
      void handleStreamMessage(msg, (delta) => {
        if (connected) port.postMessage({ type: 'delta', delta });
      }).then((result) => {
        if (connected) port.postMessage({ type: 'done', result });
      });
    });
  });

  // Alt+U 直接切換；工具列圖示現在開 popup，由 popup 提供切換與設定入口。
  browser.commands.onCommand.addListener(async (command) => {
    // 用原生 console,不用 WXT 的 logger。production build 會把 logger 換成空函式,
    // 出事時完全沒有輸出,這是這個擴充唯一的觀測點。
    console.log('[pv] command', command);
    if (command !== 'highlight') return;

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    await toggle(tab, 'command');
  });

  // 使用者在 popup 為某個 origin 開啟自動標示後，每次載入完成自動注入。
  // 不加 tabs 權限：已授權的 origin 本身就讓 tab.url 對擴充功能可見。
  browser.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab.url) return;
    void autoHighlight(tab);
  });
});

async function autoHighlight(tab: Browser.tabs.Tab): Promise<void> {
  if (!tab.url) return;
  const origin = pageOrigin(tab.url);
  if (!origin) return;
  const settings = await loadSettings();
  if (settings.autoOrigins.includes(`${origin}/*`)) await toggle(tab, 'auto');
}

async function toggle(tab: Browser.tabs.Tab | undefined, via: string): Promise<void> {
  console.log('[pv] toggle via', via, '| tab', tab?.id, tab?.url);
  if (!tab?.id || !tab.url) return;

  const { blockedHosts } = await loadSettings();
  const origin = pageOrigin(tab.url);
  if (!origin) return;
  const host = new URL(origin).hostname;
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
