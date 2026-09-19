import {
  SYSTEM_RULES,
  DEFAULT_TEMPLATES,
  renderTemplate,
  type Templates,
} from './prompt';

export interface AiSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  profile: string;
  /** 未提供時使用 DEFAULT_TEMPLATES。 */
  templates?: Templates;
}

export interface LookupItem {
  /** 單字原形。 */
  w: string;
  /** 文章中的實際字形；片語或舊呼叫可省略。 */
  surface?: string;
  /** 用於消歧義的來源句。 */
  s: string;
}

/** 用同一條文字 AI 路徑測試設定，不帶入個人背景或網頁內容。 */
export async function testAiConnection(settings: AiSettings): Promise<void> {
  let endpoint: URL;
  try { endpoint = new URL(settings.baseUrl); }
  catch { throw new Error('請填入完整的 AI 服務網址。'); }
  if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw new Error('AI 服務網址必須是 HTTP 或 HTTPS，且不能含帳密。');
  }
  if (!settings.apiKey.trim() || !settings.model.trim()) throw new Error('請先填入 API Key 與 Model。');
  let text: string;
  try {
    text = await chat('Reply only with OK.', 'Connection test.', settings, undefined, AbortSignal.timeout(20_000));
  } catch (error) {
    if ((error instanceof Error || error instanceof DOMException) && ['TimeoutError', 'AbortError'].includes(error.name)) {
      throw new Error('連線逾時，請稍後再試或確認服務網址。');
    }
    // 不把服務端原始回應顯示出來，避免其中包含金鑰或其他敏感內容。
    const status = error instanceof Error ? /^AI 請求失敗 (\d{3}):/.exec(error.message)?.[1] : undefined;
    const hints: Record<string, string> = {
      '401': '金鑰無效或已過期', '403': '帳號或模型沒有存取權限',
      '404': '服務網址或模型名稱不正確', '429': '額度不足或請求過於頻繁',
    };
    throw new Error(status
      ? `連線失敗（${status}）：${hints[status] ?? '服務暫時無法完成請求'}。`
      : '無法取得有效回應，請確認網路、服務網址與 Chat Completions 相容性。');
  }
  if (typeof text !== 'string' || !text.trim()) throw new Error('服務回傳空白內容，請確認模型支援文字回應。');
}

/** TTS 使用獨立模型，不受查詞模型設定影響。 */
export async function generateSpeech(
  text: string,
  settings: AiSettings,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const input = text.trim();
  if (!input) return new ArrayBuffer(0);

  const res = await fetch(`${settings.baseUrl.replace(/\/+$/, '')}/audio/speech`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      voice: 'marin',
      input,
      instructions: 'Speak in warm, friendly, natural American English. Use clear articulation and natural intonation at a slightly slower-than-conversational pace, so non-native English learners can comfortably follow and imitate. Avoid exaggerated pronunciation or a robotic teaching tone.',
      response_format: 'mp3',
    }),
  });

  if (!res.ok) {
    throw new Error(`AI 語音請求失敗 ${res.status}: ${await res.text()}`);
  }
  const audio = await res.arrayBuffer();
  if (!audio.byteLength) throw new Error('AI 語音回傳空內容');
  return audio;
}

export function buildLookupPrompt(
  item: LookupItem,
  profile: string,
  template: string = DEFAULT_TEMPLATES.lookup,
): string {
  return renderTemplate(template, {
    profile: profile.trim(),
    word: item.w,
    surface: item.surface?.trim() || item.w,
    sentence: item.s.trim(),
  });
}

/** 使用各模型支援的最低推理量。 */
function reasoningEffort(model: string): { reasoning_effort: string } | undefined {
  if (model.startsWith('gpt-5.6')) return { reasoning_effort: 'none' };
  if (model.startsWith('gpt-5')) return { reasoning_effort: 'minimal' };
  return undefined;
}

/** 查詞與句子分析共用的 Chat Completions request。 */
async function chat(
  system: string,
  user: string,
  settings: AiSettings,
  onDelta?: (delta: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const url = `${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      ...reasoningEffort(settings.model),
      ...(onDelta ? { stream: true } : {}),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`AI 請求失敗 ${res.status}: ${await res.text()}`);
  }

  if (onDelta) return readChatStream(res, onDelta);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

/** 讀取 Chat Completions 的 SSE；瀏覽器原生串流已足夠，不引入 SDK。 */
export async function readChatStream(
  res: Response,
  onDelta: (delta: string) => void,
): Promise<string> {
  if (!res.body) throw new Error('AI 回應不支援串流');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';

  const consume = (line: string) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    const delta = JSON.parse(data).choices?.[0]?.delta?.content;
    if (typeof delta === 'string' && delta) {
      content += delta;
      onDelta(delta);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    lines.forEach(consume);
    if (done) break;
  }
  if (buffer) consume(buffer);
  return content.trim();
}

/** 查詢單字並回傳 Markdown。 */
export async function lookupWord(
  item: LookupItem,
  settings: AiSettings,
  onDelta?: (delta: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (!item.w.trim()) return '';

  const prompt = buildLookupPrompt(
    item,
    settings.profile,
    settings.templates?.lookup ?? DEFAULT_TEMPLATES.lookup,
  );
  const content = await chat(SYSTEM_RULES.lookup, prompt, settings, onDelta, signal);
  return content.trim();
}

/** 翻譯或分析句子並回傳純文字。 */
export interface SentenceInput {
  sentence: string;
  focus?: string;
  previous?: string;
  title?: string;
}

export async function explainSentence(
  kind: 'translate' | 'grammar',
  input: SentenceInput,
  settings: AiSettings,
  onDelta?: (delta: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const trimmed = input.sentence.trim();
  if (!trimmed) return '';

  const template = settings.templates?.[kind] ?? DEFAULT_TEMPLATES[kind];
  const user = renderTemplate(template, {
    profile: settings.profile.trim(),
    sentence: trimmed,
    focus: input.focus?.trim().slice(0, 80) ?? '',
    previous: input.previous?.trim().slice(0, 300) ?? '',
    title: input.title?.trim().slice(0, 200) ?? '',
  });

  const content = await chat(SYSTEM_RULES[kind], user, settings, onDelta, signal);
  return content.trim();
}
