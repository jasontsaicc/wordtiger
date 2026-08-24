import {
  SYSTEM_RULES,
  DEFAULT_TEMPLATES,
  renderTemplate,
  type Templates,
} from './prompt';

/** 一次批次最多送幾個字。超過這個數量,回應的 JSON 容易被模型截斷 */
const MAX_BATCH = 30;

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

export function buildLookupPrompt(
  items: LookupItem[],
  profile: string,
  template: string = DEFAULT_TEMPLATES.lookup,
): string {
  const list = items
    .slice(0, MAX_BATCH)
    .map((it) => `${it.w} | ${it.s}`)
    .join('\n');

  return renderTemplate(template, { profile: profile.trim(), list });
}

/**
 * 從模型回應裡挖出 JSON。
 *
 * 相容端點對 response_format 的支援程度不一,模型也常自作主張包一層
 * code fence 或加開場白。這裡取第一個 { 到最後一個 } 之間的內容,
 * 解析失敗就回空 Map,讓呼叫端退化成「這批沒查到」而不是整個功能爆炸。
 */
export function parseLookupResponse(raw: string): Map<string, string> {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return new Map();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return new Map();
  }
  if (typeof parsed !== 'object' || parsed === null) return new Map();

  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v === 'string') out.set(k, v);
  }
  return out;
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
): Promise<string> {
  const url = `${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`AI 請求失敗 ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

export async function lookupBatch(
  items: LookupItem[],
  settings: AiSettings,
): Promise<Map<string, string>> {
  if (items.length === 0) return new Map();

  const prompt = buildLookupPrompt(
    items,
    settings.profile,
    settings.templates?.lookup ?? DEFAULT_TEMPLATES.lookup,
  );
  const content = await chat(SYSTEM_RULES.lookup, prompt, settings, true);
  return parseLookupResponse(content);
}

/**
 * 翻譯整句或分析文法。回純文字,不是 JSON。
 *
 * 這兩個功能只有一筆結果,不需要結構化回傳,也就沒有 JSON 被截斷的風險。
 * 少開一個 response_format,相容端點的支援度也更好。
 */
export async function explainSentence(
  kind: 'translate' | 'grammar',
  sentence: string,
  settings: AiSettings,
): Promise<string> {
  const trimmed = sentence.trim();
  if (!trimmed) return '';

  const template = settings.templates?.[kind] ?? DEFAULT_TEMPLATES[kind];
  const user = renderTemplate(template, {
    profile: settings.profile.trim(),
    sentence: trimmed,
  });

  const content = await chat(SYSTEM_RULES[kind], user, settings, false);
  return content.trim();
}
