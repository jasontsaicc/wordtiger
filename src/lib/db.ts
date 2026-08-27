import Dexie, { type Table } from 'dexie';
import type { WordStatus } from './decide';
import { nextReview } from './review';

/** 單字語境的最短長度。 */
const MIN_SENTENCE_LENGTH = 26;

export interface WordRow {
  word: string;
  status: WordStatus;
  createdAt: number;
  /**
   * 真正收藏那天。按 X 排除不是收藏，維持 null。
   * 不能用 status 反推：收藏後馴服仍算收藏過，先按 X 再收藏則 createdAt 停在按 X 那天。
   */
  collectedAt?: number | null;
  updatedAt: number;
  deletedAt: number | null;
  /** 0 是初始階段；5 是最長 30 天間隔。 */
  reviewStep?: number;
  reviewDueAt?: number;
  /** 本機改動尚未被雲端確認；舊資料缺少此欄時也視為待同步。 */
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
  /** `v2:${kind}:${sentence}\0${variant}`，包含 kind 與 sentence。 */
  id: string;
  result: string;
  fetchedAt: number;
}

/** 打老虎的逐次成績。只新增不修改，因此用 uuid 主鍵就能跨裝置合併。 */
export interface ReviewLogRow {
  id: string;
  word: string;
  remembered: boolean;
  at: number;
  /** 本機改動尚未被雲端確認；舊資料缺少此欄時也視為待同步。 */
  pending?: 0 | 1;
}

export interface CacheRow {
  word: string;
  payload: string;
  /** 詞典生成句；僅保存在本機，缺少時退回一般字義題。 */
  sentence?: string;
  /** 缺少時顯示「未知模型」。 */
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
  reviewLog!: Table<ReviewLogRow, string>;

  constructor() {
    super('wordtiger');
    this.version(1).stores({
      words: 'word, updatedAt, deletedAt',
      contexts: 'id, word, updatedAt, deletedAt, [word+createdAt]',
      lookupCache: 'word, fetchedAt',
    });
    // 每版只宣告 schema delta；Dexie 依序套用 migration chain。
    this.version(2).stores({
      sentenceCache: 'id, fetchedAt',
    });
    // v3 的 ++id 只在本機唯一，跨裝置會撞號。Dexie 不支援直接換主鍵，只能丟掉重建。
    this.version(3).stores({
      reviewLog: '++id, at',
    });
    this.version(4).stores({
      reviewLog: null,
    });
    this.version(5).stores({
      reviewLog: 'id, at',
    });
    // 舊資料沒有收藏事件，只能依現狀推斷一次，之後由 markWord 維護。
    this.version(6).upgrade(async (tx) => {
      const words = await tx.table('words').toArray() as WordRow[];
      const withContext = new Set(
        (await tx.table('contexts').toArray() as ContextRow[]).map((row) => row.word),
      );
      const drilled = new Set(
        (await tx.table('reviewLog').toArray() as ReviewLogRow[]).map((row) => row.word),
      );
      await tx.table('words').bulkPut(words.map((row) => ({
        ...row,
        collectedAt: inferCollectedAt(row, withContext.has(row.word), drilled.has(row.word)),
        // 只標待推送，不動 updatedAt：回填不是語意變更，改時間會讓過期的 status 贏過別台
        // 裝置較新的改動。拉取時由 sync 的 preserveCollectedAt 擋下遠端的 null。
        pending: 1 as const,
      })));
    });
  }
}

export const db = new WordTigerDb();

/**
 * 回填舊資料的收藏日。真正的收藏事件從來沒被記錄，只能推斷：
 * 現在還是生詞、留過語境、或練習過，就當作收藏過；其餘視為按 X 排除。
 * 「先按 X、日後才收藏」這種歷史救不回來，那個日期沒有任何地方存過。
 */
export function inferCollectedAt(
  row: { status: WordStatus; createdAt: number },
  hasContext: boolean,
  hasDrill: boolean,
): number | null {
  return row.status === 'unknown' || hasContext || hasDrill ? row.createdAt : null;
}

export async function markWord(word: string, status: WordStatus): Promise<void> {
  const now = Date.now();
  const existing = await db.words.get(word);
  await db.words.put({
    ...existing,
    word,
    status,
    createdAt: existing?.createdAt ?? now,
    // 轉成生詞就是一次收藏；標成已馴服或按 X 排除都保留原本的收藏日。
    collectedAt: status === 'unknown' ? now : existing?.collectedAt ?? null,
    updatedAt: now,
    deletedAt: null,
    pending: 1,
  });
}

/** 軟刪除以同步 tombstone；硬刪除會被其他裝置重新建立。 */
export async function unmarkWord(word: string): Promise<void> {
  const now = Date.now();
  const existing = await db.words.get(word);
  if (!existing) return;
  await db.words.put({ ...existing, updatedAt: now, deletedAt: now, pending: 1 });
}

/** 刪除單字與語境，並保留可同步的 tombstone。 */
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
  // 片語來源句不套用單字語境的最短長度限制。
  if (!input.sentence.trim()
    || (input.sentence.length < MIN_SENTENCE_LENGTH && !/\s/.test(input.word))) return;

  const alive = await listContexts(input.word);
  // ponytail: 每字 O(n) 去重；新增出現可測延遲時再加 [word+url] 索引。
  if (alive.some((r) => r.sentence === input.sentence && r.url === input.url)) return;
  // 保證 createdAt 嚴格遞增，避免同毫秒寫入造成排序不穩定。
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

/** 由舊到新排序。 */
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
      // ponytail: 每題 O(n) 尋找語境；取題出現可測延遲時再建複合索引。
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
  // 排程與紀錄同進同退；只推進排程卻沒留下紀錄，重試會讓間隔多跳一階。
  return db.transaction('rw', db.words, db.reviewLog, async () => {
    const row = await db.words.get(word);
    if (!row || row.deletedAt !== null || row.status !== 'unknown') return false;
    await db.words.put({
      ...row,
      ...nextReview(row.reviewStep ?? 0, remembered, now),
      updatedAt: now,
      pending: 1,
    });
    await db.reviewLog.add({
      id: crypto.randomUUID(), word, remembered, at: now, pending: 1,
    });
    return true;
  });
}

/** 「已經馴服」：記下最後一次成功練習並改成 known，兩筆寫入同進同退。 */
export function masterWord(word: string, now = Date.now()): Promise<boolean> {
  return db.transaction('rw', db.words, db.reviewLog, async () => {
    const row = await db.words.get(word);
    if (!row || row.deletedAt !== null || row.status !== 'unknown') return false;
    await db.reviewLog.add({
      id: crypto.randomUUID(), word, remembered: true, at: now, pending: 1,
    });
    await db.words.put({ ...row, status: 'known', updatedAt: now, pending: 1 });
    return true;
  });
}

/** 由舊到新；月曆與次數統計都在記憶體分組。 */
export function listReviewLog(): Promise<ReviewLogRow[]> {
  // ponytail: 全表掃描；筆數大到有感時再改用 at 索引取區間。
  return db.reviewLog.orderBy('at').toArray();
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

/** 保留原句作為 cache key，便於追查；同頁原句通常逐字相同。 */
export function sentenceKey(kind: string, sentence: string, variant = ''): string {
  // v2 使舊版「純譯文／教科書文法」快取失效。
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
