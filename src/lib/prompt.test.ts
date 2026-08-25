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
    // 使用者的句子如果剛好含 {{profile}},不該把 profile 塞進去
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
});

describe('DEFAULT_TEMPLATES', () => {
  it('三個功能都有預設值', () => {
    expect(DEFAULT_TEMPLATES.lookup.length).toBeGreaterThan(0);
    expect(DEFAULT_TEMPLATES.translate.length).toBeGreaterThan(0);
    expect(DEFAULT_TEMPLATES.grammar.length).toBeGreaterThan(0);
  });

  it('查詞 template 必須有 profile、word、sentence 三個 placeholder', () => {
    expect(DEFAULT_TEMPLATES.lookup).toContain('{{profile}}');
    expect(DEFAULT_TEMPLATES.lookup).toContain('{{word}}');
    // 出處句子是一詞多義的消歧義依據,少了它 scale 在 K8s 和音樂文章裡會查到同一個意思
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
    // 這一層存在的理由是保證卡片渲染得出來。內容要求屬於使用者層,可以整段改寫。
    expect(SYSTEM_RULES.lookup).toContain('```');
    expect(SYSTEM_RULES.lookup).toContain('繁體中文');
    // 不該再有 JSON 的字眼,批次查詞已經拿掉了
    expect(SYSTEM_RULES.lookup).not.toContain('JSON');
  });

  it('快速看懂和拆句都有可掃讀的固定行標籤', () => {
    expect(SYSTEM_RULES.translate).toContain('意思｜');
    expect(SYSTEM_RULES.translate).toContain('關鍵｜');
    expect(SYSTEM_RULES.grammar).toContain('拆法｜');
    expect(SYSTEM_RULES.grammar).toContain('白話英文｜');
    expect(SYSTEM_RULES.grammar).toContain('帶走｜');
  });
});
