/**
 * 挑一個英文語音。
 *
 * getVoices() 在第一次呼叫時常常回空陣列,語音清單是非同步載入的。
 * 這裡不處理那件事,回 null 就讓瀏覽器自己挑預設語音,聽起來還是英文。
 */
/**
 * 已知音質正常的英文語音。
 *
 * macOS 的 en-US 清單裡混了一大堆 novelty 語音:Albert、Zarvox、Bubbles、
 * Deranged、Trinoids 之類。它們同樣是 en-US、同樣是本機語音,舊的計分方式
 * 跟 Samantha 完全平手,而平手時取先出現的那個,所以常常抽到搞笑聲音。
 * 這就是「有聲音但很卡很怪」的來源。
 */
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

  // 系統預設排最前面:那是使用者自己在系統設定裡挑的,比我們的猜測更可信。
  const score = (v: SpeechSynthesisVoice) =>
    (v.default ? 8 : 0)
    + (PREFERRED.some((name) => v.name.startsWith(name)) ? 4 : 0)
    + (v.lang.startsWith('en-US') ? 2 : 0)
    + (v.localService ? 1 : 0);

  return english.reduce((best, v) => (score(v) > score(best) ? v : best));
}

/**
 * 朗讀一段文字。
 *
 * 先 cancel 再 speak。連按兩次 F 的時候,第二次應該蓋掉第一次,
 * 而不是排隊等它念完。語速調到 0.9,單字要聽清楚音節。
 */
/**
 * 留一個模組層級的參考。utterance 只被區域變數持有的話,speak() 一 return
 * 就可能在還沒念完時被 GC 回收,Chromium 上的表現就是念到一半斷掉或斷斷續續。
 * 這是 Chromium 長年的已知行為,標準解法就是自己抓著它不放。
 */
let current: SpeechSynthesisUtterance | null = null;

export function speak(text: string): void {
  if (!text.trim()) return;
  if (typeof speechSynthesis === 'undefined') return;

  // 只在真的有東西在念的時候才 cancel。沒在念卻呼叫 cancel,
  // Chromium 有機率把語音引擎留在停止狀態,之後就再也不出聲。
  if (speechSynthesis.speaking || speechSynthesis.pending) {
    speechSynthesis.cancel();
  }

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
    // voice 和 lang 不一致時,有些引擎會拿 lang 去覆蓋 voice,結果念出怪腔。
    utterance.lang = chosen.lang;
  }

  speechSynthesis.speak(utterance);
}
