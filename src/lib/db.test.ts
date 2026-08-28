import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { State } from 'ts-fsrs';
import type { StoredFsrsCard } from './review';
import { db, markWord, unmarkWord, deleteWord, loadMarks, addContext, listContexts, listReviewItems, listReviewLog, inferCollectedAt, masterWord, recordReview, putCached, deleteCached, sentenceKey, getSentence, putSentence, type WordRow } from './db';

beforeEach(async () => {
  await db.words.clear();
  await db.contexts.clear();
  await db.lookupCache.clear();
  await db.sentenceCache.clear();
  await db.reviewLog.clear();
  vi.restoreAllMocks();
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

describe('collectedAt', () => {
  it('收藏時記下收藏日，按 X 排除不算收藏', async () => {
    await markWord('deploy', 'unknown');
    expect((await db.words.get('deploy'))!.collectedAt).toBeTypeOf('number');

    await markWord('the', 'known');
    expect((await db.words.get('the'))!.collectedAt).toBeNull();
  });

  it('標成已馴服時保留原本的收藏日', async () => {
    await markWord('deploy', 'unknown');
    const collected = (await db.words.get('deploy'))!.collectedAt;
    await markWord('deploy', 'known');
    expect((await db.words.get('deploy'))!.collectedAt).toBe(collected);
  });

  it('先按 X 再收藏時，收藏日是收藏那天，不是按 X 那天', async () => {
    await db.words.put({
      word: 'deploy', status: 'known', createdAt: 1_000, collectedAt: null,
      updatedAt: 1_000, deletedAt: null, pending: 0,
    });
    await markWord('deploy', 'unknown');

    const row = (await db.words.get('deploy'))!;
    expect(row.createdAt).toBe(1_000);
    expect(row.collectedAt).toBeGreaterThan(1_000);
  });

  it('回填舊資料：生詞、有語境或練習過都算收藏過', () => {
    const excluded = { status: 'known' as const, createdAt: 10 };
    expect(inferCollectedAt({ status: 'unknown', createdAt: 10 }, false, false)).toBe(10);
    expect(inferCollectedAt(excluded, true, false)).toBe(10);
    expect(inferCollectedAt(excluded, false, true)).toBe(10);
    expect(inferCollectedAt(excluded, false, false)).toBeNull();
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
  it('刪除留下可同步的 tombstone,但不再命中快取', async () => {
    await putCached([{ word: 'deploy', payload: '部署' }]);
    await deleteCached('deploy');
    expect((await db.lookupCache.get('deploy'))).toMatchObject({ pending: 1 });
    expect((await db.lookupCache.get('deploy'))!.deletedAt).not.toBe(null);
  });
});

describe('今晚打老虎', () => {
  /** 只有 due 與傳入的欄位重要，其餘是能通過驗證的合理值。 */
  const card = (due: number, extra: Partial<StoredFsrsCard> = {}): StoredFsrsCard => ({
    due,
    stability: 2,
    difficulty: 5,
    elapsed_days: 1,
    scheduled_days: 3,
    learning_steps: 0,
    reps: 1,
    lapses: 0,
    state: State.Review,
    last_review: due - 86_400_000,
    ...extra,
  });
  const seed = (word: string, row: Partial<WordRow> = {}): WordRow => ({
    word, status: 'unknown', createdAt: 1, collectedAt: 1, updatedAt: 1, deletedAt: null, ...row,
  });

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
    await db.words.update('not-ready', { fsrsCard: card(Date.now() + 86_400_000) });
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

  it('先出到期卡並依 due 由早到晚，再用尚未打過的新卡依收藏日補足', async () => {
    const now = new Date(2026, 7, 28, 21, 0).getTime();
    const DAY = 86_400_000;
    await db.words.bulkPut([
      seed('due-late', { fsrsCard: card(now - DAY) }),
      seed('due-early', { fsrsCard: card(now - 3 * DAY) }),
      seed('future', { fsrsCard: card(now + DAY) }),
      // createdAt 較晚但收藏得早，收藏日要贏過建立日。
      seed('new-recent', { createdAt: 4, collectedAt: 900 }),
      seed('new-old', { createdAt: 5, collectedAt: 100 }),
      seed('tamed', { status: 'known' }),
    ]);
    for (const word of ['due-late', 'due-early', 'future', 'new-recent', 'new-old', 'tamed']) {
      await putCached([{ word, payload: `${word} 的答案` }]);
    }

    expect((await listReviewItems(5, now)).map((item) => item.word))
      .toEqual(['due-early', 'due-late', 'new-old', 'new-recent']);
  });

  it('到期卡缺詞典時不佔名額，新卡照樣補上來', async () => {
    const now = 1_000_000;
    await db.words.bulkPut([
      seed('no-answer', { fsrsCard: card(now - 86_400_000) }),
      seed('fresh', { createdAt: 2, collectedAt: 2 }),
    ]);
    await putCached([{ word: 'fresh', payload: '答案' }]);

    expect((await listReviewItems(1, now)).map((item) => item.word)).toEqual(['fresh']);
  });

  it('卡片損壞的字仍會出題，作答時才給可重試錯誤，不會靜靜消失', async () => {
    const now = 1_000_000;
    await db.words.bulkPut([
      seed('due', { collectedAt: 300, fsrsCard: card(now - 86_400_000) }),
      seed('broken', { collectedAt: 100, fsrsCard: { ...card(now), due: Number.NaN } }),
      seed('fresh', { collectedAt: 200 }),
    ]);
    for (const word of ['due', 'broken', 'fresh']) await putCached([{ word, payload: '答案' }]);

    // 損壞卡片沒有可信的 due，跟新卡一起依收藏日排，順序才穩定。
    expect((await listReviewItems(5, now)).map((item) => item.word))
      .toEqual(['due', 'broken', 'fresh']);
    expect(await recordReview('broken', true, now)).toBeNull();
  });

  it('間隔排到 30 天以上才顯示已經馴服', async () => {
    const now = 1_000_000;
    await db.words.bulkPut([
      seed('young', { fsrsCard: card(now, { scheduled_days: 14 }) }),
      seed('stable', { createdAt: 2, fsrsCard: card(now, { scheduled_days: 30 }) }),
    ]);
    for (const word of ['young', 'stable']) await putCached([{ word, payload: '答案' }]);

    expect((await listReviewItems(5, now)).map((item) => [item.word, item.canMaster]))
      .toEqual([['young', false], ['stable', true]]);
  });

  it('停在舊固定階梯第 5 階的卡片，改用 FSRS 後仍保留已經馴服', async () => {
    await db.words.put(seed('legacy', { reviewStep: 5 }));
    await putCached([{ word: 'legacy', payload: '答案' }]);

    expect((await listReviewItems())[0]).toMatchObject({ word: 'legacy', canMaster: true });
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
    await putCached([{
      word: 'issue', surface: 'issued', payload: '核發', sentence: answerSentence,
    }]);
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
        word: 'issue', surface: 'issued', definition: '核發',
        context: expect.objectContaining({ sentence: answerSentence, title: 'Certificate guide' }),
      }),
    ]);
  });

  it('自評後寫入 FSRS 卡片、回傳下次日期並留下待同步標記', async () => {
    await db.words.put(seed('deploy', { pending: 0 }));
    const at = new Date(2026, 7, 28, 22, 40).getTime();

    const nextReviewAt = await recordReview('deploy', true, at);

    expect(nextReviewAt).toBeGreaterThan(at);
    expect(await db.words.get('deploy')).toMatchObject({
      fsrsCard: expect.objectContaining({ due: nextReviewAt, reps: 1, last_review: at }),
      updatedAt: at,
      pending: 1,
    });
  });

  it('不再寫入舊的固定階梯欄位，也不拿它排程', async () => {
    await db.words.put(seed('deploy', { reviewStep: 3, reviewDueAt: 50, pending: 0 }));

    await recordReview('deploy', true, 100);

    expect(await db.words.get('deploy')).toMatchObject({ reviewStep: 3, reviewDueAt: 50 });
  });

  it('卡片損壞時拒絕寫入並保留原資料，不偷偷重設', async () => {
    const broken = { ...card(50), stability: Number.NaN };
    await db.words.put(seed('deploy', { fsrsCard: broken, pending: 0 }));

    expect(await recordReview('deploy', true, 100)).toBeNull();

    expect(await db.words.get('deploy')).toMatchObject({ updatedAt: 1, pending: 0 });
    expect(await listReviewLog()).toEqual([]);
  });

  it('已認得或不存在的字不接受複習結果', async () => {
    await markWord('deploy', 'known');
    expect(await recordReview('deploy', true)).toBeNull();
    expect(await recordReview('missing', true)).toBeNull();
  });

  it('只有成功的自評會留下打老虎紀錄', async () => {
    await markWord('deploy', 'unknown');
    await recordReview('deploy', true, 100);
    await recordReview('deploy', false, 200);
    await recordReview('missing', true, 300);

    expect(await listReviewLog()).toMatchObject([
      { word: 'deploy', remembered: true, at: 100, pending: 1 },
      { word: 'deploy', remembered: false, at: 200, pending: 1 },
    ]);
  });

  it('紀錄寫入失敗時排程一起回滾，不會只前進間隔', async () => {
    await db.words.put(seed('deploy', { pending: 0 }));
    // 固定 uuid 讓第二次的 reviewLog.add 撞主鍵失敗。
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValue('11111111-1111-1111-1111-111111111111');

    expect(await recordReview('deploy', true, 100)).not.toBeNull();
    const afterFirst = await db.words.get('deploy');

    await expect(recordReview('deploy', true, 200)).rejects.toThrow();
    expect(await db.words.get('deploy')).toEqual(afterFirst);
    expect(await listReviewLog()).toHaveLength(1);
  });

  it('已經馴服會同時留下成功紀錄並改成 known', async () => {
    await markWord('deploy', 'unknown');
    expect(await masterWord('deploy', 300)).toBe(true);
    expect(await db.words.get('deploy')).toMatchObject({
      status: 'known', updatedAt: 300, pending: 1,
    });
    expect(await listReviewLog()).toMatchObject([
      { word: 'deploy', remembered: true, at: 300, pending: 1 },
    ]);
  });

  it('不是生詞的字不能馴服，也不會留下紀錄', async () => {
    await markWord('deploy', 'known');
    expect(await masterWord('deploy')).toBe(false);
    expect(await masterWord('missing')).toBe(false);
    expect(await listReviewLog()).toEqual([]);
  });

  it('每筆成績用 uuid 當主鍵，跨裝置才不會撞號', async () => {
    await markWord('deploy', 'unknown');
    await recordReview('deploy', true, 100);
    await recordReview('deploy', true, 200);

    const ids = (await listReviewLog()).map((row) => row.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f-]{36}$/);
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
    // Cache key 必須保留原句以利追查。
    await putSentence('translate', sentence, '譯文');
    expect(await getSentence('translate', ` ${sentence}`)).toBe(null);
  });
});
