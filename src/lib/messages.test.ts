import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { handleMessage, handleStreamMessage, type ExplainResult } from './messages';
import { db, markWord, sentenceKey } from './db';
import * as ai from './ai';
import * as settings from './settings';
import { DEFAULT_TEMPLATES } from './prompt';

beforeEach(async () => {
  await db.words.clear();
  await db.contexts.clear();
  await db.lookupCache.clear();
  await db.sentenceCache.clear();
  vi.restoreAllMocks();
  vi.spyOn(settings, 'loadSettings').mockResolvedValue({
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'k', model: 'm', profile: '', threshold: 5000, blockedHosts: [],
    highlightColors: settings.DEFAULT_HIGHLIGHT_COLORS, autoOrigins: [],
    highlightTextColors: settings.DEFAULT_HIGHLIGHT_TEXT_COLORS,
    highlightUnderlineColors: settings.DEFAULT_HIGHLIGHT_UNDERLINE_COLORS,
    markConjunctions: true,
    templates: DEFAULT_TEMPLATES,
  });
});

describe('handleMessage', () => {
  it('speak 把 AI 音訊轉成可跨 runtime message 傳送的 MP3 data URL', async () => {
    const spy = vi.spyOn(ai, 'generateSpeech')
      .mockResolvedValue(Uint8Array.from([1, 2, 3]).buffer);

    expect(await handleMessage({ type: 'speak', text: ' We deploy. ' })).toEqual({
      ok: true,
      audio: 'data:audio/mpeg;base64,AQID',
    });
    expect(spy.mock.calls[0]![0]).toBe('We deploy.');
  });

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

  it('toggleMark 可以切換 known，供網頁取消高亮', async () => {
    expect(await handleMessage({
      type: 'toggleMark', word: 'timestamp', status: 'known',
    })).toBe('known');
    expect((await db.words.get('timestamp'))!.status).toBe('known');

    expect(await handleMessage({
      type: 'toggleMark', word: 'timestamp', status: 'known',
    })).toBe(null);
    expect((await db.words.get('timestamp'))!.deletedAt).toBeGreaterThan(0);
  });

  it('lookup 命中快取時不呼叫 AI', async () => {
    const spy = vi.spyOn(ai, 'lookupWord').mockResolvedValue('## 詞性與釋義\n- 部署');

    await handleStreamMessage(
      { type: 'lookup', word: 'deploy', sentence: 'We deploy on Friday.' }, () => {},
    );
    expect(spy).toHaveBeenCalledOnce();
    spy.mockClear();

    // 第一次已寫入快取,第二次應該完全不打 AI
    const got = await handleStreamMessage({
      type: 'lookup', word: 'deploy', sentence: 'We deploy on Friday.',
    }, () => {}) as ExplainResult;
    expect(spy).not.toHaveBeenCalled();
    expect(got.ok && got.text).toContain('部署');
  });

  it('lookup 把出處句子一起送給 AI 做消歧義', async () => {
    const spy = vi.spyOn(ai, 'lookupWord').mockResolvedValue('內容');
    await handleStreamMessage(
      { type: 'lookup', word: 'scale', sentence: 'We scale the deployment.' }, () => {},
    );
    expect(spy.mock.calls[0]![0]).toEqual({ w: 'scale', s: 'We scale the deployment.' });
  });

  it('options 可用非串流 lookup 建立片語詞典快取', async () => {
    vi.spyOn(ai, 'lookupWord').mockResolvedValue('## 使用場景\n- 用來對比替代方案');
    const result = await handleMessage({
      type: 'lookup', word: 'instead of + noun',
      sentence: 'Use a managed service instead of a local database.',
    });

    expect(result).toEqual({ ok: true, text: '## 使用場景\n- 用來對比替代方案' });
    expect(await db.lookupCache.get('instead of + noun')).toMatchObject({
      payload: '## 使用場景\n- 用來對比替代方案', model: 'm',
    });
  });

  it('AI 失敗時回錯誤信封,而且不寫進快取', async () => {
    vi.spyOn(ai, 'lookupWord').mockRejectedValue(new Error('AI 請求失敗 401'));

    const got = await handleStreamMessage({
      type: 'lookup', word: 'staging', sentence: 'x',
    }, () => {}) as ExplainResult;

    expect(got.ok).toBe(false);
    expect(!got.ok && got.error).toContain('401');
    // 一次網路抖動不該被記住,不然之後永遠拿到錯誤結果
    expect(await db.lookupCache.get('staging')).toBeUndefined();
  });

  it('沒設定 AI 時回可讀的錯誤,不是空白卡片', async () => {
    vi.spyOn(settings, 'loadSettings').mockResolvedValue({
      baseUrl: '', apiKey: '', model: '', profile: '',
      threshold: 5000, blockedHosts: [], templates: DEFAULT_TEMPLATES,
      highlightColors: settings.DEFAULT_HIGHLIGHT_COLORS, autoOrigins: [],
      highlightTextColors: settings.DEFAULT_HIGHLIGHT_TEXT_COLORS,
      highlightUnderlineColors: settings.DEFAULT_HIGHLIGHT_UNDERLINE_COLORS,
      markConjunctions: true,
    });
    const spy = vi.spyOn(ai, 'lookupWord');

    const got = await handleStreamMessage({
      type: 'lookup', word: 'deploy', sentence: 'x',
    }, () => {}) as ExplainResult;

    expect(got.ok).toBe(false);
    expect(!got.ok && got.error).toContain('options');
    expect(spy).not.toHaveBeenCalled();
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
    expect(rows[0].createdAt).toBeGreaterThan(0);
    expect(rows[0].contexts).toHaveLength(1);
  });

  it('listWords 不含已軟刪除的字', async () => {
    await markWord('deploy', 'unknown');
    await handleMessage({ type: 'toggleMark', word: 'deploy' });
    expect(await handleMessage({ type: 'listWords' })).toHaveLength(0);
  });

});

describe('單字快取管理', () => {
  it('保留使用模型並可列出與清除', async () => {
    vi.spyOn(ai, 'lookupWord').mockResolvedValue('## 詞性與釋義\n- 部署');
    await handleStreamMessage(
      { type: 'lookup', word: 'deploy', sentence: 'We deploy on Friday.' }, () => {},
    );

    const rows = await handleMessage({ type: 'listCachedWords' }) as any[];
    expect(rows[0]).toMatchObject({
      word: 'deploy', model: 'm', sentence: 'We deploy on Friday.',
    });

    await handleMessage({ type: 'deleteCachedWord', word: 'deploy' });
    expect(await handleMessage({ type: 'getCachedWord', word: 'deploy' })).toBeUndefined();
  });
});

describe('explain', () => {
  const sentence = 'We deploy to production every Friday.';

  it('快取沒命中時呼叫 AI,並把結果寫進快取', async () => {
    const spy = vi.spyOn(ai, 'explainSentence').mockResolvedValue('我們每週五部署。');

    const first = await handleMessage({ type: 'explain', kind: 'translate', sentence });
    expect(first).toEqual({ ok: true, text: '我們每週五部署。' });
    expect(spy).toHaveBeenCalledOnce();

    spy.mockClear();
    const second = await handleMessage({ type: 'explain', kind: 'translate', sentence });
    expect(second).toEqual({ ok: true, text: '我們每週五部署。' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('translate 和 grammar 各自快取', async () => {
    const spy = vi.spyOn(ai, 'explainSentence').mockResolvedValue('結果');
    await handleMessage({ type: 'explain', kind: 'translate', sentence });
    await handleMessage({ type: 'explain', kind: 'grammar', sentence });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('系統教學規則更新後不沿用舊格式拆句快取', async () => {
    const oldVariant = JSON.stringify(['m', '', DEFAULT_TEMPLATES.grammar, '', '', '']);
    await db.sentenceCache.put({
      id: sentenceKey('grammar', sentence, oldVariant), result: '舊格式', fetchedAt: 1,
    });
    const spy = vi.spyOn(ai, 'explainSentence').mockResolvedValue('用法｜正式文件常用');

    expect(await handleMessage({ type: 'explain', kind: 'grammar', sentence }))
      .toEqual({ ok: true, text: '用法｜正式文件常用' });
    expect(spy).toHaveBeenCalledOnce();
  });

  it('把焦點詞、前一句和頁面標題一起送給 AI', async () => {
    const spy = vi.spyOn(ai, 'explainSentence').mockResolvedValue('結果');
    const msg = {
      type: 'explain' as const,
      kind: 'grammar' as const,
      sentence,
      focus: 'production',
      previous: 'The release is ready.',
      title: 'Deployment guide',
    };
    await handleMessage(msg);
    // 只斷言這個測試真正在乎的前兩個引數。後面是 settings 與串流參數,
    // 綁死整串會讓簽章一長就假性失敗。
    expect(spy.mock.calls[0]!.slice(0, 2)).toEqual(['grammar', msg]);
  });

  it('同一句改變焦點詞時重新分析', async () => {
    const spy = vi.spyOn(ai, 'explainSentence').mockResolvedValue('結果');
    await handleMessage({ type: 'explain', kind: 'grammar', sentence, focus: 'deploy' });
    await handleMessage({ type: 'explain', kind: 'grammar', sentence, focus: 'production' });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('沒設定 AI 時回明確的錯誤,不打 API', async () => {
    vi.spyOn(settings, 'loadSettings').mockResolvedValue({
      baseUrl: '', apiKey: '', model: '', profile: '',
      threshold: 5000, blockedHosts: [], templates: DEFAULT_TEMPLATES,
      highlightColors: settings.DEFAULT_HIGHLIGHT_COLORS, autoOrigins: [],
      highlightTextColors: settings.DEFAULT_HIGHLIGHT_TEXT_COLORS,
      highlightUnderlineColors: settings.DEFAULT_HIGHLIGHT_UNDERLINE_COLORS,
      markConjunctions: true,
    });
    const spy = vi.spyOn(ai, 'explainSentence');

    const got = await handleMessage({ type: 'explain', kind: 'translate', sentence });
    expect(got).toEqual({ ok: false, error: '還沒設定 AI,請到 options 頁填 base URL 和 API key' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('AI 丟例外時回 ok false 和錯誤訊息', async () => {
    vi.spyOn(ai, 'explainSentence').mockRejectedValue(new Error('AI 請求失敗 401: bad key'));
    const got = await handleMessage({ type: 'explain', kind: 'translate', sentence });
    expect(got).toEqual({ ok: false, error: 'AI 請求失敗 401: bad key' });
  });

  it('AI 失敗時不寫快取,下次還會重試', async () => {
    const spy = vi.spyOn(ai, 'explainSentence').mockRejectedValue(new Error('壞了'));
    await handleMessage({ type: 'explain', kind: 'translate', sentence });
    await handleMessage({ type: 'explain', kind: 'translate', sentence });
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('詞庫管理', () => {
  it('deleteWord 是軟刪除,列還在但不出現在 listWords', async () => {
    await markWord('deploy', 'unknown');
    await handleMessage({ type: 'deleteWord', word: 'deploy' });

    expect((await db.words.get('deploy'))!.deletedAt).toBeGreaterThan(0);
    expect(await handleMessage({ type: 'listWords' })).toHaveLength(0);
  });

  it('deleteWord 也會讓相關語境不再匯出', async () => {
    await markWord('deploy', 'unknown');
    await handleMessage({
      type: 'saveContext', word: 'deploy',
      sentence: 'We deploy to production every single Friday.',
      url: 'https://example.com', title: 'Example',
    });
    await handleMessage({ type: 'deleteWord', word: 'deploy' });
    const bundle = await handleMessage({ type: 'exportData' }) as any;
    expect(bundle.contexts).toHaveLength(0);
  });

  it('setWordStatus 可以把字改成 known', async () => {
    await markWord('deploy', 'unknown');
    await handleMessage({ type: 'setWordStatus', word: 'deploy', status: 'known' });

    const rows = await handleMessage({ type: 'listWords' }) as any[];
    expect(rows[0].status).toBe('known');
  });

  it('setWordStatus 對沒標記過的字也能用,直接建一列', async () => {
    await handleMessage({ type: 'setWordStatus', word: 'kubernetes', status: 'known' });
    expect((await db.words.get('kubernetes'))!.status).toBe('known');
  });

  it('setWordStatus 會把軟刪除的列救回來', async () => {
    await markWord('deploy', 'unknown');
    await handleMessage({ type: 'deleteWord', word: 'deploy' });
    await handleMessage({ type: 'setWordStatus', word: 'deploy', status: 'known' });

    expect((await db.words.get('deploy'))!.deletedAt).toBe(null);
  });

  it('exportData 帶出未刪除的字與語境', async () => {
    await markWord('deploy', 'unknown');
    await handleMessage({
      type: 'saveContext',
      word: 'deploy',
      sentence: 'We deploy to production every single Friday.',
      url: 'https://example.com', title: 'Example',
    });

    const bundle = await handleMessage({ type: 'exportData' }) as any;
    expect(bundle.words).toHaveLength(1);
    expect(bundle.contexts).toHaveLength(1);
    expect(bundle.exportedAt).toBeGreaterThan(0);
  });

  it('exportData 不帶出已軟刪除的資料', async () => {
    await markWord('deploy', 'unknown');
    await handleMessage({ type: 'deleteWord', word: 'deploy' });

    const bundle = await handleMessage({ type: 'exportData' }) as any;
    expect(bundle.words).toHaveLength(0);
  });
});

describe('今晚打老虎訊息', () => {
  it('列出題目並記錄自評', async () => {
    await markWord('deploy', 'unknown');
    await db.lookupCache.put({
      word: 'deploy', payload: '部署', fetchedAt: 1,
      updatedAt: 1, deletedAt: null, pending: 0,
    });
    expect(await handleMessage({ type: 'listReviewItems' })).toEqual([
      expect.objectContaining({ word: 'deploy', definition: '部署' }),
    ]);
    expect(await handleMessage({
      type: 'reviewWord', word: 'deploy', remembered: true,
    })).toBe(true);
    expect((await db.words.get('deploy'))!.reviewStep).toBe(1);
  });
});
