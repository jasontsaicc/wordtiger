import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db, markWord, unmarkWord, deleteWord, loadMarks, addContext, listContexts, listReviewItems, recordReview, getCached, putCached, deleteCached, sentenceKey, getSentence, putSentence } from './db';

beforeEach(async () => {
  await db.words.clear();
  await db.contexts.clear();
  await db.lookupCache.clear();
  await db.sentenceCache.clear();
});

describe('markWord / loadMarks', () => {
  it('使用 WordTiger 的 IndexedDB 名稱', () => {
    expect(db.name).toBe('wordtiger');
  });

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

  it('片語即使來源句很短也保留', async () => {
    await addContext({ word: 'fail to', sentence: 'It failed to start.', url: 'u', title: 't' });
    expect(await listContexts('fail to')).toHaveLength(1);
  });

  it('同一個字保留所有不同語境', async () => {
    for (let i = 0; i < 7; i++) {
      await addContext({
        word: 'deploy',
        sentence: `We deploy to production on day number ${i} of the week.`,
        url: `https://example.com/${i}`,
        title: 't',
      });
    }
    const rows = await listContexts('deploy');
    expect(rows).toHaveLength(7);
    expect(rows.map((r) => r.url)).toEqual(
      Array.from({ length: 7 }, (_, i) => `https://example.com/${i}`),
    );
  });

  it('同一毫秒內連續寫入仍維持順序', async () => {
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
    expect(new Set(stamps).size).toBe(7);
  });

  it('同一頁的相同句子不重複保存', async () => {
    const input = {
      word: 'deploy',
      sentence: 'We deploy to production every single Friday.',
      url: 'https://example.com/a', title: 'Example',
    };
    await addContext(input);
    await addContext(input);
    expect(await listContexts('deploy')).toHaveLength(1);
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

  it('刪除留下可同步的 tombstone,但不再命中快取', async () => {
    await putCached([{ word: 'deploy', payload: '部署' }]);
    await deleteCached('deploy');
    expect(await getCached(['deploy'])).toEqual(new Map());
    expect((await db.lookupCache.get('deploy'))).toMatchObject({ pending: 1 });
    expect((await db.lookupCache.get('deploy'))!.deletedAt).not.toBe(null);
  });
});

describe('今晚打老虎', () => {
  it('只列出到期且有答案材料的生詞與片語，最多五題', async () => {
    for (let i = 0; i < 6; i++) {
      const word = `word${i}`;
      await markWord(word, 'unknown');
      await putCached([{ word, payload: `definition ${i}` }]);
    }
    await markWord('already-known', 'known');
    await putCached([{ word: 'already-known', payload: '不該出現' }]);
    await markWord('not-ready', 'unknown');
    await putCached([{ word: 'not-ready', payload: '尚未到期' }]);
    await db.words.update('not-ready', { reviewDueAt: Date.now() + 86_400_000 });
    await markWord('roll back', 'unknown');
    await addContext({
      word: 'roll back', sentence: 'We should roll back this release now.',
      url: 'https://example.com', title: 'Release guide',
    });
    await putCached([{ word: 'roll back', payload: '## 核心意思\n- 回滾變更' }]);

    const items = await listReviewItems(5);
    expect(items).toHaveLength(5);
    expect(items.every((item) => item.word !== 'already-known' && item.word !== 'not-ready')).toBe(true);
  });

  it('片語使用來源語境，單字使用既有 AI 詞典', async () => {
    await markWord('deploy', 'unknown');
    await putCached([{ word: 'deploy', payload: '## 動詞\n- 部署' }]);
    await markWord('roll back', 'unknown');
    await addContext({
      word: 'roll back', sentence: 'We should roll back this release now.',
      url: 'https://example.com', title: 'Release guide',
    });
    await putCached([{ word: 'roll back', payload: '## 核心意思\n- 回滾變更' }]);

    expect(await listReviewItems()).toEqual([
      expect.objectContaining({ word: 'deploy', isPhrase: false, isPattern: false, definition: expect.stringContaining('部署') }),
      expect.objectContaining({ word: 'roll back', isPhrase: true, isPattern: false, definition: expect.stringContaining('回滾'), context: expect.objectContaining({ title: 'Release guide' }) }),
    ]);
  });

  it('泛化句型不在來源句中時改成造句題', async () => {
    await markWord('keep A pending until B becomes available', 'unknown');
    await addContext({
      word: 'keep A pending until B becomes available',
      sentence: 'Keep the request pending until capacity becomes available.',
      url: 'https://example.com', title: 'Release guide',
    });
    await putCached([{
      word: 'keep A pending until B becomes available',
      payload: '## 使用場景\n- 等待依賴就緒',
    }]);
    expect(await listReviewItems()).toEqual([
      expect.objectContaining({
        word: 'keep A pending until B becomes available', isPhrase: true, isPattern: true,
      }),
    ]);
  });

  it('沒有 AI 詞典的片語不出題', async () => {
    await markWord('roll back', 'unknown');
    await addContext({
      word: 'roll back', sentence: 'We should roll back this release now.',
      url: 'https://example.com', title: 'Release guide',
    });
    expect(await listReviewItems()).toEqual([]);
  });

  it('無答案的舊收藏不會擋住後面的有效題目', async () => {
    for (let i = 0; i < 26; i++) await markWord(`orphan${i}`, 'unknown');
    await markWord('valid', 'unknown');
    await putCached([{ word: 'valid', payload: 'answer' }]);
    expect(await listReviewItems()).toEqual([
      expect.objectContaining({ word: 'valid' }),
    ]);
  });

  it('單字題使用產生答案時的句子，不混用最新語境', async () => {
    const answerSentence = 'The certificate authority will issue a new certificate tomorrow.';
    await markWord('issue', 'unknown');
    await putCached([{ word: 'issue', payload: '核發', sentence: answerSentence }]);
    await addContext({
      word: 'issue', sentence: answerSentence,
      url: 'https://example.com/cert', title: 'Certificate guide',
    });
    await addContext({
      word: 'issue', sentence: 'A production issue interrupted the deployment this morning.',
      url: 'https://example.com/incident', title: 'Incident',
    });

    expect(await listReviewItems()).toEqual([
      expect.objectContaining({
        word: 'issue', definition: '核發',
        context: expect.objectContaining({ sentence: answerSentence, title: 'Certificate guide' }),
      }),
    ]);
  });

  it('自評後更新排程並留下待同步標記', async () => {
    await db.words.put({
      word: 'deploy', status: 'unknown', createdAt: 1, updatedAt: 1,
      deletedAt: null, reviewStep: 1, pending: 0,
    });
    expect(await recordReview('deploy', true, 100)).toBe(true);
    expect(await db.words.get('deploy')).toMatchObject({
      reviewStep: 2,
      reviewDueAt: 100 + 3 * 86_400_000,
      updatedAt: 100,
      pending: 1,
    });
  });

  it('已認得或不存在的字不接受複習結果', async () => {
    await markWord('deploy', 'known');
    expect(await recordReview('deploy', true)).toBe(false);
    expect(await recordReview('missing', true)).toBe(false);
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

  it('同一句不同焦點或 prompt 版本互不覆蓋', async () => {
    await putSentence('grammar', sentence, 'focus deploy', 'deploy');
    await putSentence('grammar', sentence, 'focus production', 'production');
    expect(await getSentence('grammar', sentence, 'deploy')).toBe('focus deploy');
    expect(await getSentence('grammar', sentence, 'production')).toBe('focus production');
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
