export type PromptKind = 'lookup' | 'translate' | 'grammar';

export interface Templates {
  lookup: string;
  translate: string;
  grammar: string;
}

/**
 * 系統層。不開放使用者編輯。
 *
 * 這一層只放「程式碼依賴的輸出契約」,不放內容要求。內容要求屬於使用者層,
 * 使用者想怎麼改都行。查詞從批次 JSON 改成單字 Markdown 之後,
 * 程式碼依賴的只剩三件事:是 Markdown、沒有 code fence 包整份、沒有寒暄。
 * 篇幅限制留給翻譯和文法分析,那兩個是一句話的回應,回三百字卡片塞不下。
 */
export const SYSTEM_RULES: Record<PromptKind, string> = {
  lookup: [
    '用繁體中文回答。',
    '直接輸出內容本身,不要開場白、不要結語、不要說明你要做什麼。',
    '不要用 ``` 把整份回應包起來。',
    '支援的排版只有:## 標題、- 清單、**粗體**、`行內程式碼`。不要用表格。',
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
 * {{profile}} 是使用者的背景描述,{{word}} 和 {{sentence}} 由呼叫端填。
 */
export const DEFAULT_TEMPLATES: Templates = {
  lookup: [
    '你是精簡的英漢詞典與技術英文學習助手。',
    '讀者背景：{{profile}}',
    '單字：{{word}}',
    '出處：{{sentence}}',
    '',
    '依出處優先解釋實際義項；變形或縮寫才列原形／完整形式。',
    '依序輸出：KK 音標、詞性與釋義、常見搭配、2 個雙語例句、易混淆詞（確有需要才列）。',
    '每段使用 `## 標題`；無可靠內容就省略。總長 250–400 字，不寫詞源、百科介紹或硬湊同反義詞。',
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
