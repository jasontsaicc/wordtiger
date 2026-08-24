/** 一次批次最多送幾個字。超過這個數量,回應的 JSON 容易被模型截斷 */
const MAX_BATCH = 30;

export interface AiSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  profile: string;
}

export interface LookupItem {
  /** 單字原形 */
  w: string;
  /** 這個字出現的句子,用來消除一詞多義 */
  s: string;
}

/**
 * 系統層。這段不開放使用者編輯。
 * 批次查詞依賴結構化 JSON 回傳,格式一壞,整批解析失敗。
 */
const SYSTEM_RULES = [
  '你是英文單字解釋工具。',
  '只輸出一個 JSON 物件,不要有任何其他文字,不要包 markdown code fence。',
  'JSON 的 key 是輸入的單字,value 是繁體中文釋義字串。',
  '每個釋義不超過 20 個字。',
  '根據該字出現的句子判斷語意,不要給無關的義項。',
].join('\n');

export function buildLookupPrompt(items: LookupItem[], profile: string): string {
  const list = items
    .slice(0, MAX_BATCH)
    .map((it) => `${it.w} | ${it.s}`)
    .join('\n');

  const persona = profile.trim()
    ? `讀者背景:\n${profile.trim()}\n\n`
    : '';

  return `${persona}以下每行是「單字 | 該字出現的句子」,請輸出 JSON:\n\n${list}`;
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

export async function lookupBatch(
  items: LookupItem[],
  settings: AiSettings,
): Promise<Map<string, string>> {
  if (items.length === 0) return new Map();

  const url = `${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_RULES },
        { role: 'user', content: buildLookupPrompt(items, settings.profile) },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`AI 請求失敗 ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  return parseLookupResponse(data.choices?.[0]?.message?.content ?? '');
}
