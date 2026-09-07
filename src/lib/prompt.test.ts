import { describe, it, expect } from 'vitest';
import { renderTemplate, extractTakeaway, extractQuiz, stripQuiz, DEFAULT_TEMPLATES, SYSTEM_RULES } from './prompt';

describe('renderTemplate', () => {
  it('取代單一變數', () => {
    expect(renderTemplate('你好 {{name}}', { name: '世界' })).toBe('你好 世界');
  });

  it('同一個變數出現多次都要取代', () => {
    expect(renderTemplate('{{a}} 和 {{a}}', { a: 'x' })).toBe('x 和 x');
  });

  it('沒給值的 placeholder 原樣保留,讓使用者看得出自己打錯字', () => {
    expect(renderTemplate('嗨 {{missing}}', {})).toBe('嗨 {{missing}}');
  });

  it('變數的值裡面含 placeholder 時不會被二次展開', () => {
    // 替換值中的 placeholder 不應再次展開。
    expect(renderTemplate('{{a}}', { a: '{{b}}', b: '炸了' })).toBe('{{b}}');
  });

  it('花括號內允許有空白', () => {
    expect(renderTemplate('{{ name }}', { name: 'x' })).toBe('x');
  });

  it('值是空字串時就換成空字串', () => {
    expect(renderTemplate('[{{a}}]', { a: '' })).toBe('[]');
  });
});

describe('extractTakeaway', () => {
  it('只取帶走行的英文片語,沒有就不硬收藏', () => {
    expect(extractTakeaway('意思｜若失敗就回滾\n帶走｜be rolled back｜被回滾'))
      .toBe('be rolled back');
    expect(extractTakeaway('意思｜這是簡單句')).toBe(null);
    expect(extractTakeaway('帶走｜只有中文｜提示')).toBe(null);
  });

  it('模型多印一次前綴時仍抓得到片語', () => {
    expect(extractTakeaway('帶走｜帶走｜idempotent operation｜冪等操作'))
      .toBe('idempotent operation');
  });

  it('模型自己截斷的片語不收藏', () => {
    expect(extractTakeaway('帶走｜can be retried without changing…｜可重試而不改變……'))
      .toBe(null);
    expect(extractTakeaway('帶走｜can be retried without changing...｜提示')).toBe(null);
  });

  it('英文夾中文佔位的句型不當作詞庫 key', () => {
    expect(extractTakeaway('帶走｜provided [條件]｜前提是……才……')).toBe(null);
  });
});

describe('extractQuiz', () => {
  it('正常時回傳選項與正確答案的原始索引', () => {
    expect(extractQuiz('選項｜掐住、扼住｜被服務端限流擋下｜主動調降發送速率\n答案｜2\n## 詞性與釋義'))
      .toEqual({ choices: ['掐住、扼住', '被服務端限流擋下', '主動調降發送速率'], right: 1 });
  });

  it('開頭空行不影響判定', () => {
    expect(extractQuiz('\n\n選項｜A｜B｜C\n答案｜1'))
      .toEqual({ choices: ['A', 'B', 'C'], right: 0 });
  });

  it('選項不是剛好三個時回 null', () => {
    expect(extractQuiz('選項｜A｜B\n答案｜1')).toBeNull();
    expect(extractQuiz('選項｜A｜B｜C｜D\n答案｜1')).toBeNull();
  });

  it('任一選項為空字串時回 null', () => {
    expect(extractQuiz('選項｜A｜｜C\n答案｜1')).toBeNull();
  });

  it('選項有重複時回 null', () => {
    expect(extractQuiz('選項｜A｜A｜B\n答案｜1')).toBeNull();
  });

  it('答案寫成句子時仍取得到數字', () => {
    // 實際遇過的回應:模型把「正確選項是第幾個(1-3)」這句說明也抄進了答案行。
    expect(extractQuiz('選項｜A｜B｜C\n答案｜正確選項是第1個'))
      .toEqual({ choices: ['A', 'B', 'C'], right: 0 });
  });

  it('選項行漏掉「選項｜」字首時,由下一行的答案行認出來', () => {
    expect(extractQuiz('合理的預設值｜保守的預設值｜敏感的預設值\n答案｜1'))
      .toEqual({ choices: ['合理的預設值', '保守的預設值', '敏感的預設值'], right: 0 });
  });

  it('答案越界時回 null', () => {
    expect(extractQuiz('選項｜A｜B｜C\n答案｜0')).toBeNull();
    expect(extractQuiz('選項｜A｜B｜C\n答案｜4')).toBeNull();
  });

  it('缺少選項行或答案行時回 null', () => {
    expect(extractQuiz('選項｜A｜B｜C')).toBeNull();
    expect(extractQuiz('答案｜1')).toBeNull();
  });

  it('選項行不在開頭時視為內容,不算出題', () => {
    expect(extractQuiz('## 本句用法\n選項｜A｜B｜C\n答案｜1')).toBeNull();
  });

  it('舊 payload 沒有選項行時回 null', () => {
    expect(extractQuiz('## 詞性與釋義\n- 部署')).toBeNull();
  });
});

describe('stripQuiz', () => {
  it('選項與答案都在開頭時整份剝除', () => {
    expect(stripQuiz('選項｜A｜B｜C\n答案｜1\n## 詞性與釋義\n- 部署'))
      .toBe('## 詞性與釋義\n- 部署');
  });

  it('沒有選項行時原樣回傳', () => {
    const text = '## 詞性與釋義\n- 部署';
    expect(stripQuiz(text)).toBe(text);
  });

  it('只有選項行沒有答案行時仍要剝除,避免壞題漏到畫面上', () => {
    expect(stripQuiz('選項｜A｜B｜C\n## 詞性與釋義')).toBe('## 詞性與釋義');
  });

  it('選項行出現在正文中間時不誤刪', () => {
    const text = '## 本句用法\n選項｜A｜B｜C\n答案｜1';
    expect(stripQuiz(text)).toBe(text);
  });

  it('選項行漏掉字首時兩行都要剝除,不能把壞題漏到畫面上', () => {
    expect(stripQuiz('合理的預設值｜保守的預設值｜敏感的預設值\n答案｜正確選項是第1個\n## 本句用法'))
      .toBe('## 本句用法');
  });

  it('第一行切不出三段時,不因為下一行是答案行就誤刪正文', () => {
    const text = '## 本句用法\n答案｜1';
    expect(stripQuiz(text)).toBe(text);
  });
});

describe('DEFAULT_TEMPLATES', () => {
  it('三個功能都有預設值', () => {
    expect(DEFAULT_TEMPLATES.lookup.length).toBeGreaterThan(0);
    expect(DEFAULT_TEMPLATES.translate.length).toBeGreaterThan(0);
    expect(DEFAULT_TEMPLATES.grammar.length).toBeGreaterThan(0);
  });

  it('查詞 template 必須帶實際字形、原形與語境', () => {
    expect(DEFAULT_TEMPLATES.lookup).toContain('{{profile}}');
    expect(DEFAULT_TEMPLATES.lookup).toContain('{{word}}');
    expect(DEFAULT_TEMPLATES.lookup).toContain('{{surface}}');
    // 來源句提供一詞多義的消歧義依據。
    expect(DEFAULT_TEMPLATES.lookup).toContain('{{sentence}}');
  });

  it('看懂和拆句 template 必須帶焦點詞與閱讀上下文', () => {
    for (const tpl of [DEFAULT_TEMPLATES.translate, DEFAULT_TEMPLATES.grammar]) {
      for (const variable of ['profile', 'title', 'previous', 'focus', 'sentence']) {
        expect(tpl).toContain(`{{${variable}}}`);
      }
    }
  });

  it('三個預設都以非母語 DevOps 工程師與大型雲端公開文件為目標', () => {
    for (const tpl of Object.values(DEFAULT_TEMPLATES)) {
      expect(tpl).toContain('非母語');
      expect(tpl).toContain('DevOps');
      expect(tpl).toContain('AWS');
      expect(tpl).toContain('Google Cloud');
    }
  });
});

describe('SYSTEM_RULES', () => {
  it('三個功能各有一份鎖定的系統層規則', () => {
    expect(Object.keys(SYSTEM_RULES).sort()).toEqual(['grammar', 'lookup', 'translate']);
  });

  it('查詞的系統層只鎖輸出契約,不鎖內容', () => {
    // 系統層僅保留渲染依賴的契約。
    expect(SYSTEM_RULES.lookup).toContain('```');
    expect(SYSTEM_RULES.lookup).toContain('繁體中文');
    // 單筆查詞不需要 JSON 契約。
    expect(SYSTEM_RULES.lookup).not.toContain('JSON');
  });

  it('快速看懂和拆句都有可掃讀的固定行標籤', () => {
    expect(SYSTEM_RULES.translate).toContain('意思｜');
    expect(SYSTEM_RULES.translate).toContain('關鍵｜');
    expect(SYSTEM_RULES.grammar).toContain('拆法｜');
    expect(SYSTEM_RULES.grammar).toContain('白話英文｜');
    expect(SYSTEM_RULES.grammar).toContain('帶走｜');
  });

  it('可遷移句型必須用全英文槽位帶走', () => {
    expect(SYSTEM_RULES.grammar).toContain('帶走｜英文片語或句型｜極短中文提示');
    expect(SYSTEM_RULES.grammar).toContain('英文欄不可含中文');
    expect(SYSTEM_RULES.grammar).toContain('用法｜');
    expect(SYSTEM_RULES.grammar).toContain('例句｜');
  });

  it('拆句保留原句意義區塊,並只教真正影響理解的卡點', () => {
    expect(SYSTEM_RULES.grammar).toContain('2–4 個英文意義區塊');
    expect(SYSTEM_RULES.grammar).toContain('不要逐字切');
    expect(SYSTEM_RULES.grammar).toContain('否定或條件範圍');
    expect(SYSTEM_RULES.grammar).toContain('不得改變原句意思');
    expect(SYSTEM_RULES.grammar).toContain('不同情境的自然英文例句');
  });

  it('片語詞典要求使用場景與搭配限制', () => {
    expect(SYSTEM_RULES.lookup).toContain('多字片語');
    expect(SYSTEM_RULES.lookup).toContain('## 使用場景');
    expect(SYSTEM_RULES.lookup).toContain('不適用情況');
  });
});

describe('SYSTEM_RULES.lookup 的出題規則', () => {
  it('要求輸出選項與答案兩行,並帶反例避免義項型出題', () => {
    expect(SYSTEM_RULES.lookup).toContain('選項｜');
    expect(SYSTEM_RULES.lookup).toContain('答案｜');
    expect(SYSTEM_RULES.lookup).toContain('throttled');
  });

  // ADR-0029:模型抄的是填好的範例,不是欄位說明。範例自己要先過得了自己的解析器。
  it('規格裡兩個範例都解析得出來,且選項都是中文', () => {
    const lines = SYSTEM_RULES.lookup.split('\n');
    const examples = lines.flatMap((line, i) =>
      line.startsWith('選項｜') && lines[i + 1]?.startsWith('答案｜')
        ? [`${line}\n${lines[i + 1]}`] : []);

    expect(examples).toHaveLength(2);
    expect(extractQuiz(examples[0]!)).toEqual({
      choices: ['這台機器被別人重開了', '這台機器自己重開了', '這台機器等著被重開'],
      right: 1,
    });
    expect(extractQuiz(examples[1]!)).toEqual({
      choices: ['降低影響的嚴重程度', '完全消除已發生的影響', '阻止故障本身發生'],
      right: 0,
    });
    // 規則寫「選項一律用繁體中文」,範例自己不能帶頭違規。
    for (const example of examples) {
      expect(extractQuiz(example)!.choices.join('')).not.toMatch(/[a-z]/i);
    }
  });
});
