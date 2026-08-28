import {
  DEFAULT_TEMPLATES, PREVIOUS_DEFAULT_GRAMMARS, PREVIOUS_DEFAULT_LOOKUPS,
  PREVIOUS_DEFAULT_TRANSLATES, type Templates,
} from './prompt';

export interface Settings {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Prompt 使用者背景。 */
  profile: string;
  /** 詞頻排名落後於此門檻的字視為生詞。 */
  threshold: number;
  /** 手動收藏色與三層詞頻色。 */
  highlightColors: HighlightColors;
  highlightTextColors: HighlightColors;
  highlightUnderlineColors: HighlightColors;
  /** 以不同底線標示對等連接詞與從屬連接詞。 */
  markConjunctions: boolean;
  /** 重新載入時自動啟用標示的網站 origin pattern。 */
  autoOrigins: string[];
  /** 永不啟用的網域。 */
  blockedHosts: string[];
  /** 可在 options 編輯的文字 AI prompt templates。 */
  templates: Templates;
}

export interface HighlightColors {
  saved: string;
  learning: string;
  advanced: string;
  rare: string;
}

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const OPENAI_MODELS = [
  { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna（預設，拆句品質最好）' },
  { value: 'gpt-4o-mini', label: 'GPT-4o mini（同級速度，拆句較粗）' },
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 mini（查詞品質較好）' },
  { value: 'gpt-4.1-nano', label: 'GPT-4.1 nano（最省，帶走片語常失敗）' },
] as const;

export const DEFAULT_HIGHLIGHT_COLORS: HighlightColors = {
  saved: '#FFCDD2B0',
  learning: '#FFE0B2B0',
  advanced: '#DAFBFFB0',
  rare: '#CFD8DCB0',
};

export const DEFAULT_HIGHLIGHT_TEXT_COLORS: HighlightColors = {
  saved: '#000000FF',
  learning: '#000000FF',
  advanced: '#000000FF',
  rare: '#000000FF',
};

export const DEFAULT_HIGHLIGHT_UNDERLINE_COLORS: HighlightColors = {
  saved: '#FF6474FF',
  learning: '#FDB852FF',
  advanced: '#3EA2AEFF',
  rare: '#065C84FF',
};

const LEGACY_DEFAULT_HIGHLIGHT_COLORS: HighlightColors = {
  saved: '#8fb8ff', learning: '#c8c0ff', advanced: '#ffd38a', rare: '#ff9b9b',
};

const DEFAULTS: Settings = {
  baseUrl: OPENAI_BASE_URL,
  apiKey: '',
  model: OPENAI_MODELS[0].value,
  profile: '',
  threshold: 5000,
  highlightColors: DEFAULT_HIGHLIGHT_COLORS,
  highlightTextColors: DEFAULT_HIGHLIGHT_TEXT_COLORS,
  highlightUnderlineColors: DEFAULT_HIGHLIGHT_UNDERLINE_COLORS,
  markConjunctions: true,
  autoOrigins: [],
  blockedHosts: ['localhost', '127.0.0.1'],
  templates: DEFAULT_TEMPLATES,
};

const KEY = 'settings';

/** 不快取設定；MV3 service worker 重啟會清除模組狀態。 */
export async function loadSettings(): Promise<Settings> {
  const got = await browser.storage.local.get(KEY);
  const stored = (got[KEY] ?? {}) as Partial<Settings>;
  const storedBackgrounds = sameColors(stored.highlightColors, LEGACY_DEFAULT_HIGHLIGHT_COLORS)
    ? undefined
    : stored.highlightColors;
  return {
    ...DEFAULTS,
    ...stored,
    baseUrl: stored.baseUrl || DEFAULTS.baseUrl,
    model: stored.model || DEFAULTS.model,
    // Storage 是信任邊界；只接受陣列，並修復舊版錯誤序列化的資料。
    blockedHosts: Array.isArray(stored.blockedHosts)
      ? stored.blockedHosts
      : DEFAULTS.blockedHosts,
    autoOrigins: Array.isArray(stored.autoOrigins) ? stored.autoOrigins : [],
    highlightColors: safeColors(storedBackgrounds, DEFAULT_HIGHLIGHT_COLORS),
    highlightTextColors: safeColors(stored.highlightTextColors, DEFAULT_HIGHLIGHT_TEXT_COLORS),
    highlightUnderlineColors: safeColors(
      stored.highlightUnderlineColors,
      DEFAULT_HIGHLIGHT_UNDERLINE_COLORS,
    ),
    markConjunctions: typeof stored.markConjunctions === 'boolean'
      ? stored.markConjunctions
      : DEFAULTS.markConjunctions,
    // 深層合併，確保舊設定取得新增的 templates。
    templates: {
      ...DEFAULT_TEMPLATES,
      ...(stored.templates ?? {}),
      // 只遷移完全相同的舊預設，不動使用者自行編寫的 prompt。
      ...(PREVIOUS_DEFAULT_LOOKUPS.includes(stored.templates?.lookup ?? '')
        ? { lookup: DEFAULT_TEMPLATES.lookup } : {}),
      ...(PREVIOUS_DEFAULT_TRANSLATES.includes(stored.templates?.translate ?? '')
        ? { translate: DEFAULT_TEMPLATES.translate } : {}),
      ...(PREVIOUS_DEFAULT_GRAMMARS.includes(stored.templates?.grammar ?? '')
        ? { grammar: DEFAULT_TEMPLATES.grammar } : {}),
    },
  };
}

function safeColors(stored: Partial<HighlightColors> | undefined, fallback: HighlightColors): HighlightColors {
  const color = (value: unknown, defaultValue: string) =>
    typeof value === 'string' && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value)
      ? value
      : defaultValue;
  return {
    saved: color(stored?.saved, fallback.saved),
    learning: color(stored?.learning, fallback.learning),
    advanced: color(stored?.advanced, fallback.advanced),
    rare: color(stored?.rare, fallback.rare),
  };
}

function sameColors(left: Partial<HighlightColors> | undefined, right: HighlightColors): boolean {
  return !!left && (Object.keys(right) as Array<keyof HighlightColors>)
    .every((tier) => typeof left[tier] === 'string'
      && left[tier].toLowerCase() === right[tier].toLowerCase());
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const current = await loadSettings();
  // 移除 Vue reactive Proxy；Settings 僅包含 JSON-safe data。
  const plain = JSON.parse(JSON.stringify({ ...current, ...patch }));
  await browser.storage.local.set({ [KEY]: plain });
}

/** 驗證 HTTP(S) base URL 並回傳 origin pattern。 */
export function originPattern(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? `${url.origin}/*` : null;
  } catch {
    return null;
  }
}

/** 可注入網頁的 http(s) origin；排除 chrome://、edge:// 等受限頁面。 */
export function pageOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.origin
      : null;
  } catch {
    return null;
  }
}
