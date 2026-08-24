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

export interface CacheRow {
  word: string;
  payload: string;
  fetchedAt: number;
}

class VocabDb extends Dexie {
  words!: Table<WordRow, string>;
  contexts!: Table<ContextRow, string>;
  lookupCache!: Table<CacheRow, string>;

  constructor() {
    super('vocab');
    this.version(1).stores({
      words: 'word, updatedAt, deletedAt',
      contexts: 'id, word, updatedAt, deletedAt, [word+createdAt]',
      lookupCache: 'word, fetchedAt',
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
  entries: Array<{ word: string; payload: string }>,
): Promise<void> {
  const now = Date.now();
  await db.lookupCache.bulkPut(entries.map((e) => ({ ...e, fetchedAt: now })));
}
