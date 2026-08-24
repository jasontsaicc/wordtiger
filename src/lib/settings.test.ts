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
