import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseLookupResponse, lookupBatch, buildLookupPrompt } from './ai';

describe('parseLookupResponse', () => {
  it('解析乾淨的 JSON', () => {
    const raw = '{"deploy":"部署","staging":"預備環境"}';
    const got = parseLookupResponse(raw);
    expect(got.get('deploy')).toBe('部署');
  });

  it('容忍外面包了 markdown code fence', () => {
    const raw = '```json\n{"deploy":"部署"}\n```';
    expect(parseLookupResponse(raw).get('deploy')).toBe('部署');
  });

  it('容忍前後有多餘文字', () => {
    const raw = '好的,這是結果:\n{"deploy":"部署"}\n希望有幫助';
    expect(parseLookupResponse(raw).get('deploy')).toBe('部署');
  });

  it('完全無法解析時回傳空 Map,不丟例外', () => {
    expect(parseLookupResponse('抱歉我不知道').size).toBe(0);
  });

  it('忽略值不是字串的欄位', () => {
    const raw = '{"deploy":"部署","bad":{"nested":1}}';
    const got = parseLookupResponse(raw);
    expect(got.get('deploy')).toBe('部署');
    expect(got.has('bad')).toBe(false);
  });
});

describe('buildLookupPrompt', () => {
  it('把使用者的 profile 放進 prompt', () => {
    const prompt = buildLookupPrompt(
      [{ w: 'deploy', s: 'We deploy on Friday.' }],
      '我是 DevOps 工程師',
    );
    expect(prompt).toContain('我是 DevOps 工程師');
  });

  it('把每個字和它的句子都放進去', () => {
    const prompt = buildLookupPrompt(
      [{ w: 'deploy', s: 'We deploy on Friday.' }],
      '',
    );
    expect(prompt).toContain('deploy');
    expect(prompt).toContain('We deploy on Friday.');
  });

  it('輸出格式的要求不在使用者可編輯的 template,而在鎖定的系統層', () => {
    // template 開放編輯之後,格式就不能靠它保證。使用者刪掉一句話不該讓解析全掛
    const prompt = buildLookupPrompt([{ w: 'a', s: 'b' }], '');
    expect(prompt).not.toContain('JSON');
    expect(SYSTEM_RULES.lookup).toContain('JSON');
  });
});

describe('lookupBatch', () => {
  const settings = {
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-test',
    model: 'test-model',
    profile: '我是 DevOps',
  };

  beforeEach(() => vi.restoreAllMocks());

  it('打到 /chat/completions 並帶上 Authorization', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"deploy":"部署"}' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const got = await lookupBatch([{ w: 'deploy', s: 'We deploy on Friday.' }], settings);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    expect(got.get('deploy')).toBe('部署');
  });

  it('baseUrl 結尾有斜線也不會produce 雙斜線', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{}' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await lookupBatch([{ w: 'a', s: 'bbbb' }], { ...settings, baseUrl: 'https://api.example.com/v1/' });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.example.com/v1/chat/completions');
  });

  it('HTTP 錯誤時丟出帶狀態碼的例外', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 401, text: async () => 'unauthorized',
    }));
    await expect(lookupBatch([{ w: 'a', s: 'b' }], settings)).rejects.toThrow('401');
  });

  it('items 是空陣列時不發請求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const got = await lookupBatch([], settings);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(got.size).toBe(0);
  });

  it('超過 30 個字時只送前 30 個', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{}' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const items = Array.from({ length: 40 }, (_, i) => ({ w: `w${i}`, s: 'x' }));
    await lookupBatch(items, settings);

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    const prompt = body.messages.at(-1).content;
    expect(prompt).toContain('w29');
    expect(prompt).not.toContain('w30');
  });
});

import { explainSentence } from './ai';
import { SYSTEM_RULES, DEFAULT_TEMPLATES } from './prompt';

describe('explainSentence', () => {
  const settings = {
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-test',
    model: 'test-model',
    profile: '我是 DevOps',
  };

  beforeEach(() => vi.restoreAllMocks());

  function mockOk(content: string) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('translate 用翻譯的系統層規則,句子放進 user 訊息', async () => {
    const fetchMock = mockOk('我們每週五部署到正式環境。');
    const got = await explainSentence(
      'translate',
      'We deploy to production every Friday.',
      settings,
    );

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.messages[0].content).toBe(SYSTEM_RULES.translate);
    expect(body.messages[1].content).toContain('We deploy to production every Friday.');
    expect(body.messages[1].content).toContain('我是 DevOps');
    expect(got).toBe('我們每週五部署到正式環境。');
  });

  it('grammar 用文法的系統層規則', async () => {
    const fetchMock = mockOk('・主詞是 We');
    await explainSentence('grammar', 'We deploy.', settings);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.messages[0].content).toBe(SYSTEM_RULES.grammar);
  });

  it('不送 response_format,整句功能回的是純文字不是 JSON', async () => {
    const fetchMock = mockOk('譯文');
    await explainSentence('translate', 'We deploy.', settings);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.response_format).toBeUndefined();
  });

  it('回傳值去掉頭尾空白', async () => {
    mockOk('\n  譯文  \n');
    expect(await explainSentence('translate', 'We deploy.', settings)).toBe('譯文');
  });

  it('空白句子不發請求,直接回空字串', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await explainSentence('translate', '   ', settings)).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('HTTP 錯誤丟出帶狀態碼的例外', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 429, text: async () => 'rate limited',
    }));
    await expect(explainSentence('translate', 'We deploy.', settings))
      .rejects.toThrow('429');
  });

  it('使用者自訂的 template 會蓋掉預設', async () => {
    const fetchMock = mockOk('譯文');
    await explainSentence('translate', 'We deploy.', {
      ...settings,
      templates: { ...DEFAULT_TEMPLATES, translate: '只翻這句:{{sentence}}' },
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.messages[1].content).toBe('只翻這句:We deploy.');
  });
});

describe('buildLookupPrompt 的自訂 template', () => {
  it('傳入 template 時用傳入的,不用預設', () => {
    const prompt = buildLookupPrompt(
      [{ w: 'deploy', s: 'We deploy.' }],
      '背景',
      '自訂:{{list}}',
    );
    expect(prompt).toBe('自訂:deploy | We deploy.');
  });
});
