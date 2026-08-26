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
  // 明確使用 sendResponse + return true，確保跨瀏覽器行為一致。
  browser.runtime.onMessage.addListener((msg: BackgroundMsg, sender, sendResponse) => {
    if (msg.type === 'toggleHighlightFromMascot') {
      toggle(sender.tab).then(sendResponse).catch((err) => {
        console.error('[wordtiger] 懸浮球切換失敗', err);
        sendResponse(false);
      });
      return true;
    }

    // return true 後必須回應；錯誤時回 undefined，避免呼叫端永久等待。
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
    return true;
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

  browser.commands.onCommand.addListener(async (command) => {
    if (command !== 'highlight') return;

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    await toggle(tab);
  });

  browser.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab.url) return;
    void autoHighlight(tab).catch((err) => console.error('[wordtiger] 自動標示失敗', err));
  });

  // 僅首次安裝開啟設定頁，更新版本不打擾使用者。
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
  if (settings.autoOrigins.includes(`${origin}/*`)) await toggle(tab);
}

async function toggle(tab: Browser.tabs.Tab | undefined): Promise<boolean> {
  if (!tab?.id || !tab.url) return false;

  const { blockedHosts } = await loadSettings();
  const origin = pageOrigin(tab.url);
  if (!origin) return false;
  const host = new URL(origin).hostname;
  if (blockedHosts.some((h) => host === h || host.endsWith(`.${h}`))) {
    console.warn(`${host} 在黑名單內，不注入`);
    return false;
  }

  // 全站 host permission 讓快捷鍵、popup、懸浮球與自動標示共用這條注入路徑。
  await browser.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    files: ['/content-scripts/highlight.js'],
  });
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
