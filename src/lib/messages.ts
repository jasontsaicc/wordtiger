import { loadMarks, markWord, unmarkWord, addContext, listContexts, getCached, putCached, getSentence, putSentence } from './db';
import { lookupBatch, explainSentence, type LookupItem } from './ai';
import { loadSettings } from './settings';
import type { WordStatus } from './decide';

export type ExplainResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

export type Msg =
  | { type: 'getMarks' }
  | { type: 'getThreshold' }
  | { type: 'toggleMark'; word: string }
  | { type: 'lookup'; items: LookupItem[] }
  | { type: 'saveContext'; word: string; sentence: string; url: string; title: string }
  | { type: 'listWords' }
  | { type: 'getContexts'; word: string }
  | { type: 'explain'; kind: 'translate' | 'grammar'; sentence: string };

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

    case 'explain': {
      const cached = await getSentence(msg.kind, msg.sentence);
      if (cached !== null) return { ok: true, text: cached } satisfies ExplainResult;

      const settings = await loadSettings();
      if (!settings.baseUrl || !settings.apiKey) {
        return {
          ok: false,
          error: '還沒設定 AI,請到 options 頁填 base URL 和 API key',
        } satisfies ExplainResult;
      }

      try {
        const text = await explainSentence(msg.kind, msg.sentence, settings);
        // 失敗不寫快取,不然一次網路抖動會被記住,之後永遠拿到錯誤結果
        await putSentence(msg.kind, msg.sentence, text);
        return { ok: true, text } satisfies ExplainResult;
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        } satisfies ExplainResult;
      }
    }

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
