import { DEFAULT_TEMPLATES, type Templates } from './prompt';

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
  /** 三個 AI 功能的 prompt template,使用者可在 options 頁改寫 */
  templates: Templates;
}

const DEFAULTS: Settings = {
  baseUrl: '',
  apiKey: '',
  model: '',
  profile: '',
  threshold: 5000,
  blockedHosts: ['localhost', '127.0.0.1'],
  templates: DEFAULT_TEMPLATES,
};

const KEY = 'settings';

/**
 * 每次都從 storage 讀,不快取在模組變數。
 * service worker 閒置約 30 秒就被回收,模組變數在下次喚醒時是初始值。
 */
export async function loadSettings(): Promise<Settings> {
  const got = await browser.storage.local.get(KEY);
  const stored = (got[KEY] ?? {}) as Partial<Settings>;
  return {
    ...DEFAULTS,
    ...stored,
    // templates 是巢狀物件,展開一層蓋不到裡面。舊版存下來的設定不會有
    // 後來才加的 template,少這一行就會拿到 undefined。
    templates: { ...DEFAULT_TEMPLATES, ...(stored.templates ?? {}) },
  };
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const current = await loadSettings();
  await browser.storage.local.set({ [KEY]: { ...current, ...patch } });
}

/**
 * 把使用者填的 base URL 轉成 chrome.permissions 要的 origin pattern。
 * MV3 的 service worker 對外 fetch 一樣受 CORS 管,除非持有該網域的 host permission。
 * 網域是使用者自己填的,不可能寫進 manifest,只能執行時動態要。
 */
export function originPattern(baseUrl: string): string | null {
  try {
    return `${new URL(baseUrl).origin}/*`;
  } catch {
    return null;
  }
}
