import { describe, it, expect, vi, beforeEach } from 'vitest';
import { lookupWord, buildLookupPrompt } from './ai';

describe('buildLookupPrompt', () => {
  it('把使用者的 profile 放進 prompt', () => {
    const prompt = buildLookupPrompt(
      { w: 'deploy', s: 'We deploy on Friday.' },
      '我是 DevOps 工程師',
    );
    expect(prompt).toContain('我是 DevOps 工程師');
  });

  it('單字和它的出處句子都放進去', () => {
    const prompt = buildLookupPrompt({ w: 'deploy', s: 'We deploy on Friday.' }, '');
    expect(prompt).toContain('deploy');
    expect(prompt).toContain('We deploy on Friday.');
  });

  it('輸出契約在鎖定的系統層,不在使用者可編輯的 template', () => {
    // template 開放編輯之後,格式就不能靠它保證。使用者刪掉一句話不該讓渲染全歪
    const prompt = buildLookupPrompt({ w: 'a', s: 'b' }, '');
    expect(prompt).not.toContain('不要用 ``` 把整份回應包起來');
    expect(SYSTEM_RULES.lookup).toContain('不要用 ``` 把整份回應包起來');
  });
});

describe('lookupWord', () => {
  const settings = {
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-test',
    model: 'test-model',
    profile: '我是 DevOps',
  };

  const mockOk = (content: string) => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  beforeEach(() => vi.restoreAllMocks());

  it('打到 /chat/completions 並帶上 Authorization', async () => {
    const fetchMock = mockOk('## 詞性與釋義\n- **deploy** 部署');

    const got = await lookupWord({ w: 'deploy', s: 'We deploy on Friday.' }, settings);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    expect(got).toContain('部署');
  });

  it('不再開 JSON 模式,只有一筆結果不需要結構化', async () => {
    const fetchMock = mockOk('內容');
    await lookupWord({ w: 'a', s: 'b' }, settings);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.response_format).toBeUndefined();
  });

  it('baseUrl 結尾有斜線也不會產生雙斜線', async () => {
    const fetchMock = mockOk('x');
    await lookupWord({ w: 'a', s: 'b' }, { ...settings, baseUrl: 'https://api.example.com/v1/' });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.example.com/v1/chat/completions');
  });

  it('HTTP 錯誤時丟出帶狀態碼的例外', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 401, text: async () => 'unauthorized',
    }));
    await expect(lookupWord({ w: 'a', s: 'b' }, settings)).rejects.toThrow('401');
  });

  it('單字是空字串時不發請求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await lookupWord({ w: '  ', s: 'b' }, settings)).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
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
      { w: 'deploy', s: 'We deploy.' },
      '背景',
      '自訂 {{word}} 出自 {{sentence}}',
    );
    expect(prompt).toBe('自訂 deploy 出自 We deploy.');
  });
});
