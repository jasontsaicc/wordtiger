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

  it('要求輸出 JSON', () => {
    const prompt = buildLookupPrompt([{ w: 'a', s: 'b' }], '');
    expect(prompt).toContain('JSON');
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
