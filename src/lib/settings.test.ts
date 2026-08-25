import { describe, it, expect } from 'vitest';
import { originPattern, pageOrigin } from './settings';

describe('originPattern', () => {
  it('把 base URL 縮成 origin 加萬用路徑', () => {
    expect(originPattern('https://api.openai.com/v1')).toBe('https://api.openai.com/*');
  });

  it('保留非預設的 port,本機 Ollama 會用到', () => {
    expect(originPattern('http://localhost:11434/v1')).toBe('http://localhost:11434/*');
  });

  it('結尾斜線不影響結果', () => {
    expect(originPattern('https://api.example.com/v1/')).toBe('https://api.example.com/*');
  });

  it('空字串回傳 null', () => {
    expect(originPattern('')).toBe(null);
  });

  it('不是合法網址時回傳 null,不丟例外', () => {
    expect(originPattern('api.openai.com')).toBe(null);
  });
});

describe('pageOrigin', () => {
  it('只接受能注入的 http(s) 網頁', () => {
    expect(pageOrigin('https://example.com/a')).toBe('https://example.com');
    expect(pageOrigin('edge://extensions')).toBe(null);
    expect(pageOrigin('not a url')).toBe(null);
  });
});

import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  DEFAULT_HIGHLIGHT_COLORS, DEFAULT_HIGHLIGHT_TEXT_COLORS,
  DEFAULT_HIGHLIGHT_UNDERLINE_COLORS, OPENAI_BASE_URL, loadSettings, saveSettings,
} from './settings';
import { DEFAULT_TEMPLATES, PREVIOUS_DEFAULT_TEMPLATES } from './prompt';
import { beforeEach } from 'vitest';

describe('loadSettings 的 template 合併', () => {
  beforeEach(() => fakeBrowser.reset());

  it('沒存過設定時,三個 template 都是預設值', async () => {
    const s = await loadSettings();
    expect(s.templates).toEqual(DEFAULT_TEMPLATES);
    expect(s.baseUrl).toBe(OPENAI_BASE_URL);
    expect(s.model).toBe('gpt-5.6-luna');
    expect(s.highlightColors).toEqual(DEFAULT_HIGHLIGHT_COLORS);
    expect(s.highlightTextColors).toEqual(DEFAULT_HIGHLIGHT_TEXT_COLORS);
    expect(s.highlightUnderlineColors).toEqual(DEFAULT_HIGHLIGHT_UNDERLINE_COLORS);
    expect(s.markConjunctions).toBe(true);
    expect(s.autoOrigins).toEqual([]);
  });

  it('只改過一個 template 時,其他兩個仍回預設值', async () => {
    await saveSettings({
      templates: { ...DEFAULT_TEMPLATES, translate: '自訂翻譯 {{sentence}}' },
    });
    const s = await loadSettings();
    expect(s.templates.translate).toBe('自訂翻譯 {{sentence}}');
    expect(s.templates.lookup).toBe(DEFAULT_TEMPLATES.lookup);
  });

  it('舊版存檔完全沒有 templates 欄位時也要回預設值', async () => {
    await fakeBrowser.storage.local.set({ settings: { baseUrl: 'https://x/v1' } });
    const s = await loadSettings();
    expect(s.baseUrl).toBe('https://x/v1');
    expect(s.templates).toEqual(DEFAULT_TEMPLATES);
  });

  it('自訂的相容端點與模型名稱要原封不動存讀', async () => {
    // 服務欄位開放輸入之後,任何 OpenAI 相容端點都可能出現在這裡,
    // 模型名稱也不再限於 OPENAI_MODELS 那份清單。
    await fakeBrowser.storage.local.set({ settings: {
      baseUrl: 'https://api.example-llm.com/v1', model: 'tiny-fast-v2',
    } });
    const s = await loadSettings();
    expect(s.baseUrl).toBe('https://api.example-llm.com/v1');
    expect(s.model).toBe('tiny-fast-v2');
  });

  it('辨認舊版過長的預設查詞 prompt 並自動換成精簡版', async () => {
    await fakeBrowser.storage.local.set({ settings: {
      templates: { ...DEFAULT_TEMPLATES, lookup: '舊內容\n13. 不要輸出總結' },
    } });
    expect((await loadSettings()).templates.lookup).toBe(DEFAULT_TEMPLATES.lookup);
  });

  it('三個未自訂的舊預設都自動升級', async () => {
    await fakeBrowser.storage.local.set({ settings: {
      templates: PREVIOUS_DEFAULT_TEMPLATES,
    } });
    expect((await loadSettings()).templates).toEqual(DEFAULT_TEMPLATES);
  });

  it('上一版技術文件 prompt 也會升級為閱讀教練', async () => {
    await fakeBrowser.storage.local.set({ settings: { templates: {
      ...DEFAULT_TEMPLATES,
      translate: '舊預設\n目標:翻成自然、專業且一眼能懂的繁體中文。',
      grammar: '舊預設\n目標:讓讀者看懂句子如何組成。',
    } } });
    const templates = (await loadSettings()).templates;
    expect(templates.translate).toBe(DEFAULT_TEMPLATES.translate);
    expect(templates.grammar).toBe(DEFAULT_TEMPLATES.grammar);
  });
});

describe('高亮顏色設定', () => {
  beforeEach(() => fakeBrowser.reset());

  it('舊版預設背景自動換成新配色，但保留自訂背景', async () => {
    await fakeBrowser.storage.local.set({ settings: { highlightColors: {
      saved: '#8fb8ff', learning: '#c8c0ff', advanced: '#ffd38a', rare: '#ff9b9b',
    } } });
    expect((await loadSettings()).highlightColors).toEqual(DEFAULT_HIGHLIGHT_COLORS);

    await fakeBrowser.storage.local.set({ settings: { highlightColors: {
      saved: '#12345678', learning: '#c8c0ff', advanced: '#ffd38a', rare: '#ff9b9b',
    } } });
    expect((await loadSettings()).highlightColors.saved).toBe('#12345678');
  });

  it('拒絕會被插入網頁 style 的非法顏色', async () => {
    await fakeBrowser.storage.local.set({ settings: {
      highlightColors: { saved: 'red; } body { display:none', learning: '#112233' },
    } });
    const colors = (await loadSettings()).highlightColors;
    expect(colors.saved).toBe(DEFAULT_HIGHLIGHT_COLORS.saved);
    expect(colors.learning).toBe('#112233');
  });
});

describe('blockedHosts 一定是陣列', () => {
  beforeEach(() => fakeBrowser.reset());

  it('存進 Proxy 包住的陣列,讀回來還是真陣列', async () => {
    const proxied = new Proxy(['corp.example.com'], {});
    await saveSettings({ blockedHosts: proxied });
    const s = await loadSettings();
    expect(Array.isArray(s.blockedHosts)).toBe(true);
    expect(s.blockedHosts).toEqual(['corp.example.com']);
  });

  it('storage 裡已經壞成物件時,讀回來會被修成預設陣列', async () => {
    // 這就是 Edge 上實際存到的形狀:陣列被序列化成帶數字 key 的物件
    await fakeBrowser.storage.local.set({
      settings: { blockedHosts: { 0: 'localhost', 1: '127.0.0.1' } },
    });
    const s = await loadSettings();
    expect(Array.isArray(s.blockedHosts)).toBe(true);
    // .some() 和 .join() 是實際炸掉的兩個呼叫
    expect(s.blockedHosts.some((h) => h === 'localhost')).toBe(true);
    expect(() => s.blockedHosts.join('\n')).not.toThrow();
  });
});
