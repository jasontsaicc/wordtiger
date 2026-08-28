import { describe, it, expect } from 'vitest';
import { originPattern, pageOrigin } from './settings';

describe('originPattern', () => {
  it('把 base URL 縮成 origin 加萬用路徑', () => {
    expect(originPattern('https://api.openai.com/v1')).toBe('https://api.openai.com/*');
  });

  it('保留非預設的 port,本機 Ollama 會用到', () => {
    expect(originPattern('http://localhost:11434/v1')).toBe('http://localhost:11434/*');
  });

  it('結尾斜線不影響結果', () => {
    expect(originPattern('https://api.example.com/v1/')).toBe('https://api.example.com/*');
  });

  it('空字串回傳 null', () => {
    expect(originPattern('')).toBe(null);
  });

  it('不是合法網址時回傳 null,不丟例外', () => {
    expect(originPattern('api.openai.com')).toBe(null);
  });

  it('拒絕不能用於 AI fetch 權限的協定', () => {
    expect(originPattern('ftp://api.example.com/v1')).toBe(null);
  });
});

describe('pageOrigin', () => {
  it('只接受能注入的 http(s) 網頁', () => {
    expect(pageOrigin('https://example.com/a')).toBe('https://example.com');
    expect(pageOrigin('edge://extensions')).toBe(null);
    expect(pageOrigin('not a url')).toBe(null);
  });
});

import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  DEFAULT_HIGHLIGHT_COLORS, DEFAULT_HIGHLIGHT_TEXT_COLORS,
  DEFAULT_HIGHLIGHT_UNDERLINE_COLORS, OPENAI_BASE_URL, loadSettings, saveSettings,
} from './settings';
import { DEFAULT_TEMPLATES, PREVIOUS_DEFAULT_TEMPLATES } from './prompt';
import { beforeEach } from 'vitest';

const OLDEST_LOOKUP_DEFAULT = [
  '你是一個專業的英漢詞典與技術英文學習助手。請根據輸入的英文單字、縮寫、',
  '變形詞或短語,輸出清晰、準確、實用、方便學習的查詞結果。',
  '',
  '## 讀者背景',
  '{{profile}}',
  '',
  '## 任務要求',
  '1. 優先將輸入視為英文單字或短語處理。',
  '2. 如果輸入是變形詞(過去式、分詞、複數、第三人稱單數),先判斷並標示原形。',
  '3. 如果輸入是縮寫,先給出完整形式。',
  '4. 若為變形詞,在「原形」欄位用極短方式補充說明,例如:',
  '   `implemented → implement`(過去式 / 過去分詞)、`containers → container`(複數)。',
  '5. 若輸入本身已是原形且不是縮寫,不要輸出「原形」欄位。',
  '6. 若可判定讀音,提供 KK 音標。',
  '7. **出處句子是消歧義的依據**。這個字在該句中是什麼意思,就優先解釋那個意思,',
  '   不要把無關的義項排在前面。出處句子是空的時候才依一般常見度排序。',
  '8. 一個詞有多個意思時,順序是:該句中的意思 > 讀者領域常見的意思 > 一般高頻意思。',
  '   冷門義項省略或放最後。',
  '9. 使用場景、搭配、改寫與例句,優先貼近讀者背景描述的真實工作情境。',
  '10. 例句與改寫必須自然、簡潔、真實,不要生硬造句或使用冷僻表達。',
  '11. 可選欄位若沒有足夠可靠內容,直接省略,不要硬湊。',
  '12. 篇幅過長時,優先保留「詞性與釋義、常見搭配、例句」。',
  '13. 不要輸出總結、提醒、寒暄或額外說明,只輸出規定內容。',
  '',
  '## 輸出格式',
  '依下列順序輸出,每個欄位用 `## 欄位名` 當標題,標成(可選)的沒內容就整段省略:',
  '',
  '- 原形 / 完整形式(可選,僅當輸入為變形詞或縮寫)',
  '- KK 音標(可選)',
  '- 詞源(可選,50 字內)',
  '- 詞根詞綴(可選)',
  '- 使用場景:1-2 個貼近讀者領域的語境,各含場景名稱、簡短中文說明、1 句英文例句',
  '- 詞性與釋義:按常見程度排序,每個詞性單獨列出;技術語境的特殊含義要標註',
  '- 常見搭配(可選):3-5 個高頻搭配,各附簡短中文說明',
  '- 自然改寫(可選):2-3 個常用替代表達,各附語氣或使用差異',
  '- 例句:2-3 句自然實用的英文,各附繁體中文翻譯',
  '- 同義詞(可選):3-5 個,各附詞性與簡短中文釋義',
  '- 反義詞(可選):3-5 個,各附詞性與簡短中文釋義',
  '- 易混淆詞對比(可選):僅在確實容易混淆時輸出',
  '',
  '## 風格',
  '層級清晰、重點加粗、內容精簡。優先實用性與學習價值,不要寫成百科條目。',
  '',
  '## 本次輸入',
  '單字:{{word}}',
  '出處句子:{{sentence}}',
].join('\n');

const PREVIOUS_DEVOPS_TRANSLATE = [
  '你是一位專業英文老師與技術文件譯者,服務非母語的 DevOps 工程師。',
  '採用 AWS、Google Cloud 等公開技術文件常見的精確、簡潔語感,但不要捏造原句沒有的資訊。',
  '',
  '目標:翻成自然、專業且一眼能懂的繁體中文。',
  '- 忠實保留原句的時態、語氣、條件、因果、否定、程度與責任歸屬。',
  '- 依上下文判斷技術義；產品名、服務名、指令、程式碼、設定鍵與常用縮寫保留英文。',
  '- 有自然中文說法的技術動作照語意翻譯,不要為了顯得專業而保留整串英文。',
  '- 優先傳達工程上的實際含義,避免逐字翻譯與英文語序。',
  '',
  '讀者背景：{{profile}}',
  '英文原句：{{sentence}}',
].join('\n');

const PREVIOUS_DEVOPS_GRAMMAR = [
  '你是一位專業英文老師,擅長教非母語的 DevOps 工程師閱讀技術文件。',
  '你熟悉 AWS、Google Cloud 等公開技術文件常見的精確、直接與可操作寫法,但不要捏造內部規範。',
  '',
  '目標:讓讀者看懂句子如何組成、技術上在表達什麼,以及下次如何辨認同類句型。',
  '- 先找主句骨架,指出主詞、動詞、受詞或補語；子句和修飾語只解釋會影響理解的部分。',
  '- 最多解釋 2 個值得學的點,優先處理時態、語態、情態動詞、條件句、分詞、關係子句、介系詞與修飾範圍。',
  '- 說明句子在技術文件中的功能,例如操作、條件、限制、原因、結果、風險或建議。',
  '- 特別指出華語學習者容易誤讀的指涉、否定範圍或長修飾語；沒有就省略。',
  '- 原句明顯不自然時才給一個較自然的英文改寫,否則不要改寫。',
  '',
  '讀者背景：{{profile}}',
  '分析句子：{{sentence}}',
].join('\n');

const PREVIOUS_SURFACE_LOOKUP = [
  '你是一位專業英文老師與英漢詞典編輯,擅長教非母語的 DevOps 工程師。',
  '你熟悉 AWS、Google Cloud 等公開技術文件,以及 Kubernetes、Docker、Terraform、CI/CD、Linux、Networking、Monitoring 與 Incident Management 的實際用語。',
  '採用大型技術團隊文件常見的精確、簡潔、可操作語感,但不要捏造內部標準或不存在的專業用法。',
  '',
  '目標:讓讀者快速看懂這個詞在本句的意思,並能在技術工作中自然使用。',
  '- 義項優先序:出處中的實際意思 > 技術領域常用義 > 一般英文高頻義。不要因讀者是工程師就硬套技術解釋。',
  '- 先用 `## 本句用法` 說明實際字形在本句的功能、原形,以及決定意思的完整固定搭配；沒有特殊詞形或搭配就簡短帶過。',
  '- 固定搭配決定意思時,以完整搭配為教學單位,例如 `get/be slammed (with + noun)`,不可只解釋孤立的原形。',
  '- `## 美式 KK 音標` 使用 `[ ]`,只可輸出美式 KK 音標,不可輸出 IPA；不確定就省略。實際字形與原形不同時以實際字形為主,必要時並列原形。',
  '- 再依序使用 `## 詞性與釋義`、`## 常見搭配`、`## 例句`；無可靠內容就省略。',
  '- 本句義排第一並標註 **本句**；最多再補 1 個真正容易混淆的義項。技術特有義標註 **技術語境**。',
  '- 搭配最多 4 個；例句 1–2 個雙語句,至少一句貼近出處。',
  '- `## 自然改寫` 只在能修正誤讀或不自然表達時才列,不能只是重述釋義。`## 記憶提示` 只有明顯有幫助時才列。',
  '- 通常不超過 350 個中文字。不要硬湊、百科介紹或重複輸入。',
  '',
  '讀者背景：{{profile}}',
  '實際字形：{{surface}}',
  '原形：{{word}}',
  '出處句子：{{sentence}}',
].join('\n');

describe('loadSettings 的 template 合併', () => {
  beforeEach(() => fakeBrowser.reset());

  it('沒存過設定時,三個 template 都是預設值', async () => {
    const s = await loadSettings();
    expect(s.templates).toEqual(DEFAULT_TEMPLATES);
    expect(s.baseUrl).toBe(OPENAI_BASE_URL);
    expect(s.model).toBe('gpt-5.6-luna');
    expect(s.highlightColors).toEqual(DEFAULT_HIGHLIGHT_COLORS);
    expect(s.highlightTextColors).toEqual(DEFAULT_HIGHLIGHT_TEXT_COLORS);
    expect(s.highlightUnderlineColors).toEqual(DEFAULT_HIGHLIGHT_UNDERLINE_COLORS);
    expect(s.markConjunctions).toBe(true);
    expect(s.autoOrigins).toEqual([]);
  });

  it('只改過一個 template 時,其他兩個仍回預設值', async () => {
    await saveSettings({
      templates: { ...DEFAULT_TEMPLATES, lookup: '自訂查詞 {{surface}} / {{word}}' },
    });
    const s = await loadSettings();
    expect(s.templates.lookup).toBe('自訂查詞 {{surface}} / {{word}}');
    expect(s.templates.translate).toBe(DEFAULT_TEMPLATES.translate);
  });

  it('舊版存檔完全沒有 templates 欄位時也要回預設值', async () => {
    await fakeBrowser.storage.local.set({ settings: { baseUrl: 'https://x/v1' } });
    const s = await loadSettings();
    expect(s.baseUrl).toBe('https://x/v1');
    expect(s.templates).toEqual(DEFAULT_TEMPLATES);
  });

  it('自訂的相容端點與模型名稱要原封不動存讀', async () => {
    // 自訂端點與模型名稱必須原樣保留。
    await fakeBrowser.storage.local.set({ settings: {
      baseUrl: 'https://api.example-llm.com/v1', model: 'tiny-fast-v2',
    } });
    const s = await loadSettings();
    expect(s.baseUrl).toBe('https://api.example-llm.com/v1');
    expect(s.model).toBe('tiny-fast-v2');
  });

  it('含舊預設片段的自訂 lookup 不會被覆蓋', async () => {
    const custom = '保留我的自訂規則\n13. 不要輸出總結';
    await fakeBrowser.storage.local.set({ settings: {
      templates: { ...DEFAULT_TEMPLATES, lookup: custom },
    } });
    expect((await loadSettings()).templates.lookup).toBe(custom);
  });

  it('三個未自訂的舊預設都自動升級', async () => {
    await fakeBrowser.storage.local.set({ settings: {
      templates: PREVIOUS_DEFAULT_TEMPLATES,
    } });
    expect((await loadSettings()).templates).toEqual(DEFAULT_TEMPLATES);
  });

  it('上一版 lookup 預設自動升級，但不靠模糊比對', async () => {
    const previousLookup = [
      '你是一位專業英文老師與英漢詞典編輯,擅長教非母語的 DevOps 工程師。',
      '你熟悉 AWS、Google Cloud 等公開技術文件,以及 Kubernetes、Docker、Terraform、CI/CD、Linux、Networking、Monitoring 與 Incident Management 的實際用語。',
      '採用大型技術團隊文件常見的精確、簡潔、可操作語感,但不要捏造內部標準或不存在的專業用法。',
      '',
      '目標:讓讀者快速看懂這個詞在本句的意思,並能在技術工作中自然使用。',
      '- 義項優先序:出處中的實際意思 > 技術領域常用義 > 一般英文高頻義。不要因讀者是工程師就硬套技術解釋。',
      '- 變形詞才列原形與變化；縮寫才列完整形式。KK 音標不確定時省略,不要猜測。',
      '- 依序使用 `## 原形 / 完整形式`（需要才列）、`## KK 音標`、`## 詞性與釋義`、`## 常見搭配`、`## 例句`。',
      '- 釋義最多 3 個,本句義排第一並標註 **本句**；技術特有義標註 **技術語境**。',
      '- 搭配最多 4 個；例句 1–2 個雙語句,至少一句貼近出處。',
      '- `## 自然改寫`、`## 易混淆詞`、`## 記憶提示` 只有明顯有幫助時才列,各最多 2 點。',
      '- 通常不超過 350 個中文字；複雜多義詞最多 500 字。不要硬湊、百科介紹或重複輸入。',
      '',
      '讀者背景：{{profile}}',
      '查詢項目：{{word}}',
      '出處句子：{{sentence}}',
    ].join('\n');
    await fakeBrowser.storage.local.set({ settings: {
      templates: { ...DEFAULT_TEMPLATES, lookup: previousLookup },
    } });
    expect((await loadSettings()).templates.lookup).toBe(DEFAULT_TEMPLATES.lookup);
  });

  it('跳過數個版本的歷史預設仍會精確升級', async () => {
    await fakeBrowser.storage.local.set({ settings: { templates: {
      lookup: OLDEST_LOOKUP_DEFAULT,
      translate: PREVIOUS_DEVOPS_TRANSLATE,
      grammar: PREVIOUS_DEVOPS_GRAMMAR,
    } } });
    expect((await loadSettings()).templates).toEqual(DEFAULT_TEMPLATES);
  });

  it('字族規則發布前的 lookup 預設自動升級', async () => {
    await fakeBrowser.storage.local.set({ settings: { templates: {
      ...DEFAULT_TEMPLATES,
      lookup: PREVIOUS_SURFACE_LOOKUP,
    } } });
    expect((await loadSettings()).templates.lookup).toContain('## 字族與構詞');
  });

  it('含舊預設片段的自訂 translate 和 grammar 不會被覆蓋', async () => {
    const translate = '保留自訂規則\n目標:翻成自然、專業且一眼能懂';
    const grammar = '保留自訂規則\n目標:讓讀者看懂句子如何組成';
    await fakeBrowser.storage.local.set({ settings: { templates: {
      ...DEFAULT_TEMPLATES,
      translate,
      grammar,
    } } });
    const templates = (await loadSettings()).templates;
    expect(templates.translate).toBe(translate);
    expect(templates.grammar).toBe(grammar);
  });
});

describe('高亮顏色設定', () => {
  beforeEach(() => fakeBrowser.reset());

  it('舊版預設背景自動換成新配色，但保留自訂背景', async () => {
    await fakeBrowser.storage.local.set({ settings: { highlightColors: {
      saved: '#8fb8ff', learning: '#c8c0ff', advanced: '#ffd38a', rare: '#ff9b9b',
    } } });
    expect((await loadSettings()).highlightColors).toEqual(DEFAULT_HIGHLIGHT_COLORS);

    await fakeBrowser.storage.local.set({ settings: { highlightColors: {
      saved: '#12345678', learning: '#c8c0ff', advanced: '#ffd38a', rare: '#ff9b9b',
    } } });
    expect((await loadSettings()).highlightColors.saved).toBe('#12345678');
  });

  it('拒絕會被插入網頁 style 的非法顏色', async () => {
    await fakeBrowser.storage.local.set({ settings: {
      highlightColors: { saved: 'red; } body { display:none', learning: '#112233' },
    } });
    const colors = (await loadSettings()).highlightColors;
    expect(colors.saved).toBe(DEFAULT_HIGHLIGHT_COLORS.saved);
    expect(colors.learning).toBe('#112233');
  });
});

describe('blockedHosts 一定是陣列', () => {
  beforeEach(() => fakeBrowser.reset());

  it('存進 Proxy 包住的陣列,讀回來還是真陣列', async () => {
    const proxied = new Proxy(['corp.example.com'], {});
    await saveSettings({ blockedHosts: proxied });
    const s = await loadSettings();
    expect(Array.isArray(s.blockedHosts)).toBe(true);
    expect(s.blockedHosts).toEqual(['corp.example.com']);
  });

  it('storage 裡已經壞成物件時,讀回來會被修成預設陣列', async () => {
    // 模擬舊版將陣列序列化成數字鍵物件。
    await fakeBrowser.storage.local.set({
      settings: { blockedHosts: { 0: 'localhost', 1: '127.0.0.1' } },
    });
    const s = await loadSettings();
    expect(Array.isArray(s.blockedHosts)).toBe(true);
    // 讀回後必須維持陣列介面。
    expect(s.blockedHosts.some((h) => h === 'localhost')).toBe(true);
    expect(() => s.blockedHosts.join('\n')).not.toThrow();
  });
});
