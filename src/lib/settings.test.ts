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
import { DEFAULT_HIGHLIGHT_COLORS, OPENAI_BASE_URL, loadSettings, saveSettings } from './settings';
import { DEFAULT_TEMPLATES } from './prompt';
import { beforeEach } from 'vitest';

describe('loadSettings 的 template 合併', () => {
  beforeEach(() => fakeBrowser.reset());

  it('沒存過設定時,三個 template 都是預設值', async () => {
    const s = await loadSettings();
    expect(s.templates).toEqual(DEFAULT_TEMPLATES);
    expect(s.baseUrl).toBe(OPENAI_BASE_URL);
    expect(s.model).toBe('gpt-4o-mini');
    expect(s.highlightColors).toEqual(DEFAULT_HIGHLIGHT_COLORS);
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

  it('辨認舊版過長的預設查詞 prompt 並自動換成精簡版', async () => {
    await fakeBrowser.storage.local.set({ settings: {
      templates: { ...DEFAULT_TEMPLATES, lookup: '舊內容\n13. 不要輸出總結' },
    } });
    expect((await loadSettings()).templates.lookup).toBe(DEFAULT_TEMPLATES.lookup);
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
