import { describe, it, expect } from 'vitest';
import { renderTemplate, extractTakeaway, DEFAULT_TEMPLATES, SYSTEM_RULES } from './prompt';

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
    expect(SYSTEM_RULES.grammar).toContain('必須加一行「帶走｜');
    expect(SYSTEM_RULES.grammar).toContain('英文欄不可含中文');
    expect(SYSTEM_RULES.grammar).toContain('用法｜');
    expect(SYSTEM_RULES.grammar).toContain('例句｜');
  });

  it('片語詞典要求使用場景與搭配限制', () => {
    expect(SYSTEM_RULES.lookup).toContain('多字片語');
    expect(SYSTEM_RULES.lookup).toContain('## 使用場景');
    expect(SYSTEM_RULES.lookup).toContain('不適用情況');
  });
});
