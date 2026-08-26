import { afterEach, describe, it, expect, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { pickVoice, speak } from './speak';

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

  it('完全沒有英文語音時回傳 null，交由瀏覽器選擇預設語音', () => {
    expect(pickVoice([voice('A', 'zh-TW')])).toBe(null);
  });

  it('清單是空的時回 null', () => {
    expect(pickVoice([])).toBe(null);
  });

  it('同為 en-US 時優先選擇本機語音', () => {
    const voices = [voice('遠端', 'en-US', false), voice('本機', 'en-US', true)];
    expect(pickVoice(voices)?.name).toBe('本機');
  });

  it('避開 macOS 的 novelty 語音', () => {
    const voices = [
      voice('Albert', 'en-US'),
      voice('Zarvox', 'en-US'),
      voice('Samantha', 'en-US'),
    ];
    expect(pickVoice(voices)?.name).toBe('Samantha');
  });

  it('系統預設的英文語音贏過我們的偏好清單', () => {
    const preferred = voice('Samantha', 'en-US');
    const systemDefault = { ...voice('Karen', 'en-AU'), default: true } as SpeechSynthesisVoice;
    expect(pickVoice([preferred, systemDefault])?.name).toBe('Karen');
  });

  it('系統預設不是英文時不影響選擇', () => {
    const zhDefault = { ...voice('美嘉', 'zh-TW'), default: true } as SpeechSynthesisVoice;
    const voices = [zhDefault, voice('Albert', 'en-US'), voice('Alex', 'en-US')];
    expect(pickVoice(voices)?.name).toBe('Alex');
  });
});

describe('speak', () => {
  afterEach(() => {
    fakeBrowser.reset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('在非同步 API request 前啟動 AudioContext', async () => {
    const resume = vi.fn().mockResolvedValue(undefined);
    const sendMessage = vi.spyOn(fakeBrowser.runtime, 'sendMessage');
    fakeBrowser.runtime.onMessage.addListener((_message, _sender, sendResponse) => {
      sendResponse({ ok: true, audio: 'data:audio/mpeg;base64,AQID' });
      return true;
    });
    const fetchAudio = vi.fn().mockResolvedValue({
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
    });
    const source = {
      buffer: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null,
    };
    const context = {
      state: 'suspended',
      destination: {},
      resume,
      decodeAudioData: vi.fn().mockResolvedValue({}),
      createBufferSource: vi.fn(() => source),
    };
    vi.stubGlobal('AudioContext', vi.fn(function () { return context; }));
    vi.stubGlobal('fetch', fetchAudio);

    speak('We deploy.');
    expect(resume).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(fetchAudio).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(context.decodeAudioData).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(source.start).toHaveBeenCalledOnce());
  });

  it('AI 語音失敗時改用裝置語音', async () => {
    const localSpeak = vi.fn();
    fakeBrowser.runtime.onMessage.addListener((_message, _sender, sendResponse) => {
      sendResponse({ ok: false, error: 'unsupported' });
      return true;
    });
    vi.stubGlobal('speechSynthesis', {
      speaking: false,
      pending: false,
      cancel: vi.fn(),
      getVoices: () => [],
      speak: localSpeak,
    });
    vi.stubGlobal('SpeechSynthesisUtterance', class {
      rate = 1;
      lang = '';
      voice = null;
      onend: (() => void) | null = null;
      constructor(readonly text: string) {}
    });

    speak('deploy');
    await vi.waitFor(() => expect(localSpeak).toHaveBeenCalledOnce());
  });
});
