import Dexie, { type Table } from 'dexie';
import type { WordStatus } from './decide';
import { nextReview } from './review';

/** 語境句子的最短長度。太短的句子沒有語境價值 */
const MIN_SENTENCE_LENGTH = 26;

export interface WordRow {
  word: string;
  status: WordStatus;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  /** 0 是剛開始；5 是最長 30 天間隔 */
  reviewStep?: number;
  reviewDueAt?: number;
  /** 本機改動尚未被雲端確認；舊資料沒有此欄時也視為待同步 */
  pending?: 0 | 1;
}

export interface ReviewItem {
  word: string;
  isPhrase: boolean;
  isPattern: boolean;
  reviewStep: number;
  definition: string;
  context?: Pick<ContextRow, 'sentence' | 'url' | 'title'>;
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
  pending?: 0 | 1;
}

export interface ContextInput {
  word: string;
  sentence: string;
  url: string;
  title: string;
}

export interface SentenceRow {
  /** `v2:${kind}:${sentence}\0${variant}`,kind 與 sentence 都編碼在裡面 */
  id: string;
  result: string;
  fetchedAt: number;
}

export interface CacheRow {
  word: string;
  payload: string;
  /** 產生詞典時使用的句子；只留本機，舊快取或其他裝置沒有時改出一般字義題。 */
  sentence?: string;
  /** 舊快取沒有這欄,顯示時退回「未知模型」 */
  model?: string;
  fetchedAt: number;
  updatedAt: number;
  deletedAt: number | null;
  pending?: 0 | 1;
}

class WordTigerDb extends Dexie {
  words!: Table<WordRow, string>;
  contexts!: Table<ContextRow, string>;
  lookupCache!: Table<CacheRow, string>;
  sentenceCache!: Table<SentenceRow, string>;

  constructor() {
    super('wordtiger');
    this.version(1).stores({
      words: 'word, updatedAt, deletedAt',
      contexts: 'id, word, updatedAt, deletedAt, [word+createdAt]',
      lookupCache: 'word, fetchedAt',
    });
    // Dexie 的每個 version 只宣告跟前一版的差異,沒提到的表原封不動保留。
    // 同名資料庫未來再升版時會沿用這條 migration chain。
    this.version(2).stores({
      sentenceCache: 'id, fetchedAt',
    });
  }
}

export const db = new WordTigerDb();

export async function markWord(word: string, status: WordStatus): Promise<void> {
  const now = Date.now();
  const existing = await db.words.get(word);
  await db.words.put({
    ...existing,
    word,
    status,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    deletedAt: null,
    pending: 1,
  });
}

/** 軟刪除。P2 的同步靠 deletedAt 把刪除事件傳到另一台,硬刪會讓那台把它推回來 */
export async function unmarkWord(word: string): Promise<void> {
  const now = Date.now();
  const existing = await db.words.get(word);
  if (!existing) return;
  await db.words.put({ ...existing, updatedAt: now, deletedAt: now, pending: 1 });
}

/** options 的「刪除」比取消標記更強:單字與其語境一起留下可同步的 tombstone。 */
export async function deleteWord(word: string): Promise<void> {
  const now = Date.now();
  await db.transaction('rw', db.words, db.contexts, async () => {
    const existing = await db.words.get(word);
    if (existing) await db.words.put({ ...existing, updatedAt: now, deletedAt: now, pending: 1 });

    const contexts = await db.contexts.where('word').equals(word).toArray();
    await db.contexts.bulkPut(
      contexts.map((row) => ({ ...row, updatedAt: now, deletedAt: now, pending: 1 as const })),
    );
  });
}

export async function loadMarks(): Promise<Map<string, WordStatus>> {
  const rows = await db.words.filter((r) => r.deletedAt === null).toArray();
  return new Map(rows.map((r) => [r.word, r.status]));
}

export async function addContext(input: ContextInput): Promise<void> {
  // 片語的來源句可能很短,仍值得保留；單字語境繼續過濾碎片。
  if (!input.sentence.trim()
    || (input.sentence.length < MIN_SENTENCE_LENGTH && !/\s/.test(input.word))) return;

  const alive = await listContexts(input.word);
  // ponytail: 每字線性掃描去重；單人資料真的大到新增變慢時再加 [word+url] 索引。
  if (alive.some((r) => r.sentence === input.sentence && r.url === input.url)) return;
  // 同一毫秒內連續寫入會讓 createdAt 相同,汰換誰就變成不確定的。往後推一毫秒保證嚴格遞增。
  const now = Math.max(Date.now(), (alive.at(-1)?.createdAt ?? 0) + 1);
  await db.contexts.put({
    id: crypto.randomUUID(),
    ...input,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    pending: 1,
  });
}

/** 由舊到新排序 */
export async function listContexts(word: string): Promise<ContextRow[]> {
  const rows = await db.contexts.where('word').equals(word).toArray();
  return rows
    .filter((r) => r.deletedAt === null)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function listReviewItems(limit = 5, now = Date.now()): Promise<ReviewItem[]> {
  const candidates = (await db.words
    .filter((row) => row.deletedAt === null
      && row.status === 'unknown'
      && (row.reviewDueAt ?? 0) <= now)
    .toArray())
    .sort((a, b) => (a.reviewDueAt ?? 0) - (b.reviewDueAt ?? 0)
      || a.createdAt - b.createdAt);
  if (!candidates.length) return [];

  const words = candidates.map((row) => row.word);
  const wanted = new Set(words);
  const [contexts, caches] = await Promise.all([
    db.contexts.filter((row) => row.deletedAt === null && wanted.has(row.word)).toArray(),
    db.lookupCache.where('word').anyOf(words)
      .filter((row) => row.deletedAt === null).toArray(),
  ]);
  const latest = new Map<string, ContextRow>();
  for (const row of contexts) {
    if ((latest.get(row.word)?.createdAt ?? -1) < row.createdAt) latest.set(row.word, row);
  }
  const definitions = new Map(caches.map((row) => [row.word, row]));

  const items: ReviewItem[] = [];
  for (const row of candidates) {
    const isPhrase = /\s/.test(row.word);
    const definition = definitions.get(row.word);
    if (!definition || (isPhrase && !latest.has(row.word))) continue;

    let context = isPhrase ? latest.get(row.word) : undefined;
    if (!isPhrase && definition?.sentence) {
      // ponytail: 每題線性找同句語境；個人詞庫真的大到取五題變慢時再建複合索引。
      context = contexts.find((item) =>
        item.word === row.word && item.sentence === definition.sentence);
    }
    const reviewContext = context
      ? { sentence: context.sentence, url: context.url, title: context.title }
      : definition?.sentence
        ? { sentence: definition.sentence, url: '', title: '' }
        : undefined;
    const isPattern = Boolean(isPhrase && reviewContext
      && !reviewContext.sentence.toLowerCase().includes(row.word.toLowerCase()));
    items.push({
      word: row.word,
      isPhrase,
      isPattern,
      reviewStep: row.reviewStep ?? 0,
      definition: definition.payload,
      context: reviewContext,
    });
    if (items.length === limit) break;
  }
  return items;
}

export async function recordReview(
  word: string,
  remembered: boolean,
  now = Date.now(),
): Promise<boolean> {
  const row = await db.words.get(word);
  if (!row || row.deletedAt !== null || row.status !== 'unknown') return false;
  await db.words.put({
    ...row,
    ...nextReview(row.reviewStep ?? 0, remembered, now),
    updatedAt: now,
    pending: 1,
  });
  return true;
}

export async function getCached(words: string[]): Promise<Map<string, string>> {
  const rows = await db.lookupCache.where('word').anyOf(words).toArray();
  return new Map(rows.filter((r) => r.deletedAt == null).map((r) => [r.word, r.payload]));
}

export async function putCached(
  entries: Array<{ word: string; payload: string; sentence?: string; model?: string }>,
): Promise<void> {
  const now = Date.now();
  await db.lookupCache.bulkPut(entries.map((e) => ({
    ...e, fetchedAt: now, updatedAt: now, deletedAt: null, pending: 1 as const,
  })));
}

export async function deleteCached(word: string): Promise<void> {
  const row = await db.lookupCache.get(word);
  if (!row) return;
  const now = Date.now();
  await db.lookupCache.put({ ...row, updatedAt: now, deletedAt: now, pending: 1 });
}

/**
 * 快取鍵直接用原句,不做小寫化或空白正規化。
 * 正規化能提高命中率,但會讓 key 跟原句對不起來,除錯時要多猜一層。
 * 同一句在同一篇文章裡本來就是逐字相同,命中率的損失很小。
 */
export function sentenceKey(kind: string, sentence: string, variant = ''): string {
  // v2 讓舊版「純譯文 / 教科書文法」回覆自然失效。
  return `v2:${kind}:${sentence}\0${variant}`;
}

export async function getSentence(
  kind: string,
  sentence: string,
  variant = '',
): Promise<string | null> {
  const row = await db.sentenceCache.get(sentenceKey(kind, sentence, variant));
  return row?.result ?? null;
}

export async function putSentence(
  kind: string,
  sentence: string,
  result: string,
  variant = '',
): Promise<void> {
  await db.sentenceCache.put({
    id: sentenceKey(kind, sentence, variant),
    result,
    fetchedAt: Date.now(),
  });
}
