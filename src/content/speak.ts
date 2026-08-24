/**
 * 挑一個英文語音。
 *
 * getVoices() 在第一次呼叫時常常回空陣列,語音清單是非同步載入的。
 * 這裡不處理那件事,回 null 就讓瀏覽器自己挑預設語音,聽起來還是英文。
 */
export function pickVoice(
  voices: SpeechSynthesisVoice[],
): SpeechSynthesisVoice | null {
  const english = voices.filter((v) => v.lang.startsWith('en'));
  if (english.length === 0) return null;

  const score = (v: SpeechSynthesisVoice) =>
    (v.lang.startsWith('en-US') ? 2 : 0) + (v.localService ? 1 : 0);

  return english.reduce((best, v) => (score(v) > score(best) ? v : best));
}

/**
 * 朗讀一段文字。
 *
 * 先 cancel 再 speak。連按兩次 F 的時候,第二次應該蓋掉第一次,
 * 而不是排隊等它念完。語速調到 0.9,單字要聽清楚音節。
 */
export function speak(text: string): void {
  if (!text.trim()) return;
  if (typeof speechSynthesis === 'undefined') return;

  speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.9;
  utterance.lang = 'en-US';

  const chosen = pickVoice(speechSynthesis.getVoices());
  if (chosen) utterance.voice = chosen;

  speechSynthesis.speak(utterance);
}
