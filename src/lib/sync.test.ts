import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import 'fake-indexeddb/auto';
import { db } from './db';
import { acknowledgeRow, signIn, syncNow, resolveRow } from './sync';

beforeEach(async () => {
  fakeBrowser.reset();
  await db.words.clear();
  await db.contexts.clear();
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
      { word: 'local', status: 'unknown', createdAt: 30, updatedAt: 30, deletedAt: null, pending: 1 },
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
      .mockResolvedValueOnce(response([{
        user_id: 'user-1', word: 'local', status: 'unknown',
        created_at: '1970-01-01T00:00:00.030Z',
        updated_at: '1970-01-01T00:00:00.040Z', deleted_at: null,
      }]));

    await signIn('https://project.supabase.co', 'anon', 'me@example.com', 'password');
    const result = await syncNow();

    expect(result).toMatchObject({ pulled: 1, pushed: 1 });
    expect((await db.words.get('old'))!.deletedAt).toBe(20);
    expect((await db.words.get('local'))!.pending).toBe(0);
    expect(fetchMock.mock.calls[4]![1]?.body).toContain('"word":"local"');
  });
});
