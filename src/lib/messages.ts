import { db, loadMarks, markWord, unmarkWord, deleteWord, addContext, listContexts, getCached, putCached, getSentence, putSentence, type WordRow, type ContextRow } from './db';
import { lookupWord, explainSentence } from './ai';
import { loadSettings } from './settings';
import { getSyncState, signIn, signOut, syncNow } from './sync';
import type { WordStatus } from './decide';

export interface ExportBundle {
  exportedAt: number;
  words: WordRow[];
  contexts: ContextRow[];
}

/** 查詞、翻譯、文法分析共用這個信封。三者都是「一段文字或一個錯誤」 */
export type ExplainResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

const NOT_CONFIGURED = '還沒設定 AI,請到 options 頁填 base URL 和 API key';

export type Msg =
  | { type: 'getMarks' }
  | { type: 'getHighlightSettings' }
  | { type: 'toggleMark'; word: string; status?: WordStatus }
  | { type: 'lookup'; word: string; sentence: string }
  | { type: 'saveContext'; word: string; sentence: string; url: string; title: string }
  | { type: 'listWords' }
  | { type: 'explain'; kind: 'translate' | 'grammar'; sentence: string }
  | { type: 'deleteWord'; word: string }
  | { type: 'setWordStatus'; word: string; status: WordStatus }
  | { type: 'exportData' }
  | { type: 'getCachedWord'; word: string }
  | { type: 'listCachedWords' }
  | { type: 'deleteCachedWord'; word: string }
  | { type: 'getSyncState' }
  | { type: 'syncLogin'; url: string; anonKey: string; email: string; password: string }
  | { type: 'syncLogout' }
  | { type: 'syncNow' };

/**
 * Map 不能通過 chrome.runtime.sendMessage 的結構化複製,所以回傳 entries 陣列。
 * content script 端自己 new Map(...) 還原。
 */
export async function handleMessage(msg: Msg): Promise<unknown> {
  switch (msg.type) {
    case 'getMarks':
      return [...(await loadMarks())];

    case 'getHighlightSettings': {
      const {
        threshold, highlightColors, highlightTextColors,
        highlightUnderlineColors, markConjunctions,
      } = await loadSettings();
      return {
        threshold, highlightColors, highlightTextColors,
        highlightUnderlineColors, markConjunctions,
      };
    }

    case 'toggleMark': {
      const marks = await loadMarks();
      const current = marks.get(msg.word);
      const next = msg.status ?? 'unknown';
      if (current === next) {
        await unmarkWord(msg.word);
        return null;
      }
      await markWord(msg.word, next);
      return next;
    }

    case 'lookup': {
      // 快取鍵仍然是原形。同一個字在不同句子查到的結果會共用第一次的,
      // 這是刻意的取捨:一個字換一句就重查一次太貴,而多數情況語意是一樣的。
      const cached = await getCached([msg.word]);
      const hit = cached.get(msg.word);
      if (hit !== undefined) return { ok: true, text: hit } satisfies ExplainResult;

      const settings = await loadSettings();
      if (!settings.baseUrl || !settings.apiKey) {
        return { ok: false, error: NOT_CONFIGURED } satisfies ExplainResult;
      }

      try {
        const text = await lookupWord({ w: msg.word, s: msg.sentence }, settings);
        if (!text) return { ok: false, error: 'AI 回了空的結果' } satisfies ExplainResult;
        // 失敗不寫快取,不然一次網路抖動會被記住,之後永遠拿到錯誤結果
        await putCached([{ word: msg.word, payload: text, model: settings.model }]);
        return { ok: true, text } satisfies ExplainResult;
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        } satisfies ExplainResult;
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
        return { ok: false, error: NOT_CONFIGURED } satisfies ExplainResult;
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
        [...marks].map(async ([word, status]) => {
          const contexts = await listContexts(word);
          return { word, status, contexts: contexts.reverse() };
        }),
      );
      return rows;
    }

    case 'deleteWord':
      await deleteWord(msg.word);
      return null;

    // markWord 會把 deletedAt 寫回 null,所以這個 case 同時是「救回誤刪的字」
    case 'setWordStatus':
      await markWord(msg.word, msg.status);
      return null;

    case 'exportData': {
      const [words, contexts] = await Promise.all([
        db.words.filter((r) => r.deletedAt === null).toArray(),
        db.contexts.filter((r) => r.deletedAt === null).toArray(),
      ]);
      return { exportedAt: Date.now(), words, contexts } satisfies ExportBundle;
    }

    case 'getCachedWord':
      return db.lookupCache.get(msg.word);

    case 'listCachedWords':
      return db.lookupCache.orderBy('fetchedAt').reverse().toArray();

    case 'deleteCachedWord':
      await db.lookupCache.delete(msg.word);
      return null;

    case 'getSyncState':
      return getSyncState();

    case 'syncLogin':
      try {
        return { ok: true, state: await signIn(msg.url, msg.anonKey, msg.email, msg.password) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }

    case 'syncLogout':
      return { ok: true, state: await signOut() };

    case 'syncNow':
      try {
        return { ok: true, result: await syncNow(), state: await getSyncState() };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
  }
}

/** content script 的長連線版本；快取命中也走同一條 UI 更新路徑。 */
export async function handleStreamMessage(
  msg: Extract<Msg, { type: 'lookup' | 'explain' }>,
  onDelta: (delta: string) => void,
): Promise<ExplainResult> {
  if (msg.type === 'lookup') {
    const hit = (await getCached([msg.word])).get(msg.word);
    if (hit !== undefined) {
      onDelta(hit);
      return { ok: true, text: hit };
    }

    const settings = await loadSettings();
    if (!settings.baseUrl || !settings.apiKey) return { ok: false, error: NOT_CONFIGURED };
    try {
      const text = await lookupWord({ w: msg.word, s: msg.sentence }, settings, onDelta);
      if (!text) return { ok: false, error: 'AI 回了空的結果' };
      await putCached([{ word: msg.word, payload: text, model: settings.model }]);
      return { ok: true, text };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  const cached = await getSentence(msg.kind, msg.sentence);
  if (cached !== null) {
    onDelta(cached);
    return { ok: true, text: cached };
  }
  const settings = await loadSettings();
  if (!settings.baseUrl || !settings.apiKey) return { ok: false, error: NOT_CONFIGURED };
  try {
    const text = await explainSentence(msg.kind, msg.sentence, settings, onDelta);
    if (!text) return { ok: false, error: 'AI 回了空的結果' };
    await putSentence(msg.kind, msg.sentence, text);
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
