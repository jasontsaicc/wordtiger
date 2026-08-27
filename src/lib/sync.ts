import { db, type CacheRow, type ContextRow, type ReviewLogRow, type WordRow } from './db';

const KEY = 'sync';

interface Session {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
  email: string;
}

interface StoredSync {
  url: string;
  anonKey: string;
  session?: Session;
  accountId?: string;
  cursor: number;
  lastSuccessAt?: number;
  lastError?: string;
}

export interface SyncState {
  url: string;
  anonKey: string;
  email: string;
  loggedIn: boolean;
  lastSuccessAt?: number;
  lastError?: string;
}

export interface SyncResult {
  pulled: number;
  pushed: number;
  finishedAt: number;
}

type RemoteWord = {
  user_id: string;
  word: string;
  status: WordRow['status'];
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  review_step?: number;
  review_due_at?: string | null;
  collected_at?: string | null;
};

type RemoteContext = {
  id: string;
  user_id: string;
  word: string;
  sentence: string;
  url: string;
  title: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type RemoteReviewLog = {
  id: string;
  user_id: string;
  word: string;
  remembered: boolean;
  at: string;
};

type RemoteLookupCache = {
  user_id: string;
  word: string;
  payload: string;
  model: string | null;
  fetched_at: string;
  updated_at: string;
  deleted_at: string | null;
};

let running: Promise<SyncResult> | undefined;

async function load(): Promise<StoredSync> {
  const got = await browser.storage.local.get(KEY);
  const stored = (got[KEY] ?? {}) as Partial<StoredSync>;
  return {
    url: typeof stored.url === 'string' ? stored.url : '',
    anonKey: typeof stored.anonKey === 'string' ? stored.anonKey : '',
    cursor: typeof stored.cursor === 'number' ? stored.cursor : 0,
    session: stored.session,
    accountId: stored.accountId,
    lastSuccessAt: stored.lastSuccessAt,
    lastError: stored.lastError,
  };
}

async function save(value: StoredSync): Promise<void> {
  await browser.storage.local.set({ [KEY]: value });
}

function cleanUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    throw new Error('Supabase URL 必須使用 HTTPS');
  }
  return url.origin;
}

export async function getSyncState(): Promise<SyncState> {
  const stored = await load();
  return {
    url: stored.url,
    anonKey: stored.anonKey,
    email: stored.session?.email ?? '',
    loggedIn: Boolean(stored.session),
    lastSuccessAt: stored.lastSuccessAt,
    lastError: stored.lastError,
  };
}

export async function signIn(
  url: string,
  anonKey: string,
  email: string,
  password: string,
): Promise<SyncState> {
  if (!anonKey.trim() || !email.trim() || !password) throw new Error('登入欄位不能留空');
  const stored = await load();
  const normalized = cleanUrl(url);
  const response = await fetch(`${normalized}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey.trim(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), password }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error_description ?? body.msg ?? `登入失敗 ${response.status}`);

  const changedAccount = Boolean(
    (stored.accountId && stored.accountId !== body.user.id)
    || (stored.url && stored.url !== normalized),
  );
  if (changedAccount) {
    await Promise.all([
      db.words.toCollection().modify({ pending: 1 }),
      db.contexts.toCollection().modify({ pending: 1 }),
      db.reviewLog.toCollection().modify({ pending: 1 }),
      // 切換帳號時不將原帳號 cache 上傳至新帳號。
      db.lookupCache.toCollection().modify({ pending: 0 }),
    ]);
  }
  await save({
    url: normalized,
    anonKey: anonKey.trim(),
    cursor: changedAccount ? 0 : stored.cursor,
    accountId: body.user.id,
    session: {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: Date.now() + body.expires_in * 1000,
      userId: body.user.id,
      email: body.user.email ?? email.trim(),
    },
  });
  return getSyncState();
}

export async function signOut(): Promise<SyncState> {
  const stored = await load();
  if (stored.session) {
    await fetch(`${stored.url}/auth/v1/logout`, {
      method: 'POST',
      headers: { apikey: stored.anonKey, Authorization: `Bearer ${stored.session.accessToken}` },
    }).catch(() => undefined);
  }
  await save({
    url: stored.url, anonKey: stored.anonKey, cursor: stored.cursor,
    accountId: stored.accountId,
  });
  return getSyncState();
}

async function session(stored: StoredSync): Promise<Session> {
  if (!stored.session) throw new Error('請先登入 Supabase');
  if (stored.session.expiresAt > Date.now() + 60_000) return stored.session;

  const response = await fetch(`${stored.url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: stored.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: stored.session.refreshToken }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error_description ?? body.msg ?? '登入已過期');
  stored.session = {
    ...stored.session,
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  };
  await save(stored);
  return stored.session;
}

async function request<T>(
  stored: StoredSync,
  active: Session,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${stored.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: stored.anonKey,
      Authorization: `Bearer ${active.accessToken}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`同步失敗 ${response.status}${text ? `：${text}` : ''}`);
  }
  return response.status === 204 ? undefined as T : response.json();
}

function stamp(value: string | null): number | null {
  return value ? Date.parse(value) : null;
}

function localWord(row: RemoteWord): WordRow {
  return {
    word: row.word,
    status: row.status,
    createdAt: Date.parse(row.created_at),
    collectedAt: stamp(row.collected_at ?? null),
    updatedAt: Date.parse(row.updated_at),
    deletedAt: stamp(row.deleted_at),
    reviewStep: row.review_step ?? 0,
    reviewDueAt: stamp(row.review_due_at ?? null) ?? undefined,
    pending: 0,
  };
}

function localContext(row: RemoteContext): ContextRow {
  return {
    id: row.id,
    word: row.word,
    sentence: row.sentence,
    url: row.url ?? '',
    title: row.title ?? '',
    createdAt: Date.parse(row.created_at),
    updatedAt: Date.parse(row.updated_at),
    deletedAt: stamp(row.deleted_at),
    pending: 0,
  };
}

function localReviewLog(row: RemoteReviewLog): ReviewLogRow {
  return {
    id: row.id,
    word: row.word,
    remembered: row.remembered,
    at: Date.parse(row.at),
    pending: 0,
  };
}

function localLookupCache(row: RemoteLookupCache): CacheRow {
  return {
    word: row.word,
    payload: row.payload,
    model: row.model ?? undefined,
    fetchedAt: Date.parse(row.fetched_at),
    updatedAt: Date.parse(row.updated_at),
    deletedAt: stamp(row.deleted_at),
    pending: 0,
  };
}

/** 待推送的本機改動較新才保留；否則遠端資料（含 tombstone）勝出。 */
export function resolveRow<
  L extends { updatedAt: number; pending?: 0 | 1 },
  R extends { updatedAt: number; pending?: 0 | 1 },
>(local: L | undefined, remote: R): L | R {
  return local && local.pending !== 0 && local.updatedAt > remote.updatedAt
    ? local
    : { ...remote, pending: 0 };
}

/** 推送途中若本機又被改過，不可用較舊的伺服器回應蓋掉它。 */
export function acknowledgeRow<
  C extends { updatedAt: number; pending?: 0 | 1 },
  S extends { updatedAt: number; pending?: 0 | 1 },
  R extends { updatedAt: number; pending?: 0 | 1 },
>(current: C | undefined, sent: S | undefined, remote: R): C | R {
  return !current || (sent && current.pending !== 0 && current.updatedAt === sent.updatedAt)
    ? { ...remote, pending: 0 }
    : current;
}

function iso(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function remoteWord(row: WordRow, userId: string) {
  return {
    user_id: userId,
    word: row.word,
    status: row.status,
    created_at: iso(row.createdAt),
    collected_at: iso(row.collectedAt ?? null),
    review_step: row.reviewStep ?? 0,
    review_due_at: iso(row.reviewDueAt ?? null),
    deleted_at: iso(row.deletedAt),
  };
}

function remoteContext(row: ContextRow, userId: string) {
  return {
    id: row.id,
    user_id: userId,
    word: row.word,
    sentence: row.sentence,
    url: row.url,
    title: row.title,
    created_at: iso(row.createdAt),
    deleted_at: iso(row.deletedAt),
  };
}

function remoteReviewLog(row: ReviewLogRow, userId: string) {
  return {
    id: row.id,
    user_id: userId,
    word: row.word,
    remembered: row.remembered,
    at: iso(row.at),
  };
}

function remoteLookupCache(row: CacheRow, userId: string) {
  return {
    user_id: userId,
    word: row.word,
    payload: row.payload,
    model: row.model ?? null,
    fetched_at: iso(row.fetchedAt),
    deleted_at: iso(row.deletedAt ?? null),
  };
}

/**
 * 收藏日不能交給 resolveRow 決定：回填不更新 updatedAt，而按 X 會在保留舊值的同時
 * 更新 updatedAt，兩種情況都會讓「贏的那一邊」帶著較差的收藏日。
 * 改成取兩邊非空值中較晚的一個，跟 markWord 的「重新收藏取最新日期」一致，
 * null 則永遠不會蓋掉有值的一邊。
 */
export function mergeCollectedAt(
  local: Pick<WordRow, 'collectedAt'> | undefined,
  remote: Pick<WordRow, 'collectedAt'>,
  merged: WordRow,
): WordRow {
  // 0 代表沒有收藏日；collectedAt 來自 Date.now()，實務上不會是 0。
  const collectedAt = Math.max(local?.collectedAt ?? 0, remote.collectedAt ?? 0) || null;
  return {
    ...merged,
    collectedAt,
    // 雲端還不是這個日期就要補推，否則本機贏了也只有自己知道。
    pending: collectedAt === (remote.collectedAt ?? null) ? merged.pending : 1,
  };
}

/** 保留本機詞典生成句，但不將該欄位同步至遠端。 */
function preserveLocalSentence(local: CacheRow | undefined, merged: CacheRow): CacheRow {
  return local?.sentence && local.payload === merged.payload
    ? { ...merged, sentence: local.sentence }
    : merged;
}

async function pull<T>(
  stored: StoredSync,
  active: Session,
  table: string,
  cutoff: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const query = new URLSearchParams({
      select: '*',
      updated_at: `gt.${new Date(stored.cursor).toISOString()}`,
      and: `(updated_at.lte.${cutoff})`,
      order: 'updated_at.asc',
      limit: '1000',
      offset: String(offset),
    });
    const page = await request<T[]>(stored, active, `${table}?${query}`);
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

async function push<T>(
  stored: StoredSync,
  active: Session,
  table: string,
  conflict: string,
  rows: unknown[],
): Promise<T[]> {
  if (!rows.length) return [];
  const saved: T[] = [];
  for (let offset = 0; offset < rows.length; offset += 500) {
    saved.push(...await request<T[]>(stored, active,
      `${table}?on_conflict=${encodeURIComponent(conflict)}&select=*`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(rows.slice(offset, offset + 500)),
    }));
  }
  return saved;
}

async function performSync(): Promise<SyncResult> {
  const stored = await load();
  try {
    const active = await session(stored);
    const cutoff = await request<string>(stored, active, 'rpc/sync_clock', {
      method: 'POST', body: '{}',
    });
    const [remoteWords, remoteContexts, remoteLookupCaches, remoteReviewLogs] = await Promise.all([
      pull<RemoteWord>(stored, active, 'words', cutoff),
      pull<RemoteContext>(stored, active, 'contexts', cutoff),
      pull<RemoteLookupCache>(stored, active, 'lookup_cache', cutoff),
      pull<RemoteReviewLog>(stored, active, 'review_log', cutoff),
    ]);

    await db.transaction('rw', db.words, db.contexts, db.lookupCache, db.reviewLog, async () => {
      for (const row of remoteWords) {
        const remote = localWord(row);
        const local = await db.words.get(remote.word);
        await db.words.put(mergeCollectedAt(local, remote, resolveRow(local, remote)));
      }
      for (const row of remoteContexts) {
        const remote = localContext(row);
        await db.contexts.put(resolveRow(await db.contexts.get(remote.id), remote));
      }
      for (const row of remoteLookupCaches) {
        const remote = localLookupCache(row);
        const local = await db.lookupCache.get(remote.word);
        await db.lookupCache.put(preserveLocalSentence(local, resolveRow(local, remote)));
      }
      // 成績只新增不修改，同一個 id 兩邊內容一定相同，不需要衝突解析。
      for (const row of remoteReviewLogs) await db.reviewLog.put(localReviewLog(row));
    });

    const [pendingWords, pendingContexts, pendingLookupCaches, pendingReviewLogs] =
      await Promise.all([
        db.words.filter((row) => row.pending !== 0).toArray(),
        db.contexts.filter((row) => row.pending !== 0).toArray(),
        db.lookupCache.filter((row) => row.pending !== 0).toArray(),
        db.reviewLog.filter((row) => row.pending !== 0).toArray(),
      ]);
    const [savedWords, savedContexts, savedLookupCaches, savedReviewLogs] = await Promise.all([
      push<RemoteWord>(stored, active, 'words', 'user_id,word',
        pendingWords.map((row) => remoteWord(row, active.userId))),
      push<RemoteContext>(stored, active, 'contexts', 'user_id,id',
        pendingContexts.map((row) => remoteContext(row, active.userId))),
      push<RemoteLookupCache>(stored, active, 'lookup_cache', 'user_id,word',
        pendingLookupCaches.map((row) => remoteLookupCache(row, active.userId))),
      push<RemoteReviewLog>(stored, active, 'review_log', 'user_id,id',
        pendingReviewLogs.map((row) => remoteReviewLog(row, active.userId))),
    ]);
    const sentWords = new Map(pendingWords.map((row) => [row.word, row]));
    const sentContexts = new Map(pendingContexts.map((row) => [row.id, row]));
    const sentLookupCaches = new Map(pendingLookupCaches.map((row) => [row.word, row]));
    await db.transaction('rw', db.words, db.contexts, db.lookupCache, db.reviewLog, async () => {
      for (const row of savedWords.map(localWord)) {
        await db.words.put(acknowledgeRow(
          await db.words.get(row.word), sentWords.get(row.word), row,
        ));
      }
      for (const row of savedContexts.map(localContext)) {
        await db.contexts.put(acknowledgeRow(
          await db.contexts.get(row.id), sentContexts.get(row.id), row,
        ));
      }
      for (const row of savedLookupCaches.map(localLookupCache)) {
        const current = await db.lookupCache.get(row.word);
        await db.lookupCache.put(preserveLocalSentence(current, acknowledgeRow(
          current, sentLookupCaches.get(row.word), row,
        )));
      }
      for (const row of savedReviewLogs.map(localReviewLog)) await db.reviewLog.put(row);
    });

    const finishedAt = Date.now();
    delete stored.lastError;
    await save({ ...stored, session: active, cursor: Date.parse(cutoff), lastSuccessAt: finishedAt });
    return {
      pulled: remoteWords.length + remoteContexts.length
        + remoteLookupCaches.length + remoteReviewLogs.length,
      pushed: savedWords.length + savedContexts.length
        + savedLookupCaches.length + savedReviewLogs.length,
      finishedAt,
    };
  } catch (error) {
    await save({ ...stored, lastError: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

export function syncNow(): Promise<SyncResult> {
  // ponytail: 單一 service worker 共用鎖；需要多帳號並行時再拆分。
  return running ??= performSync().finally(() => { running = undefined; });
}
