import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import 'fake-indexeddb/auto';
import { db, getCached, putCached } from './db';
import { acknowledgeRow, signIn, syncNow, resolveRow } from './sync';

beforeEach(async () => {
  fakeBrowser.reset();
  await db.words.clear();
  await db.contexts.clear();
  await db.lookupCache.clear();
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

describe('syncNow', () => {
  it('登入後拉回 tombstone 並只推送本機待同步列', async () => {
    await db.words.bulkPut([
      { word: 'old', status: 'unknown', createdAt: 10, updatedAt: 10, deletedAt: null, pending: 1 },
      {
        word: 'local', status: 'unknown', createdAt: 30, updatedAt: 30,
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
      .mockResolvedValueOnce(response([{
        user_id: 'user-1', word: 'local', status: 'unknown',
        created_at: '1970-01-01T00:00:00.030Z',
        updated_at: '1970-01-01T00:00:00.040Z', deleted_at: null,
        review_step: 2, review_due_at: '1970-01-01T00:00:00.050Z',
      }]));

    await signIn('https://project.supabase.co', 'anon', 'me@example.com', 'password');
    const result = await syncNow();

    expect(result).toMatchObject({ pulled: 1, pushed: 1 });
    expect((await db.words.get('old'))!.deletedAt).toBe(20);
    expect((await db.words.get('local'))!.pending).toBe(0);
    expect(fetchMock.mock.calls[5]![1]?.body).toContain('"word":"local"');
    expect(fetchMock.mock.calls[5]![1]?.body).toContain('"review_step":2');
  });

  it('同一帳號會拉回別台裝置的詞典 cache 並推送本機 cache', async () => {
    await putCached([{ word: 'local', payload: '本機詞典', model: 'm1' }]);
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
      .mockResolvedValueOnce(response([saved]));

    await signIn('https://project.supabase.co', 'anon', 'me@example.com', 'password');
    expect(await syncNow()).toMatchObject({ pulled: 1, pushed: 1 });
    expect((await getCached(['remote'])).get('remote')).toBe('遠端詞典');
    expect((await db.lookupCache.get('local'))!.pending).toBe(0);
    expect(fetchMock.mock.calls[5]![1]?.body).toContain('"payload":"本機詞典"');
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
    await signIn('https://project.supabase.co', 'anon', 'two@example.com', 'password');
    expect((await db.lookupCache.get('private'))!.pending).toBe(0);
  });
});
