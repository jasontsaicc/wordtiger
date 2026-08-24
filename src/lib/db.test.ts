import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db, markWord, unmarkWord, deleteWord, loadMarks, addContext, listContexts, getCached, putCached, sentenceKey, getSentence, putSentence } from './db';

beforeEach(async () => {
  await db.words.clear();
  await db.contexts.clear();
  await db.lookupCache.clear();
  await db.sentenceCache.clear();
});

describe('markWord / loadMarks', () => {
  it('標記後可以讀回來', async () => {
    await markWord('perplexing', 'unknown');
    const marks = await loadMarks();
    expect(marks.get('perplexing')).toBe('unknown');
  });

  it('重複標記會覆蓋 status 並更新 updatedAt', async () => {
    await markWord('deploy', 'unknown');
    const first = (await db.words.get('deploy'))!.updatedAt;
    await new Promise((r) => setTimeout(r, 2));
    await markWord('deploy', 'known');
    const row = (await db.words.get('deploy'))!;
    expect(row.status).toBe('known');
    expect(row.updatedAt).toBeGreaterThan(first);
  });

  it('取消標記是軟刪除,列還在但 deletedAt 有值', async () => {
    await markWord('deploy', 'unknown');
    await unmarkWord('deploy');
    const row = await db.words.get('deploy');
    expect(row).toBeDefined();
    expect(row!.deletedAt).toBeGreaterThan(0);
  });

  it('loadMarks 不回傳已軟刪除的列', async () => {
    await markWord('deploy', 'unknown');
    await unmarkWord('deploy');
    const marks = await loadMarks();
    expect(marks.has('deploy')).toBe(false);
  });
});

describe('addContext / listContexts', () => {
  it('存下語境並讀回', async () => {
    await addContext({
      word: 'deploy',
      sentence: 'We deploy to production every Friday.',
      url: 'https://example.com/a',
      title: 'Example',
    });
    const rows = await listContexts('deploy');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sentence).toContain('production');
  });

  it('句子短於 26 字元不存', async () => {
    await addContext({ word: 'deploy', sentence: 'Deploy it.', url: 'u', title: 't' });
    expect(await listContexts('deploy')).toHaveLength(0);
  });

  it('同一個字最多留 5 條,超過汰換最舊的', async () => {
    for (let i = 0; i < 7; i++) {
      await addContext({
        word: 'deploy',
        sentence: `We deploy to production on day number ${i} of the week.`,
        url: `https://example.com/${i}`,
        title: 't',
      });
    }
    const rows = await listContexts('deploy');
    expect(rows).toHaveLength(5);
    expect(rows.some((r) => r.url === 'https://example.com/0')).toBe(false);
    expect(rows.some((r) => r.url === 'https://example.com/6')).toBe(true);
  });

  it('同一毫秒內連續寫入仍照順序汰換', async () => {
    const stamps: number[] = [];
    for (let i = 0; i < 7; i++) {
      await addContext({
        word: 'staging',
        sentence: `Push this build to staging before the release ${i}.`,
        url: `https://example.com/${i}`,
        title: 't',
      });
    }
    const rows = await listContexts('staging');
    rows.forEach((r) => stamps.push(r.createdAt));
    expect(stamps).toEqual([...stamps].sort((a, b) => a - b));
    expect(new Set(stamps).size).toBe(5);
    expect(rows.map((r) => r.url)).toEqual([2, 3, 4, 5, 6].map((i) => `https://example.com/${i}`));
  });

  it('listContexts 不回傳已軟刪除的列', async () => {
    await addContext({
      word: 'deploy',
      sentence: 'We deploy to production every single Friday.',
      url: 'u', title: 't',
    });
    const row = (await listContexts('deploy'))[0]!;
    await db.contexts.update(row.id, { deletedAt: Date.now() });
    expect(await listContexts('deploy')).toHaveLength(0);
  });

  it('從詞庫刪除單字時一併軟刪它的語境', async () => {
    await markWord('deploy', 'unknown');
    await addContext({
      word: 'deploy',
      sentence: 'We deploy to production every single Friday.',
      url: 'u', title: 't',
    });
    await deleteWord('deploy');
    expect(await listContexts('deploy')).toHaveLength(0);
    expect((await db.contexts.toArray())[0]!.deletedAt).toBeGreaterThan(0);
  });
});

describe('lookupCache', () => {
  it('只回傳已快取的字', async () => {
    await putCached([{ word: 'deploy', payload: '部署' }]);
    const got = await getCached(['deploy', 'staging']);
    expect(got.get('deploy')).toBe('部署');
    expect(got.has('staging')).toBe(false);
  });
});

describe('sentenceCache', () => {
  const sentence = 'We deploy to production every Friday.';

  it('存下的結果讀得回來', async () => {
    await putSentence('translate', sentence, '我們每週五部署到正式環境。');
    expect(await getSentence('translate', sentence)).toBe('我們每週五部署到正式環境。');
  });

  it('沒存過的句子回 null', async () => {
    expect(await getSentence('translate', sentence)).toBe(null);
  });

  it('同一句在 translate 和 grammar 之下是兩筆,互不覆蓋', async () => {
    await putSentence('translate', sentence, '譯文');
    await putSentence('grammar', sentence, '文法');
    expect(await getSentence('translate', sentence)).toBe('譯文');
    expect(await getSentence('grammar', sentence)).toBe('文法');
  });

  it('重複存同一句會覆蓋,並更新 fetchedAt', async () => {
    await putSentence('translate', sentence, '舊譯文');
    const first = (await db.sentenceCache.get(sentenceKey('translate', sentence)))!.fetchedAt;
    await new Promise((r) => setTimeout(r, 2));
    await putSentence('translate', sentence, '新譯文');
    const row = (await db.sentenceCache.get(sentenceKey('translate', sentence)))!;
    expect(row.result).toBe('新譯文');
    expect(row.fetchedAt).toBeGreaterThanOrEqual(first);
  });

  it('空白差異視為不同句,不做正規化', async () => {
    // 這是刻意的。正規化會讓 key 跟原句對不起來,除錯時很難追
    await putSentence('translate', sentence, '譯文');
    expect(await getSentence('translate', ` ${sentence}`)).toBe(null);
  });
});
