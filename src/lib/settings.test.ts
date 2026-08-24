import { describe, it, expect } from 'vitest';
import { originPattern } from './settings';

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

import { fakeBrowser } from 'wxt/testing/fake-browser';
import { loadSettings, saveSettings } from './settings';
import { DEFAULT_TEMPLATES } from './prompt';
import { beforeEach } from 'vitest';

describe('loadSettings 的 template 合併', () => {
  beforeEach(() => fakeBrowser.reset());

  it('沒存過設定時,三個 template 都是預設值', async () => {
    const s = await loadSettings();
    expect(s.templates).toEqual(DEFAULT_TEMPLATES);
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
});
