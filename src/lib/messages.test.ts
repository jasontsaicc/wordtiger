import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { handleMessage, handleStreamMessage, type ExplainResult, type SpeechResult } from './messages';
import { db, markWord, sentenceKey } from './db';
import * as ai from './ai';
import * as settings from './settings';
import { DEFAULT_TEMPLATES } from './prompt';

beforeEach(async () => {
  await db.words.clear();
  await db.contexts.clear();
  await db.lookupCache.clear();
  await db.sentenceCache.clear();
  await db.reviewLog.clear();
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

  it('新的 speak request 會取消尚未完成的前一筆', async () => {
    let firstSignal: AbortSignal | undefined;
    vi.spyOn(ai, 'generateSpeech')
      .mockImplementationOnce((_text, _settings, signal) => new Promise((_resolve, reject) => {
        firstSignal = signal;
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      }))
      .mockResolvedValueOnce(Uint8Array.from([4, 5, 6]).buffer);

    const first = handleMessage({ type: 'speak', text: 'first' });
    await vi.waitFor(() => expect(firstSignal).toBeDefined());
    const second = await handleMessage({ type: 'speak', text: 'second' }) as SpeechResult;

    expect(firstSignal?.aborted).toBe(true);
    expect(second.ok).toBe(true);
    expect(((await first) as SpeechResult).ok).toBe(false);
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

    const got = await handleStreamMessage({
      type: 'lookup', word: 'deploy', sentence: 'We deploy on Friday.',
    }, () => {}) as ExplainResult;
    expect(spy).not.toHaveBeenCalled();
    expect(got.ok && got.text).toContain('部署');
  });

  it('同步下來沒有查詢條件的列仍要命中快取', async () => {
    const spy = vi.spyOn(ai, 'lookupWord').mockResolvedValue('不該被呼叫');
    const now = Date.now();
    await db.lookupCache.put({
      word: 'deploy', payload: '部署到正式環境',
      fetchedAt: now, updatedAt: now, deletedAt: null, pending: 0,
    });

    const got = await handleStreamMessage({
      type: 'lookup', word: 'deploy', surface: 'deploying',
      sentence: 'We deploy on Friday.',
    }, () => {}) as ExplainResult;

    expect(spy).not.toHaveBeenCalled();
    expect(got).toEqual({ ok: true, text: '部署到正式環境' });
  });

  it('已軟刪除的相符列不能命中 lookup 快取', async () => {
    const spy = vi.spyOn(ai, 'lookupWord')
      .mockResolvedValueOnce('舊回答')
      .mockResolvedValueOnce('新回答');
    const msg = { type: 'lookup' as const, word: 'deploy', sentence: 'We deploy on Friday.' };

    await handleStreamMessage(msg, () => {});
    await db.lookupCache.update('deploy', { deletedAt: Date.now() });
    const got = await handleStreamMessage(msg, () => {}) as ExplainResult;

    expect(spy).toHaveBeenCalledTimes(2);
    expect(got).toEqual({ ok: true, text: '新回答' });
  });

  it('同一原形換句子時重新查詢', async () => {
    const spy = vi.spyOn(ai, 'lookupWord')
      .mockResolvedValueOnce('對照比較')
      .mockResolvedValueOnce('對 branch 發出 call');

    await handleStreamMessage({
      type: 'lookup', word: 'against', surface: 'against',
      sentence: 'Compare the value against the baseline.',
    }, () => {});
    const got = await handleStreamMessage({
      type: 'lookup', word: 'against', surface: 'against',
      sentence: 'Open a pull request against the branch.',
    }, () => {}) as ExplainResult;

    expect(spy).toHaveBeenCalledTimes(2);
    expect(got).toEqual({ ok: true, text: '對 branch 發出 call' });
  });

  it('同一句的實際字形不同時重新查詢', async () => {
    const spy = vi.spyOn(ai, 'lookupWord').mockResolvedValue('內容');
    const sentence = 'After being slammed, alerts kept slamming the team.';

    await handleStreamMessage({
      type: 'lookup', word: 'slam', surface: 'slammed', sentence,
    }, () => {});
    await handleStreamMessage({
      type: 'lookup', word: 'slam', surface: 'slamming', sentence,
    }, () => {});

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('未提供 surface 時不借用同一句快取的舊字形', async () => {
    const spy = vi.spyOn(ai, 'lookupWord')
      .mockResolvedValueOnce('忙翻')
      .mockResolvedValueOnce('猛撞');
    const sentence = 'We got slammed with alerts.';
    await handleStreamMessage({
      type: 'lookup', word: 'slam', surface: 'slammed', sentence,
    }, () => {});

    const got = await handleStreamMessage({
      type: 'lookup', word: 'slam', sentence,
    }, () => {}) as ExplainResult;

    expect(spy).toHaveBeenCalledTimes(2);
    expect(got).toEqual({ ok: true, text: '猛撞' });
  });

  it.each([
    ['model', { model: 'm2' }],
    ['profile', { profile: '我是 SRE' }],
    ['lookup template', {
      templates: { ...DEFAULT_TEMPLATES, lookup: '解釋 {{surface}} / {{word}}' },
    }],
  ])('%s 改變時重新查詢', async (_label, patch) => {
    const base = await settings.loadSettings();
    const spy = vi.spyOn(ai, 'lookupWord').mockResolvedValue('內容');
    const msg = {
      type: 'lookup' as const, word: 'slam', surface: 'slammed',
      sentence: 'We got slammed with alerts.',
    };

    await handleStreamMessage(msg, () => {});
    vi.mocked(settings.loadSettings).mockResolvedValue({ ...base, ...patch });
    await handleStreamMessage(msg, () => {});

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('lookup 把出處句子一起送給 AI 做消歧義', async () => {
    const spy = vi.spyOn(ai, 'lookupWord').mockResolvedValue('內容');
    await handleStreamMessage(
      {
        type: 'lookup', word: 'slam', surface: 'slammed',
        sentence: 'We got slammed with alerts.',
      }, () => {},
    );
    expect(spy.mock.calls[0]![0]).toEqual({
      w: 'slam', surface: 'slammed', s: 'We got slammed with alerts.',
    });
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
    // 暫時性錯誤不得寫入快取。
    expect(await db.lookupCache.get('staging')).toBeUndefined();
  });

  it('未設定 AI 時回傳可讀錯誤', async () => {
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
    expect(!got.ok && got.error).toContain('設定頁');
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

  it('列出時不送出 options 頁用不到的 variant', async () => {
    vi.spyOn(ai, 'lookupWord').mockResolvedValue('## 詞性與釋義\n- 部署');
    await handleStreamMessage(
      { type: 'lookup', word: 'deploy', sentence: 'We deploy on Friday.' }, () => {},
    );

    const rows = await handleMessage({ type: 'listCachedWords' }) as any[];
    expect((await db.lookupCache.get('deploy'))!.variant).toBeTypeOf('string');
    expect(rows[0]).not.toHaveProperty('variant');
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
    // 僅驗證此案例相關的前兩個參數。
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
    expect(got).toEqual({ ok: false, error: '尚未設定 AI，請到設定頁填入 Base URL 與 API Key' });
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
    // 完成畫面要立刻說「下次某日」，所以自評回傳的是下次複習時間而不是 boolean。
    const nextReviewAt = await handleMessage({
      type: 'reviewWord', word: 'deploy', remembered: true,
    });
    expect(nextReviewAt).toBeGreaterThan(Date.now());
    expect((await db.words.get('deploy'))!.fsrsCard!.due).toBe(nextReviewAt);
  });

  it('listWords 帶出練過次數、抓到次數與下次複習日', async () => {
    await markWord('deploy', 'unknown');
    await db.lookupCache.put({
      word: 'deploy', payload: '部署', fetchedAt: 1,
      updatedAt: 1, deletedAt: null, pending: 0,
    });
    await handleMessage({ type: 'reviewWord', word: 'deploy', remembered: true });
    await handleMessage({ type: 'reviewWord', word: 'deploy', remembered: false });

    const [row] = await handleMessage({ type: 'listWords' }) as any[];
    expect(row.reviewCount).toBe(2);
    expect(row.caughtCount).toBe(1);
    expect(row.nextReviewAt).toBe((await db.words.get('deploy'))!.fsrsCard!.due);
    expect(row.progress).toBe('scheduled');
  });

  it('沒有 AI 詞典的字在總表不算現在可練，數字跟實際題數一致', async () => {
    await markWord('deploy', 'unknown');
    await markWord('rollback', 'unknown');
    await db.lookupCache.put({
      word: 'deploy', payload: '部署', fetchedAt: 1,
      updatedAt: 1, deletedAt: null, pending: 0,
    });

    const rows = await handleMessage({ type: 'listWords' }) as any[];
    const progress = new Map(rows.map((r) => [r.word, r.progress]));
    expect(progress.get('deploy')).toBe('fresh');
    expect(progress.get('rollback')).toBe('needsLookup');
    expect(await handleMessage({ type: 'listReviewItems' })).toHaveLength(1);
  });

  it('總表把收藏後馴服和只按 X 排除分開算', async () => {
    await markWord('deploy', 'unknown');
    await markWord('deploy', 'known');
    await markWord('timestamp', 'known');

    const rows = await handleMessage({ type: 'listWords' }) as any[];
    const progress = new Map(rows.map((r) => [r.word, r.progress]));
    expect(progress.get('deploy')).toBe('mastered');
    expect(progress.get('timestamp')).toBe('excluded');
  });
});
