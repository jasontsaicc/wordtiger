import { loadMarks, markWord, unmarkWord, addContext, listContexts, getCached, putCached } from './db';
import { lookupBatch, type LookupItem } from './ai';
import { loadSettings } from './settings';
import type { WordStatus } from './decide';

export type Msg =
  | { type: 'getMarks' }
  | { type: 'getThreshold' }
  | { type: 'toggleMark'; word: string }
  | { type: 'lookup'; items: LookupItem[] }
  | { type: 'saveContext'; word: string; sentence: string; url: string; title: string }
  | { type: 'listWords' }
  | { type: 'getContexts'; word: string };

/**
 * Map 不能通過 chrome.runtime.sendMessage 的結構化複製,所以回傳 entries 陣列。
 * content script 端自己 new Map(...) 還原。
 */
export async function handleMessage(msg: Msg): Promise<unknown> {
  switch (msg.type) {
    case 'getMarks':
      return [...(await loadMarks())];

    case 'getThreshold':
      return (await loadSettings()).threshold;

    case 'toggleMark': {
      const marks = await loadMarks();
      const current = marks.get(msg.word);
      if (current === 'unknown') {
        await unmarkWord(msg.word);
        return null;
      }
      const next: WordStatus = 'unknown';
      await markWord(msg.word, next);
      return next;
    }

    case 'lookup': {
      const cached = await getCached(msg.items.map((i) => i.w));
      const missing = msg.items.filter((i) => !cached.has(i.w));
      if (missing.length === 0) return [...cached];

      const settings = await loadSettings();
      if (!settings.baseUrl || !settings.apiKey) return [...cached];

      try {
        const fresh = await lookupBatch(missing, settings);
        if (fresh.size > 0) {
          await putCached([...fresh].map(([word, payload]) => ({ word, payload })));
        }
        return [...new Map([...cached, ...fresh])];
      } catch (err) {
        // AI 掛掉不該讓已經查到的字也消失
        console.error('批次查詞失敗', err);
        return [...cached];
      }
    }

    case 'saveContext':
      await addContext(msg);
      return null;

    case 'listWords': {
      const marks = await loadMarks();
      const rows = await Promise.all(
        [...marks].map(async ([word, status]) => ({
          word,
          status,
          contextCount: (await listContexts(word)).length,
        })),
      );
      return rows.sort((a, b) => a.word.localeCompare(b.word));
    }

    case 'getContexts':
      return listContexts(msg.word);
  }
}
