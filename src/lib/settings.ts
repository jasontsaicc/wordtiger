export interface Settings {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 使用者的背景描述,會被塞進每個 prompt 的使用者層 */
  profile: string;
  /** 詞頻排名落後於這個數字的字視為生詞 */
  threshold: number;
  /** 永不啟用的網域,公司內網放這裡 */
  blockedHosts: string[];
}

const DEFAULTS: Settings = {
  baseUrl: '',
  apiKey: '',
  model: '',
  profile: '',
  threshold: 5000,
  blockedHosts: ['localhost', '127.0.0.1'],
};

const KEY = 'settings';

/**
 * 每次都從 storage 讀,不快取在模組變數。
 * service worker 閒置約 30 秒就被回收,模組變數在下次喚醒時是初始值。
 */
export async function loadSettings(): Promise<Settings> {
  const got = await browser.storage.local.get(KEY);
  return { ...DEFAULTS, ...(got[KEY] ?? {}) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const current = await loadSettings();
  await browser.storage.local.set({ [KEY]: { ...current, ...patch } });
}
