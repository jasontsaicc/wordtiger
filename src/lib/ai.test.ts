import { describe, it, expect, vi, beforeEach } from 'vitest';
import { lookupWord, buildLookupPrompt, readChatStream, generateSpeech } from './ai';

describe('generateSpeech', () => {
  it('用固定 TTS 模型與自然英文聲線產生 MP3', async () => {
    const bytes = Uint8Array.from([1, 2, 3]).buffer;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => bytes,
    });
    vi.stubGlobal('fetch', fetchMock);

    expect(await generateSpeech('We deploy on Friday.', {
      baseUrl: 'https://api.openai.com/v1/', apiKey: 'sk-test',
      model: 'gpt-5.6-luna', profile: '',
    })).toBe(bytes);

    const [url, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(init.body);
    expect(url).toBe('https://api.openai.com/v1/audio/speech');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    expect(body).toMatchObject({
      model: 'gpt-4o-mini-tts', voice: 'marin',
      input: 'We deploy on Friday.', response_format: 'mp3',
    });
    expect(body.instructions).toContain('warm, friendly');
    expect(body.instructions).toContain('follow and imitate');
  });
});

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

  it('實際字形與原形分開放進 prompt', () => {
    const prompt = buildLookupPrompt(
      { w: 'slam', surface: 'slammed', s: 'We got slammed with alerts.' },
      '',
      '實際：{{surface}}\n原形：{{word}}\n句子：{{sentence}}',
    );
    expect(prompt).toBe('實際：slammed\n原形：slam\n句子：We got slammed with alerts.');
  });

  it('預設 prompt 以實際字形教搭配、重音與具體發音技巧', () => {
    const prompt = buildLookupPrompt({
      w: 'slam', surface: 'slammed', s: 'We got slammed with alerts.',
    }, '');
    expect(prompt).toContain('實際字形：slammed');
    expect(prompt).toContain('原形：slam');
    expect(prompt).toContain('完整搭配');
    expect(prompt).toContain('## 發音與重音');
    expect(prompt).toContain('粗體標主重音');
    expect(prompt).toContain('舌位、嘴形');
    expect(prompt).toContain('不用中文諧音');
    expect(prompt).toContain('技巧省略,不要猜測');
    // 音標回到發音欄位裡面,不是回到獨立的 KK 區塊。
    expect(prompt).toContain('不可輸出 IPA');
    expect(prompt).toContain('[ˏʌndɚˋtekən]');
    expect(prompt).not.toContain('## 美式 KK 音標');
    // 本句功能依語境判定,原形欄只交代形式。
    expect(prompt).toContain('依原句判定實際功能');
    expect(prompt).toContain('以你的判斷為準');
  });

  it('預設 prompt 分開形式、句義與語感,保留輸出練習', () => {
    const prompt = buildLookupPrompt({
      w: 'reliability', s: 'The service offers high reliability.',
    }, '');
    expect(prompt).toContain('`## 原形 / 構詞`（實際字形與基礎形式不同時才列）、`## 本句意思`、`## 本句用法`、`## 語感與使用情境`');
    expect(prompt).toContain('各層附詞性與相關中文意思');
    expect(prompt).toContain('不暗示每次變形都改變核心字義');
    expect(prompt).toContain('不暗示可無條件互換');
    expect(prompt).toContain('## 換你說');
    expect(prompt).not.toContain('## 字族與構詞');
  });

  it('輸出契約在鎖定的系統層,不在使用者可編輯的 template', () => {
    // 可編輯 template 不負責渲染契約。
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

  it('依模型family送出可接受的 reasoning_effort', async () => {
    const cases: Array<[string, string | undefined]> = [
      ['gpt-5.6-luna', 'none'],
      ['gpt-5-mini', 'minimal'],
      ['gpt-4o-mini', undefined],
    ];

    for (const [model, expected] of cases) {
      const fetchMock = mockOk('內容');
      await lookupWord({ w: 'a', s: 'b' }, { ...settings, model });
      const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
      expect(body.reasoning_effort, model).toBe(expected);
    }
  });

  it('自訂的相容端點也打到同一條 /chat/completions 路徑', async () => {
    const fetchMock = mockOk('內容');

    await lookupWord({ w: 'deploy', s: 'b' }, {
      ...settings, baseUrl: 'https://api.example-llm.com/v1', model: 'tiny-fast-v2',
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.example-llm.com/v1/chat/completions');
    expect(JSON.parse(init.body).model).toBe('tiny-fast-v2');
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

  it('GPT-5.6 小模型關閉推理以降低查詞延遲', async () => {
    const spy = mockOk('內容');
    await lookupWord({ w: 'deploy', s: 'We deploy.' }, { ...settings, model: 'gpt-5.6-luna' });
    const body = JSON.parse(spy.mock.calls[0]![1]!.body as string);
    expect(body.reasoning_effort).toBe('none');
  });

  it('HTTP 錯誤時丟出帶狀態碼的例外', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 401, text: async () => 'unauthorized',
    }));
    await expect(lookupWord({ w: 'a', s: 'b' }, settings)).rejects.toThrow('401');
  });

  it('把取消訊號交給 fetch', async () => {
    const fetchMock = mockOk('內容');
    const controller = new AbortController();
    await lookupWord({ w: 'a', s: 'b' }, settings, undefined, controller.signal);
    expect(fetchMock.mock.calls[0]![1].signal).toBe(controller.signal);
  });

  it('單字是空字串時不發請求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await lookupWord({ w: '  ', s: 'b' }, settings)).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('readChatStream', () => {
  it('跨網路區塊解析 SSE 並逐段回報文字', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"關"}}]}\n\nda'));
        controller.enqueue(encoder.encode('ta: {"choices":[{"delta":{"content":"聯"}}]}\n\ndata: [DONE]\n\n'));
        controller.close();
      },
    });
    const chunks: string[] = [];
    const result = await readChatStream(new Response(body), (delta) => chunks.push(delta));
    expect(chunks).toEqual(['關', '聯']);
    expect(result).toBe('關聯');
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
      {
        sentence: 'We deploy to production every Friday.',
        focus: 'production',
        previous: 'The release is ready.',
        title: 'Deployment guide',
      },
      settings,
    );

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.messages[0].content).toBe(SYSTEM_RULES.translate);
    expect(body.messages[1].content).toContain('We deploy to production every Friday.');
    expect(body.messages[1].content).toContain('我是 DevOps');
    expect(body.messages[1].content).toContain('production');
    expect(body.messages[1].content).toContain('The release is ready.');
    expect(body.messages[1].content).toContain('Deployment guide');
    expect(got).toBe('我們每週五部署到正式環境。');
  });

  it('grammar 用文法的系統層規則', async () => {
    const fetchMock = mockOk('・主詞是 We');
    await explainSentence('grammar', { sentence: 'We deploy.' }, settings);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.messages[0].content).toBe(SYSTEM_RULES.grammar);
  });

  it('不送 response_format,整句功能回的是純文字不是 JSON', async () => {
    const fetchMock = mockOk('譯文');
    await explainSentence('translate', { sentence: 'We deploy.' }, settings);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.response_format).toBeUndefined();
  });

  it('回傳值去掉頭尾空白', async () => {
    mockOk('\n  譯文  \n');
    expect(await explainSentence('translate', { sentence: 'We deploy.' }, settings)).toBe('譯文');
  });

  it('空白句子不發請求,直接回空字串', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await explainSentence('translate', { sentence: '   ' }, settings)).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('HTTP 錯誤丟出帶狀態碼的例外', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 429, text: async () => 'rate limited',
    }));
    await expect(explainSentence('translate', { sentence: 'We deploy.' }, settings))
      .rejects.toThrow('429');
  });

  it('使用者自訂的 template 會蓋掉預設', async () => {
    const fetchMock = mockOk('譯文');
    await explainSentence('translate', { sentence: 'We deploy.' }, {
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
