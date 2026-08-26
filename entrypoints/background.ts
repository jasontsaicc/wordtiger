import { handleMessage, handleStreamMessage, type Msg } from '@/src/lib/messages';
import { loadSettings, pageOrigin } from '@/src/lib/settings';
import { getSyncState, syncNow } from '@/src/lib/sync';

const SYNC_ALARM = 'wordtiger-sync';
const SYNC_SOON_ALARM = 'wordtiger-sync-soon';
const LOCAL_CHANGES = new Set([
  'toggleMark', 'saveContext', 'lookup', 'reviewWord', 'deleteWord', 'setWordStatus',
  'deleteCachedWord',
]);
type BackgroundMsg = Msg | { type: 'toggleHighlightFromMascot' };

export default defineBackground(() => {
  // 用 sendResponse 加 return true,不用「listener 回傳 Promise」那種寫法。
  // 後者在不同瀏覽器和不同 polyfill 設定下的行為不一致,錯了會安靜地收不到回應。
  browser.runtime.onMessage.addListener((msg: BackgroundMsg, sender, sendResponse) => {
    if (msg.type === 'toggleHighlightFromMascot') {
      toggle(sender.tab, 'mascot').then(sendResponse).catch((err) => {
        console.error('[wordtiger] 懸浮球切換失敗', err);
        sendResponse(false);
      });
      return true;
    }

    // catch 不能省。上面已經 return true 答應瀏覽器「等我回話」,
    // handleMessage 一 reject 就再也沒人呼叫 sendResponse,通道會一直開著,
    // 呼叫端的 await 永遠不會 settle:不回應、不拋錯、不逾時,畫面就這樣白掉。
    // 回 undefined 至少讓呼叫端立刻拿到結果,錯誤留在 service worker console。
    handleMessage(msg)
      .then((result) => {
        sendResponse(result);
        if (LOCAL_CHANGES.has(msg.type)) void scheduleSync();
        if (msg.type === 'syncLogin' || msg.type === 'syncLogout' || msg.type === 'syncNow') {
          void updateSyncBadge();
        }
      })
      .catch((err) => {
        console.error('[wordtiger] handleMessage 失敗', msg.type, err);
        sendResponse(undefined);
      });
    return true; // 保持訊息通道開著,直到 sendResponse 被呼叫
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== 'wordtiger-ai-stream') return;
    const controller = new AbortController();
    let connected = true;
    port.onDisconnect.addListener(() => {
      connected = false;
      controller.abort();
    });
    port.onMessage.addListener((msg: Extract<Msg, { type: 'lookup' | 'explain' }>) => {
      void handleStreamMessage(msg, (delta) => {
        if (connected) port.postMessage({ type: 'delta', delta });
      }, controller.signal).then((result) => {
        if (connected) port.postMessage({ type: 'done', result });
        if (msg.type === 'lookup' && result.ok) void scheduleSync();
      });
    });
  });

  // Alt+U 直接切換；工具列圖示現在開 popup，由 popup 提供切換與設定入口。
  browser.commands.onCommand.addListener(async (command) => {
    // 用原生 console,不用 WXT 的 logger。production build 會把 logger 換成空函式,
    // 出事時完全沒有輸出,這是這個擴充唯一的觀測點。
    console.log('[wordtiger] command', command);
    if (command !== 'highlight') return;

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    await toggle(tab, 'command');
  });

  // 使用者在 popup 為某個 origin 開啟自動標示後，每次載入完成自動注入。
  browser.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab.url) return;
    void autoHighlight(tab).catch((err) => console.error('[wordtiger] 自動標示失敗', err));
  });

  // 第一次安裝就把設定頁開起來。沒有 API Key 之前查詞不會動,
  // 不主動帶一下,新使用者第一個按鍵得到的就是錯誤訊息。更新版本不打擾。
  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install') void browser.runtime.openOptionsPage();
  });

  void browser.alarms.create(SYNC_ALARM, { periodInMinutes: 5 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ALARM || alarm.name === SYNC_SOON_ALARM) void runSync();
  });
  void updateSyncBadge();
});

async function scheduleSync(): Promise<void> {
  if ((await getSyncState()).loggedIn) {
    await browser.alarms.create(SYNC_SOON_ALARM, { delayInMinutes: 0.5 });
  }
}

async function runSync(): Promise<void> {
  if (!(await getSyncState()).loggedIn) return;
  try {
    await syncNow();
  } catch (error) {
    console.error('[wordtiger] 自動同步失敗', error);
  }
  await updateSyncBadge();
}

async function updateSyncBadge(): Promise<void> {
  const state = await getSyncState();
  await browser.action.setBadgeText({ text: state.loggedIn && state.lastError ? '!' : '' });
  if (state.loggedIn && state.lastError) {
    await browser.action.setBadgeBackgroundColor({ color: '#dc2626' });
  }
}

async function autoHighlight(tab: Browser.tabs.Tab): Promise<void> {
  if (!tab.url) return;
  const origin = pageOrigin(tab.url);
  if (!origin) return;
  const settings = await loadSettings();
  if (settings.autoOrigins.includes(`${origin}/*`)) await toggle(tab, 'auto');
}

async function toggle(tab: Browser.tabs.Tab | undefined, via: string): Promise<boolean> {
  console.log('[wordtiger] toggle via', via, '| tab', tab?.id, tab?.url);
  if (!tab?.id || !tab.url) return false;

  const { blockedHosts } = await loadSettings();
  const origin = pageOrigin(tab.url);
  if (!origin) return false;
  const host = new URL(origin).hostname;
  if (blockedHosts.some((h) => host === h || host.endsWith(`.${h}`))) {
    console.warn(`${host} 在黑名單內,不注入`);
    return false;
  }

  // 全站 host permission 讓快捷鍵、popup、懸浮球與自動標示共用這條注入路徑。
  const injected = await browser.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    files: ['/content-scripts/highlight.js'],
  });
  console.log('[wordtiger] injected frames:', injected.length);
  const active = await isRunning(tab.id);
  try {
    await browser.tabs.sendMessage(tab.id, { type: 'highlightState', active });
  } catch {
    // 瀏覽器內建頁不能載入 content script，沒有接收端是正常情況。
  }
  return active;
}

async function isRunning(tabId: number): Promise<boolean> {
  const [result] = await browser.scripting.executeScript({
    target: { tabId },
    func: () => Boolean((window as unknown as { __wordTigerAbort?: unknown }).__wordTigerAbort),
  });
  return Boolean(result?.result);
}
