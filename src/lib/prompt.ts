export type PromptKind = 'lookup' | 'translate' | 'grammar';

export interface Templates {
  lookup: string;
  translate: string;
  grammar: string;
}

/**
 * 系統層。不開放使用者編輯。
 *
 * 查詞的批次預取依賴結構化 JSON 回傳,格式一壞,30 筆一起解析失敗,
 * 而且失敗訊息很難懂。翻譯和文法分析回純文字,規則的重點是限制篇幅,
 * 免得一個句子回來三百字,卡片塞不下也讀不完。
 */
export const SYSTEM_RULES: Record<PromptKind, string> = {
  lookup: [
    '你是英文單字解釋工具。',
    '只輸出一個 JSON 物件,不要有任何其他文字,不要包 markdown code fence。',
    'JSON 的 key 是輸入的單字,value 是繁體中文釋義字串。',
    '每個釋義不超過 20 個字。',
    '根據該字出現的句子判斷語意,不要給無關的義項。',
  ].join('\n'),

  translate: [
    '你是英文翻譯工具。',
    '只輸出繁體中文譯文,不要附上原文,不要加任何說明或前言。',
    '譯文要通順,不要逐字直譯。',
    '專有名詞和技術術語保留英文原文。',
  ].join('\n'),

  grammar: [
    '你是英文文法分析工具。',
    '用繁體中文說明,總長不超過 150 個字。',
    '依序說明:句子的主要結構、值得注意的文法點、容易誤讀的地方。',
    '每一點一行,行首用「・」。不要用 markdown 標題或粗體。',
  ].join('\n'),
};

/**
 * 使用者層。options 頁可以整段改寫。
 * {{profile}} 是使用者的背景描述,{{list}} 和 {{sentence}} 由呼叫端填。
 */
export const DEFAULT_TEMPLATES: Templates = {
  lookup: [
    '讀者背景:',
    '{{profile}}',
    '',
    '以下每行是「單字 | 該字出現的句子」,請依句子的語意解釋每個字:',
    '',
    '{{list}}',
  ].join('\n'),

  translate: [
    '讀者背景:',
    '{{profile}}',
    '',
    '把這句英文翻成繁體中文:',
    '',
    '{{sentence}}',
  ].join('\n'),

  grammar: [
    '讀者背景:',
    '{{profile}}',
    '',
    '分析這句英文的文法結構:',
    '',
    '{{sentence}}',
  ].join('\n'),
};

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

/**
 * 把 {{key}} 換成 vars 裡的值。
 *
 * 用一次 replace 配 callback 走完,不是對每個 key 各跑一次 replace。
 * 差別在於這樣展開出來的內容不會再被掃第二次。使用者讀的句子如果剛好
 * 含有 {{profile}} 這種字串,不該把使用者的背景描述插進去。
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(PLACEHOLDER, (whole, key: string) =>
    key in vars ? vars[key]! : whole,
  );
}
