import { describe, it, expect } from 'vitest';
import { pickVoice } from './speak';

function voice(name: string, lang: string, localService = true) {
  return { name, lang, localService, default: false, voiceURI: name } as SpeechSynthesisVoice;
}

describe('pickVoice', () => {
  it('優先選 en-US', () => {
    const voices = [voice('A', 'zh-TW'), voice('B', 'en-GB'), voice('C', 'en-US')];
    expect(pickVoice(voices)?.name).toBe('C');
  });

  it('沒有 en-US 時退而求其次選任何 en', () => {
    const voices = [voice('A', 'zh-TW'), voice('B', 'en-GB')];
    expect(pickVoice(voices)?.name).toBe('B');
  });

  it('完全沒有英文語音時回 null,讓瀏覽器用預設的', () => {
    expect(pickVoice([voice('A', 'zh-TW')])).toBe(null);
  });

  it('清單是空的時回 null', () => {
    // 第一次呼叫時 getVoices() 常常還是空的,這不是錯誤
    expect(pickVoice([])).toBe(null);
  });

  it('同樣是 en-US 時優先選本機語音,不用等網路', () => {
    const voices = [voice('遠端', 'en-US', false), voice('本機', 'en-US', true)];
    expect(pickVoice(voices)?.name).toBe('本機');
  });
});
