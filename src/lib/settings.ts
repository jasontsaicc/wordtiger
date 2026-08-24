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
    // storage 是信任邊界,存進去的東西不保證還是原來的型別。舊版的 saveSettings
    // 會把 Vue 的 reactive Proxy 寫進去,序列化後陣列變成 {"0":...,"1":...},
    // 讀回來呼叫 .some() 和 .join() 就炸。這一行同時修好已經壞掉的設定檔。
    blockedHosts: Array.isArray(stored.blockedHosts)
      ? stored.blockedHosts
      : DEFAULTS.blockedHosts,
    // templates 是巢狀物件,展開一層蓋不到裡面。舊版存下來的設定不會有
    // 後來才加的 template,少這一行就會拿到 undefined。
    templates: { ...DEFAULT_TEMPLATES, ...(stored.templates ?? {}) },
  };
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const current = await loadSettings();
  // JSON 來回一趟是為了脫掉 Vue 的 reactive Proxy。options 頁直接把整個 ref
  // 丟進來,Proxy 包住的陣列在序列化時會被當成普通物件,存進去就不是陣列了。
  // Settings 全都是純資料,沒有 Date 或 Map,這樣轉不會掉東西。
  const plain = JSON.parse(JSON.stringify({ ...current, ...patch }));
  await browser.storage.local.set({ [KEY]: plain });
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
