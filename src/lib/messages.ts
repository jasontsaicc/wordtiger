import { db, loadMarks, markWord, unmarkWord, deleteWord, addContext, listContexts, listReviewItems, listReviewLog, masterWord, recordReview, putCached, deleteCached, getSentence, putSentence, type WordRow, type ContextRow, type ReviewLogRow } from './db';
import { lookupWord, explainSentence, generateSpeech } from './ai';
import { loadSettings } from './settings';
import { getSyncState, signIn, signOut, syncNow } from './sync';
import { SYSTEM_RULES } from './prompt';
import type { WordStatus } from './decide';

export interface ExportBundle {
  exportedAt: number;
  words: WordRow[];
  contexts: ContextRow[];
  reviewLog: ReviewLogRow[];
}

/** 文字 AI 請求的統一結果。 */
export type ExplainResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

export type SpeechResult =
  | { ok: true; audio: string }
  | { ok: false; error: string };

const NOT_CONFIGURED = '尚未設定 AI，請到設定頁填入 Base URL 與 API Key';
let speechController: AbortController | undefined;

export type Msg =
  | { type: 'getMarks' }
  | { type: 'getHighlightSettings' }
  | { type: 'toggleMark'; word: string; status?: WordStatus }
  | { type: 'lookup'; word: string; surface?: string; sentence: string }
  | { type: 'speak'; text: string }
  | { type: 'saveContext'; word: string; sentence: string; url: string; title: string }
  | { type: 'listWords' }
  | { type: 'listReviewItems' }
  | { type: 'listReviewLog' }
  | { type: 'reviewWord'; word: string; remembered: boolean }
  | { type: 'masterWord'; word: string }
  | {
    type: 'explain'; kind: 'translate' | 'grammar'; sentence: string;
    focus?: string; previous?: string; title?: string;
  }
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

/** Chrome runtime message 不保留 Map，因此回傳 entries。 */
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

    case 'saveContext':
      await addContext(msg);
      return null;

    case 'speak': {
      const text = msg.text.trim().slice(0, 4096);
      if (!text) return { ok: false, error: '沒有可朗讀的文字' } satisfies SpeechResult;
      const settings = await loadSettings();
      if (!settings.baseUrl || !settings.apiKey) {
        return { ok: false, error: NOT_CONFIGURED } satisfies SpeechResult;
      }
      speechController?.abort();
      const controller = new AbortController();
      speechController = controller;
      try {
        const audio = await generateSpeech(text, settings, controller.signal);
        const bytes = new Uint8Array(audio);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        return {
          ok: true,
          audio: `data:audio/mpeg;base64,${btoa(binary)}`,
        } satisfies SpeechResult;
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        } satisfies SpeechResult;
      } finally {
        if (speechController === controller) speechController = undefined;
      }
    }

    // 非串流呼叫沿用相同的快取與錯誤處理。
    case 'lookup':
    case 'explain':
      return handleStreamMessage(msg, () => {});

    case 'listWords': {
      const [words, log] = await Promise.all([
        db.words.filter((row) => row.deletedAt === null).toArray(),
        listReviewLog(),
      ]);
      const drills = new Map<string, number>();
      for (const row of log) drills.set(row.word, (drills.get(row.word) ?? 0) + 1);
      return Promise.all(
        words.map(async ({ word, status, createdAt, collectedAt }) => {
          const contexts = await listContexts(word);
          return {
            word, status, createdAt,
            collectedAt: collectedAt ?? null,
            reviewCount: drills.get(word) ?? 0,
            contexts: contexts.reverse(),
          };
        }),
      );
    }

    case 'listReviewItems':
      return listReviewItems();

    case 'listReviewLog':
      return listReviewLog();

    case 'reviewWord':
      return recordReview(msg.word, msg.remembered);

    case 'masterWord':
      return masterWord(msg.word);

    case 'deleteWord':
      await deleteWord(msg.word);
      return null;

    // markWord 會清除 deletedAt，因此也能復原軟刪除資料。
    case 'setWordStatus':
      await markWord(msg.word, msg.status);
      return true;

    case 'exportData': {
      const [words, contexts, reviewLog] = await Promise.all([
        db.words.filter((r) => r.deletedAt === null).toArray(),
        db.contexts.filter((r) => r.deletedAt === null).toArray(),
        listReviewLog(),
      ]);
      return { exportedAt: Date.now(), words, contexts, reviewLog } satisfies ExportBundle;
    }

    case 'getCachedWord': {
      const row = await db.lookupCache.get(msg.word);
      return row?.deletedAt == null ? row : undefined;
    }

    case 'listCachedWords':
      // variant 是 2.7KB 的 prompt 全文，快取頁用不到，別跟著 runtime message 走。
      return (await db.lookupCache.orderBy('fetchedAt').reverse()
        .filter((row) => row.deletedAt == null).toArray())
        .map(({ variant, ...row }) => row);

    case 'deleteCachedWord':
      await deleteCached(msg.word);
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

/** 內容腳本的長連線版本；快取命中也走同一條 UI 更新路徑。 */
export async function handleStreamMessage(
  msg: Extract<Msg, { type: 'lookup' | 'explain' }>,
  onDelta: (delta: string) => void,
  signal?: AbortSignal,
): Promise<ExplainResult> {
  if (msg.type === 'lookup') {
    const settings = await loadSettings();
    const sentence = msg.sentence.trim();
    const variant = lookupVariant(settings);
    const row = await db.lookupCache.get(msg.word);
    const surface = msg.surface?.trim() || msg.word;
    // ponytail: 同步不搬 surface/sentence/variant，缺欄位視同命中；要精準到句子再改複合主鍵。
    if (row && row.deletedAt == null
      && (row.surface === undefined || row.surface === surface)
      && (row.sentence === undefined || row.sentence === sentence)
      && (row.variant === undefined || row.variant === variant)) {
      onDelta(row.payload);
      return { ok: true, text: row.payload };
    }

    if (!settings.baseUrl || !settings.apiKey) return { ok: false, error: NOT_CONFIGURED };
    try {
      const text = await lookupWord({
        w: msg.word, surface, s: sentence,
      }, settings, onDelta, signal);
      if (!text) return { ok: false, error: 'AI 回了空的結果' };
      await putCached([{
        word: msg.word, payload: text, surface, sentence,
        variant, model: settings.model,
      }]);
      return { ok: true, text };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  const settings = await loadSettings();
  const variant = explainVariant(msg, settings);
  const cached = await getSentence(msg.kind, msg.sentence, variant);
  if (cached !== null) {
    onDelta(cached);
    return { ok: true, text: cached };
  }
  if (!settings.baseUrl || !settings.apiKey) return { ok: false, error: NOT_CONFIGURED };
  try {
    const text = await explainSentence(msg.kind, msg, settings, onDelta, signal);
    if (!text) return { ok: false, error: 'AI 回了空的結果' };
    await putSentence(msg.kind, msg.sentence, text, variant);
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function lookupVariant(settings: Awaited<ReturnType<typeof loadSettings>>): string {
  return JSON.stringify([
    settings.model, settings.profile, SYSTEM_RULES.lookup, settings.templates.lookup,
  ]);
}

function explainVariant(
  msg: Extract<Msg, { type: 'explain' }>,
  settings: Awaited<ReturnType<typeof loadSettings>>,
): string {
  return JSON.stringify([
    settings.model, settings.profile, SYSTEM_RULES[msg.kind], settings.templates[msg.kind],
    msg.focus ?? '', msg.previous ?? '', msg.title ?? '',
  ]);
}
