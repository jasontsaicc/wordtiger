import Dexie, { type Table } from 'dexie';
import type { WordStatus } from './decide';

/** 語境句子的最短長度。太短的句子沒有語境價值 */
const MIN_SENTENCE_LENGTH = 26;
/** 同一個字保留幾條語境 */
const MAX_CONTEXTS_PER_WORD = 5;

export interface WordRow {
  word: string;
  status: WordStatus;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface ContextRow {
  id: string;
  word: string;
  sentence: string;
  url: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface ContextInput {
  word: string;
  sentence: string;
  url: string;
  title: string;
}

export interface SentenceRow {
  /** `${kind}:${sentence}` */
  id: string;
  kind: string;
  sentence: string;
  result: string;
  fetchedAt: number;
}

export interface CacheRow {
  word: string;
  payload: string;
  /** 舊快取沒有這欄,顯示時退回「未知模型」 */
  model?: string;
  fetchedAt: number;
}

class VocabDb extends Dexie {
  words!: Table<WordRow, string>;
  contexts!: Table<ContextRow, string>;
  lookupCache!: Table<CacheRow, string>;
  sentenceCache!: Table<SentenceRow, string>;

  constructor() {
    super('vocab');
    this.version(1).stores({
      words: 'word, updatedAt, deletedAt',
      contexts: 'id, word, updatedAt, deletedAt, [word+createdAt]',
      lookupCache: 'word, fetchedAt',
    });
    // Dexie 的每個 version 只宣告跟前一版的差異,沒提到的表原封不動保留。
    // 已經裝在瀏覽器裡的舊資料庫靠這個 version 升上來,不會被清掉。
    this.version(2).stores({
      sentenceCache: 'id, fetchedAt',
    });
  }
}

export const db = new VocabDb();

export async function markWord(word: string, status: WordStatus): Promise<void> {
  const now = Date.now();
  const existing = await db.words.get(word);
  await db.words.put({
    word,
    status,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    deletedAt: null,
  });
}

/** 軟刪除。P2 的同步靠 deletedAt 把刪除事件傳到另一台,硬刪會讓那台把它推回來 */
export async function unmarkWord(word: string): Promise<void> {
  const now = Date.now();
  const existing = await db.words.get(word);
  if (!existing) return;
  await db.words.put({ ...existing, updatedAt: now, deletedAt: now });
}

/** options 的「刪除」比取消標記更強:單字與其語境一起留下可同步的 tombstone。 */
export async function deleteWord(word: string): Promise<void> {
  const now = Date.now();
  await db.transaction('rw', db.words, db.contexts, async () => {
    const existing = await db.words.get(word);
    if (existing) await db.words.put({ ...existing, updatedAt: now, deletedAt: now });

    const contexts = await db.contexts.where('word').equals(word).toArray();
    await db.contexts.bulkPut(
      contexts.map((row) => ({ ...row, updatedAt: now, deletedAt: now })),
    );
  });
}

export async function loadMarks(): Promise<Map<string, WordStatus>> {
  const rows = await db.words.filter((r) => r.deletedAt === null).toArray();
  return new Map(rows.map((r) => [r.word, r.status]));
}

export async function addContext(input: ContextInput): Promise<void> {
  if (input.sentence.length < MIN_SENTENCE_LENGTH) return;

  const alive = await listContexts(input.word);
  // 同一毫秒內連續寫入會讓 createdAt 相同,汰換誰就變成不確定的。往後推一毫秒保證嚴格遞增。
  const now = Math.max(Date.now(), (alive.at(-1)?.createdAt ?? 0) + 1);
  await db.contexts.put({
    id: crypto.randomUUID(),
    ...input,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });

  if (alive.length + 1 > MAX_CONTEXTS_PER_WORD) {
    const surplus = alive.slice(0, alive.length + 1 - MAX_CONTEXTS_PER_WORD);
    await Promise.all(
      surplus.map((r) => db.contexts.update(r.id, { updatedAt: now, deletedAt: now })),
    );
  }
}

/** 由舊到新排序 */
export async function listContexts(word: string): Promise<ContextRow[]> {
  const rows = await db.contexts.where('word').equals(word).toArray();
  return rows
    .filter((r) => r.deletedAt === null)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function getCached(words: string[]): Promise<Map<string, string>> {
  const rows = await db.lookupCache.where('word').anyOf(words).toArray();
  return new Map(rows.map((r) => [r.word, r.payload]));
}

export async function putCached(
  entries: Array<{ word: string; payload: string; model?: string }>,
): Promise<void> {
  const now = Date.now();
  await db.lookupCache.bulkPut(entries.map((e) => ({ ...e, fetchedAt: now })));
}

/**
 * 快取鍵直接用原句,不做小寫化或空白正規化。
 * 正規化能提高命中率,但會讓 key 跟原句對不起來,除錯時要多猜一層。
 * 同一句在同一篇文章裡本來就是逐字相同,命中率的損失很小。
 */
export function sentenceKey(kind: string, sentence: string): string {
  return `${kind}:${sentence}`;
}

export async function getSentence(
  kind: string,
  sentence: string,
): Promise<string | null> {
  const row = await db.sentenceCache.get(sentenceKey(kind, sentence));
  return row?.result ?? null;
}

export async function putSentence(
  kind: string,
  sentence: string,
  result: string,
): Promise<void> {
  await db.sentenceCache.put({
    id: sentenceKey(kind, sentence),
    kind,
    sentence,
    result,
    fetchedAt: Date.now(),
  });
}
