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
): Promise<string> {
  if (!item.w.trim()) return '';

  const prompt = buildLookupPrompt(
    item,
    settings.profile,
    settings.templates?.lookup ?? DEFAULT_TEMPLATES.lookup,
  );
  const content = await chat(SYSTEM_RULES.lookup, prompt, settings, false);
  return content.trim();
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
