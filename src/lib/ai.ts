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
  /** 沒給就用 DEFAULT_TEMPLATES。設成選填是為了讓既有呼叫端不必全部改 */
  templates?: Templates;
}

export interface LookupItem {
  /** 單字原形 */
  w: string;
  /** 這個字出現的句子,用來消除一詞多義 */
  s: string;
}

/** 用同一組 API 設定產生自然英文語音；TTS 模型不跟查詞模型綁在一起。 */
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
      instructions: 'Speak in natural American English with clear articulation, natural intonation, and a moderately slow pace for an English learner.',
      response_format: 'mp3',
    }),
  });

  if (!res.ok) {
    throw new Error(`AI 語音請求失敗 ${res.status}: ${await res.text()}`);
  }
  const audio = await res.arrayBuffer();
  if (!audio.byteLength) throw new Error('AI 語音回了空的結果');
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
    sentence: item.s.trim(),
  });
}

/**
 * 查詞與拆句不需要推理鏈,推理會讓一次查詢從 4 秒變 28 秒。
 * 但可接受的值分兩段:gpt-5.6 系列吃 'none',其餘 gpt-5 系列最低只到 'minimal',
 * 傳 'none' 會直接回 400 Unsupported value。2026-08-26 實測。
 */
function reasoningEffort(model: string): { reasoning_effort: string } | undefined {
  if (model.startsWith('gpt-5.6')) return { reasoning_effort: 'none' };
  if (model.startsWith('gpt-5')) return { reasoning_effort: 'minimal' };
  return undefined;
}

/**
 * 唯一一個對外送 request 的地方。三個功能的差別只有 system 訊息、
 * user 訊息,以及要不要開 JSON 模式。
 */
async function chat(
  system: string,
  user: string,
  settings: AiSettings,
  jsonMode: boolean,
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
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
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

/**
 * 查一個字,回 Markdown。
 *
 * 以前是一次送 30 個字、靠 JSON 把結果拆回各個單字。改成單字之後 JSON 就沒必要了:
 * 只有一筆結果,不需要結構化,也就沒有回應被截斷導致整批解析失敗的風險。
 * 少開一個 response_format,相容端點的支援度也更好。
 */
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
  const content = await chat(SYSTEM_RULES.lookup, prompt, settings, false, onDelta, signal);
  return content.trim();
}

/**
 * 翻譯整句或分析文法。回純文字,不是 JSON。
 *
 * 這兩個功能只有一筆結果,不需要結構化回傳,也就沒有 JSON 被截斷的風險。
 * 少開一個 response_format,相容端點的支援度也更好。
 */
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

  const content = await chat(SYSTEM_RULES[kind], user, settings, false, onDelta, signal);
  return content.trim();
}
