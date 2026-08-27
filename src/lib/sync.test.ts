import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import 'fake-indexeddb/auto';
import { db, getCached, putCached, type WordRow } from './db';
import { acknowledgeRow, mergeCollectedAt, signIn, syncNow, resolveRow } from './sync';

const wordRow = (over: Partial<WordRow> = {}): WordRow => ({
  word: 'deploy', status: 'unknown', createdAt: 1, collectedAt: null,
  updatedAt: 1, deletedAt: null, pending: 0, ...over,
});

beforeEach(async () => {
  fakeBrowser.reset();
  await db.words.clear();
  await db.contexts.clear();
  await db.lookupCache.clear();
  await db.reviewLog.clear();
  vi.restoreAllMocks();
});

describe('resolveRow', () => {
  it('遠端 tombstone 較新時套用刪除', () => {
    const local = { updatedAt: 10, deletedAt: null, pending: 1 as const };
    const remote = { updatedAt: 20, deletedAt: 20, pending: 0 as const };
    expect(resolveRow(local, remote)).toEqual(remote);
  });

  it('本機待同步改動較新時保留，稍後推送', () => {
    const local = { updatedAt: 30, value: 'local', pending: 1 as const };
    const remote = { updatedAt: 20, value: 'remote', pending: 0 as const };
    expect(resolveRow(local, remote)).toBe(local);
  });
});

describe('acknowledgeRow', () => {
  it('推送途中又有本機改動時不覆蓋新值', () => {
    const sent = { updatedAt: 10, value: 'sent', pending: 1 as const };
    const current = { updatedAt: 20, value: 'new', pending: 1 as const };
    const remote = { updatedAt: 30, value: 'sent', pending: 0 as const };
    expect(acknowledgeRow(current, sent, remote)).toBe(current);
  });
});

describe('mergeCollectedAt', () => {
  it('遠端還沒回填時保留本機收藏日，並排入推送', () => {
    const merged = mergeCollectedAt(
      { collectedAt: 10 }, { collectedAt: null }, wordRow({ pending: 0 }),
    );
    expect(merged.collectedAt).toBe(10);
    expect(merged.pending).toBe(1);
  });

  it('本機較新但沒有收藏日時，不會把遠端的收藏日推成 null', () => {
    const merged = mergeCollectedAt(
      { collectedAt: null }, { collectedAt: 500 }, wordRow({ collectedAt: null, pending: 1 }),
    );
    expect(merged.collectedAt).toBe(500);
  });

  it('兩邊都有收藏日時取較晚的，跟重新收藏取最新一致', () => {
    expect(mergeCollectedAt(
      { collectedAt: 100 }, { collectedAt: 500 }, wordRow({ collectedAt: 100 }),
    ).collectedAt).toBe(500);
    expect(mergeCollectedAt(
      { collectedAt: 500 }, { collectedAt: 100 }, wordRow({ collectedAt: 500 }),
    ).collectedAt).toBe(500);
  });

  it('只有本機收藏日較新才排入推送', () => {
    expect(mergeCollectedAt(
      { collectedAt: 500 }, { collectedAt: 100 }, wordRow({ pending: 0 }),
    ).pending).toBe(1);
    expect(mergeCollectedAt(
      { collectedAt: 100 }, { collectedAt: 500 }, wordRow({ pending: 0 }),
    ).pending).toBe(0);
  });

  it('兩邊都沒有收藏日時維持 null，也不改 pending', () => {
    const merged = mergeCollectedAt(undefined, { collectedAt: null }, wordRow({ pending: 0 }));
    expect(merged.collectedAt).toBeNull();
    expect(merged.pending).toBe(0);
  });
});

describe('syncNow', () => {
  it('登入後拉回 tombstone 並只推送本機待同步列', async () => {
    await db.words.bulkPut([
      { word: 'old', status: 'unknown', createdAt: 10, updatedAt: 10, deletedAt: null, pending: 1 },
      {
        word: 'local', status: 'unknown', createdAt: 30, collectedAt: 35, updatedAt: 30,
        deletedAt: null, reviewStep: 2, reviewDueAt: 50, pending: 1,
      },
    ]);
    const response = (body: unknown) => ({
      ok: true, status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response);
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({
        access_token: 'access', refresh_token: 'refresh', expires_in: 3600,
        user: { id: 'user-1', email: 'me@example.com' },
      }))
      .mockResolvedValueOnce(response('1970-01-01T00:00:01.000Z'))
      .mockResolvedValueOnce(response([{
        user_id: 'user-1', word: 'old', status: 'unknown',
        created_at: '1970-01-01T00:00:00.010Z',
        updated_at: '1970-01-01T00:00:00.020Z',
        deleted_at: '1970-01-01T00:00:00.020Z',
      }]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([{
        user_id: 'user-1', word: 'local', status: 'unknown',
        created_at: '1970-01-01T00:00:00.030Z',
        collected_at: '1970-01-01T00:00:00.035Z',
        updated_at: '1970-01-01T00:00:00.040Z', deleted_at: null,
        review_step: 2, review_due_at: '1970-01-01T00:00:00.050Z',
      }]));

    await signIn('https://project.supabase.co', 'anon', 'me@example.com', 'password');
    const result = await syncNow();

    expect(result).toMatchObject({ pulled: 1, pushed: 1 });
    expect((await db.words.get('old'))!.deletedAt).toBe(20);
    expect((await db.words.get('local'))!.pending).toBe(0);
    // 收藏日要跟著上雲端，否則換裝置後學習足跡會少掉「新收藏」。
    expect((await db.words.get('local'))!.collectedAt).toBe(35);
    expect(fetchMock.mock.calls[6]![1]?.body).toContain('"word":"local"');
    expect(fetchMock.mock.calls[6]![1]?.body).toContain('"review_step":2');
    expect(fetchMock.mock.calls[6]![1]?.body)
      .toContain('"collected_at":"1970-01-01T00:00:00.035Z"');
  });

  it('同一帳號會拉回別台裝置的詞典 cache 並推送本機 cache', async () => {
    await putCached([{
      word: 'local', payload: '本機詞典', sentence: 'Local sentence.', model: 'm1',
    }]);
    const response = (body: unknown) => ({
      ok: true, status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response);
    const remote = {
      user_id: 'user-1', word: 'remote', payload: '遠端詞典', model: 'm2',
      fetched_at: '1970-01-01T00:00:00.010Z',
      updated_at: '1970-01-01T00:00:00.020Z', deleted_at: null,
    };
    const saved = {
      user_id: 'user-1', word: 'local', payload: '本機詞典', model: 'm1',
      fetched_at: new Date((await db.lookupCache.get('local'))!.fetchedAt).toISOString(),
      updated_at: '1970-01-01T00:00:00.030Z', deleted_at: null,
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({
        access_token: 'access', refresh_token: 'refresh', expires_in: 3600,
        user: { id: 'user-1', email: 'me@example.com' },
      }))
      .mockResolvedValueOnce(response('1970-01-01T00:00:01.000Z'))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([remote]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([saved]));

    await signIn('https://project.supabase.co', 'anon', 'me@example.com', 'password');
    expect(await syncNow()).toMatchObject({ pulled: 1, pushed: 1 });
    expect((await getCached(['remote'])).get('remote')).toBe('遠端詞典');
    expect((await db.lookupCache.get('remote'))!.sentence).toBeUndefined();
    expect((await db.lookupCache.get('local'))!.pending).toBe(0);
    expect((await db.lookupCache.get('local'))!.sentence).toBe('Local sentence.');
    expect(fetchMock.mock.calls[6]![1]?.body).toContain('"payload":"本機詞典"');
    expect(fetchMock.mock.calls[6]![1]?.body).not.toContain('"sentence"');
  });

  it('遠端還沒回填時，不會用 null 蓋掉本機的 collectedAt', async () => {
    // 本機剛跑完 v6 回填：collectedAt 有值、pending 1，但 updatedAt 沒動。
    await db.words.put({
      word: 'deploy', status: 'unknown', createdAt: 10, collectedAt: 10,
      updatedAt: 20, deletedAt: null, pending: 1,
    });
    const response = (body: unknown) => ({
      ok: true, status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response);
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({
        access_token: 'access', refresh_token: 'refresh', expires_in: 3600,
        user: { id: 'user-1', email: 'me@example.com' },
      }))
      .mockResolvedValueOnce(response('1970-01-01T00:00:01.000Z'))
      // 舊版寫上去的列：updated_at 跟本機相同，而且沒有 collected_at。
      .mockResolvedValueOnce(response([{
        user_id: 'user-1', word: 'deploy', status: 'unknown',
        created_at: '1970-01-01T00:00:00.010Z',
        updated_at: '1970-01-01T00:00:00.020Z', deleted_at: null,
      }]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([{
        user_id: 'user-1', word: 'deploy', status: 'unknown',
        created_at: '1970-01-01T00:00:00.010Z',
        collected_at: '1970-01-01T00:00:00.010Z',
        updated_at: '1970-01-01T00:00:00.030Z', deleted_at: null,
      }]));

    await signIn('https://project.supabase.co', 'anon', 'me@example.com', 'password');
    await syncNow();

    expect((await db.words.get('deploy'))!.collectedAt).toBe(10);
    expect(fetchMock.mock.calls[6]![1]?.body)
      .toContain('"collected_at":"1970-01-01T00:00:00.010Z"');
  });

  it('切換不同帳號時不會把舊帳號 cache 標成待上傳', async () => {
    const response = (id: string) => ({
      ok: true,
      json: async () => ({
        access_token: 'access', refresh_token: 'refresh', expires_in: 3600,
        user: { id, email: `${id}@example.com` },
      }),
    } as Response);
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response('user-1'))
      .mockResolvedValueOnce(response('user-2'));

    await signIn('https://project.supabase.co', 'anon', 'one@example.com', 'password');
    await putCached([{ word: 'private', payload: '舊帳號內容' }]);
    await db.reviewLog.add({ id: 'log-1', word: 'deploy', remembered: true, at: 10, pending: 0 });
    await signIn('https://project.supabase.co', 'anon', 'two@example.com', 'password');
    expect((await db.lookupCache.get('private'))!.pending).toBe(0);
    // 打老虎成績屬於學習歷程，跟著人走，切換帳號要重新上傳。
    expect((await db.reviewLog.get('log-1'))!.pending).toBe(1);
  });

  it('打老虎成績會拉回別台裝置的紀錄，並用複合主鍵推送本機紀錄', async () => {
    await db.reviewLog.add({
      id: 'local-1', word: 'deploy', remembered: true, at: 30, pending: 1,
    });
    // contexts 跟 review_log 一樣是 uuid 主鍵，換帳號時同樣要靠複合主鍵避開別人的列。
    await db.contexts.put({
      id: 'ctx-1', word: 'deploy', sentence: 'We deploy to production on Fridays.',
      url: 'https://example.com/a', title: 'Guide',
      createdAt: 20, updatedAt: 20, deletedAt: null, pending: 1,
    });
    const response = (body: unknown) => ({
      ok: true, status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response);
    const remote = {
      id: 'remote-1', user_id: 'user-1', word: 'roll back',
      remembered: false, at: '1970-01-01T00:00:00.010Z',
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({
        access_token: 'access', refresh_token: 'refresh', expires_in: 3600,
        user: { id: 'user-1', email: 'me@example.com' },
      }))
      .mockResolvedValueOnce(response('1970-01-01T00:00:01.000Z'))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([remote]))
      .mockResolvedValueOnce(response([{
        id: 'ctx-1', user_id: 'user-1', word: 'deploy',
        sentence: 'We deploy to production on Fridays.',
        url: 'https://example.com/a', title: 'Guide',
        created_at: '1970-01-01T00:00:00.020Z',
        updated_at: '1970-01-01T00:00:00.040Z', deleted_at: null,
      }]))
      .mockResolvedValueOnce(response([{
        id: 'local-1', user_id: 'user-1', word: 'deploy',
        remembered: true, at: '1970-01-01T00:00:00.030Z',
      }]));

    await signIn('https://project.supabase.co', 'anon', 'me@example.com', 'password');
    expect(await syncNow()).toMatchObject({ pulled: 1, pushed: 2 });
    expect(await db.reviewLog.get('remote-1')).toEqual({
      id: 'remote-1', word: 'roll back', remembered: false, at: 10, pending: 0,
    });
    expect((await db.reviewLog.get('local-1'))!.pending).toBe(0);
    expect(fetchMock.mock.calls[7]![1]?.body).toContain('"remembered":true');
    expect(fetchMock.mock.calls[7]![1]?.body).toContain('"id":"local-1"');
    // 主鍵只有 id 時，換帳號重傳會撞到別的帳號的列而被 RLS 擋下。
    expect(fetchMock.mock.calls[6]![0]).toContain('contexts?on_conflict=user_id%2Cid');
    expect(fetchMock.mock.calls[7]![0]).toContain('review_log?on_conflict=user_id%2Cid');
  });
});
