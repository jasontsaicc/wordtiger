/** 已知音質穩定的本機英文語音；避免 macOS novelty voices。 */
const PREFERRED = [
  'Samantha', 'Alex', 'Ava', 'Allison', 'Susan', // macOS 美式
  'Daniel', 'Karen', 'Moira', 'Tessa', 'Rishi', // macOS 其他英語區
  'Google US English', 'Google UK English', // Chrome 自帶
  'Microsoft Aria', 'Microsoft Guy', 'Microsoft Zira', 'Microsoft David', // Windows
];

export function pickVoice(
  voices: SpeechSynthesisVoice[],
): SpeechSynthesisVoice | null {
  const english = voices.filter((v) => v.lang.startsWith('en'));
  if (english.length === 0) return null;

  // 尊重使用者的系統預設，再套用應用程式偏好。
  const score = (v: SpeechSynthesisVoice) =>
    (v.default ? 8 : 0)
    + (PREFERRED.some((name) => v.name.startsWith(name)) ? 4 : 0)
    + (v.lang.startsWith('en-US') ? 2 : 0)
    + (v.localService ? 1 : 0);

  return english.reduce((best, v) => (score(v) > score(best) ? v : best));
}

// 保留播放物件；requestSeq 用於丟棄過期回應。
let current: SpeechSynthesisUtterance | null = null;
let audioContext: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;
let requestSeq = 0;

export function speak(text: string): void {
  const input = text.trim();
  if (!input) return;

  // 在使用者事件內啟動 AudioContext，避免 API 回應後失去播放權限。
  const prepared = prepareAudio();
  const seq = ++requestSeq;
  stopCurrent();
  void browser.runtime.sendMessage({ type: 'speak', text: input })
    .then(async (result: import('@/src/lib/messages').SpeechResult | undefined) => {
      if (seq !== requestSeq) return;
      if (!result?.ok || !prepared) {
        speakLocal(input);
        return;
      }

      try {
        await prepared.ready;
        const encoded = await fetch(result.audio);
        const buffer = await prepared.context.decodeAudioData(await encoded.arrayBuffer());
        if (seq !== requestSeq) return;

        const source = prepared.context.createBufferSource();
        source.buffer = buffer;
        source.connect(prepared.context.destination);
        currentSource = source;
        source.onended = () => {
          if (currentSource === source) currentSource = null;
          source.disconnect();
        };
        source.start();
      } catch {
        if (seq === requestSeq) speakLocal(input);
      }
    })
    .catch(() => {
      if (seq === requestSeq) speakLocal(input);
    });
}

function prepareAudio(): { context: AudioContext; ready: Promise<void> } | null {
  if (typeof AudioContext === 'undefined') return null;
  if (!audioContext || audioContext.state === 'closed') audioContext = new AudioContext();
  return {
    context: audioContext,
    ready: audioContext.state === 'suspended' ? audioContext.resume() : Promise.resolve(),
  };
}

function stopCurrent(): void {
  if (currentSource) {
    const source = currentSource;
    currentSource = null;
    source.onended = null;
    try {
      source.stop();
    } catch {
      // 已結束的 source 不需再次停止。
    }
    source.disconnect();
  }
  if (typeof speechSynthesis !== 'undefined'
    && (speechSynthesis.speaking || speechSynthesis.pending)) {
    speechSynthesis.cancel();
  }
  current = null;
}

/** AI 語音不可用時改用裝置語音。 */
function speakLocal(text: string): void {
  if (typeof speechSynthesis === 'undefined') return;

  const utterance = new SpeechSynthesisUtterance(text);
  current = utterance;
  utterance.rate = 0.9;
  utterance.lang = 'en-US';
  utterance.onend = () => {
    if (current === utterance) current = null;
  };

  const chosen = pickVoice(speechSynthesis.getVoices());
  if (chosen) {
    utterance.voice = chosen;
    // 部分引擎會以 lang 覆蓋不相符的 voice。
    utterance.lang = chosen.lang;
  }

  speechSynthesis.speak(utterance);
}
