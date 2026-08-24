import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { handleMessage } from './messages';
import { db, markWord } from './db';
import * as ai from './ai';
import * as settings from './settings';

beforeEach(async () => {
  await db.words.clear();
  await db.contexts.clear();
  await db.lookupCache.clear();
  vi.restoreAllMocks();
  vi.spyOn(settings, 'loadSettings').mockResolvedValue({
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'k', model: 'm', profile: '', threshold: 5000, blockedHosts: [],
  });
});

describe('handleMessage', () => {
  it('getMarks 回傳標記,格式是可序列化的陣列', async () => {
    await markWord('deploy', 'unknown');
    const got = await handleMessage({ type: 'getMarks' });
    expect(got).toEqual([['deploy', 'unknown']]);
  });

  it('toggleMark 在未標記時標成 unknown', async () => {
    const got = await handleMessage({ type: 'toggleMark', word: 'deploy' });
    expect(got).toBe('unknown');
    expect((await db.words.get('deploy'))!.status).toBe('unknown');
  });

  it('toggleMark 在已是 unknown 時取消標記', async () => {
    await markWord('deploy', 'unknown');
    const got = await handleMessage({ type: 'toggleMark', word: 'deploy' });
    expect(got).toBe(null);
    expect((await db.words.get('deploy'))!.deletedAt).toBeGreaterThan(0);
  });

  it('lookup 命中快取時不呼叫 AI', async () => {
    const items = [{ w: 'deploy', s: 'We deploy every Friday to production.' }];
    const spy = vi
      .spyOn(ai, 'lookupBatch')
      .mockResolvedValue(new Map([['deploy', '部署']]));

    await handleMessage({ type: 'lookup', items });
    expect(spy).toHaveBeenCalledOnce();
    spy.mockClear();

    // 第一次已寫入快取,第二次應該完全不打 AI
    const got = (await handleMessage({ type: 'lookup', items })) as Array<[string, string]>;
    expect(spy).not.toHaveBeenCalled();
    expect(new Map(got).get('deploy')).toBe('部署');
  });

  it('lookup 只把未快取的字送給 AI', async () => {
    const spy = vi.spyOn(ai, 'lookupBatch').mockResolvedValue(
      new Map([['staging', '預備環境']]),
    );
    await db.lookupCache.put({ word: 'deploy', payload: '部署', fetchedAt: Date.now() });

    const got = await handleMessage({
      type: 'lookup',
      items: [
        { w: 'deploy', s: 'x' },
        { w: 'staging', s: 'y' },
      ],
    }) as Array<[string, string]>;

    expect(spy.mock.calls[0]![0]).toEqual([{ w: 'staging', s: 'y' }]);
    expect(new Map(got).get('deploy')).toBe('部署');
    expect(new Map(got).get('staging')).toBe('預備環境');
  });

  it('AI 失敗時仍回傳快取命中的部分,不整批失敗', async () => {
    vi.spyOn(ai, 'lookupBatch').mockRejectedValue(new Error('AI 請求失敗 401'));
    await db.lookupCache.put({ word: 'deploy', payload: '部署', fetchedAt: Date.now() });

    const got = await handleMessage({
      type: 'lookup',
      items: [{ w: 'deploy', s: 'x' }, { w: 'staging', s: 'y' }],
    }) as Array<[string, string]>;

    expect(new Map(got).get('deploy')).toBe('部署');
    expect(new Map(got).has('staging')).toBe(false);
  });

  it('saveContext 寫入語境', async () => {
    await handleMessage({
      type: 'saveContext',
      word: 'deploy',
      sentence: 'We deploy to production every single Friday.',
      url: 'https://example.com',
      title: 'Example',
    });
    expect(await db.contexts.count()).toBe(1);
  });
});

describe('詞庫列表', () => {
  it('listWords 回傳未刪除的字,附語境數量', async () => {
    await markWord('deploy', 'unknown');
    await handleMessage({
      type: 'saveContext',
      word: 'deploy',
      sentence: 'We deploy to production every single Friday.',
      url: 'https://example.com', title: 'Example',
    });

    const rows = await handleMessage({ type: 'listWords' }) as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].word).toBe('deploy');
    expect(rows[0].contextCount).toBe(1);
  });

  it('listWords 不含已軟刪除的字', async () => {
    await markWord('deploy', 'unknown');
    await handleMessage({ type: 'toggleMark', word: 'deploy' });
    expect(await handleMessage({ type: 'listWords' })).toHaveLength(0);
  });

  it('getContexts 回傳指定字的語境', async () => {
    await handleMessage({
      type: 'saveContext',
      word: 'deploy',
      sentence: 'We deploy to production every single Friday.',
      url: 'https://example.com', title: 'Example',
    });
    const rows = await handleMessage({ type: 'getContexts', word: 'deploy' }) as any[];
    expect(rows[0].url).toBe('https://example.com');
  });
});
