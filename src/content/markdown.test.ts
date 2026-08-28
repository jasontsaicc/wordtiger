import { describe, it, expect } from 'vitest';
import { renderMarkdown, escapeHtml } from './markdown';

describe('escapeHtml', () => {
  it('跳脫五個危險字元', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });

  it('& 只被跳脫一次,不會變成 &amp;amp;', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });
});

describe('renderMarkdown 的安全性', () => {
  // 防止未受信任的 AI 輸出造成 XSS。
  it('img onerror 不能變成真的節點', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('script 標籤要被跳脫', () => {
    expect(renderMarkdown('<script>alert(1)</script>')).not.toContain('<script');
  });

  it('粗體裡面藏標籤也不行', () => {
    const html = renderMarkdown('**<img src=x onerror=alert(1)>**');
    expect(html).toContain('<strong>');
    expect(html).not.toContain('<img');
  });

  it('標題裡面藏標籤也不行', () => {
    expect(renderMarkdown('## <svg onload=alert(1)>')).not.toContain('<svg');
  });

  it('清單項目裡面藏標籤也不行', () => {
    expect(renderMarkdown('- <iframe src=javascript:alert(1)>')).not.toContain('<iframe');
  });

  it('輸出裡的標籤只有白名單那幾種', () => {
    const html = renderMarkdown('## 標題\n- **項目** `code`\n段落');
    const tags = [...html.matchAll(/<(\/?\w+)/g)].map((m) => m[1]!.replace('/', ''));
    for (const tag of tags) {
      expect(['div', 'ul', 'li', 'p', 'span', 'strong', 'code']).toContain(tag);
    }
  });

  it('教學行裡的 HTML 也只當文字', () => {
    const html = renderMarkdown('卡點｜<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

describe('renderMarkdown 的排版', () => {
  it('## 標題變成 h 那一層', () => {
    expect(renderMarkdown('## 詞性與釋義')).toBe('<div class="h">詞性與釋義</div>');
  });

  it('連續的 - 收成同一個 ul', () => {
    const html = renderMarkdown('- 一\n- 二');
    expect(html).toBe('<ul><li>一</li><li>二</li></ul>');
  });

  it('空行把清單斷開成兩組', () => {
    const html = renderMarkdown('- 一\n\n- 二');
    expect(html).toBe('<ul><li>一</li></ul><ul><li>二</li></ul>');
  });

  it('粗體和行內程式碼', () => {
    expect(renderMarkdown('**deploy** 用 `kubectl`')).toBe(
      '<p><strong>deploy</strong> 用 <code>kubectl</code></p>',
    );
  });

  it('段落內的換行保留成 br,文法分析是多行的', () => {
    expect(renderMarkdown('・第一點\n・第二點')).toBe('<p>・第一點<br>・第二點</p>');
  });

  it('固定教學標籤形成可掃讀的語意行', () => {
    const html = renderMarkdown([
      '意思｜只有操作具備冪等性時，才能重試請求。',
      '卡點｜only if 表示必要條件。',
    ].join('\n'));
    expect(html).toContain('class="coach coach-meaning"');
    expect(html).toContain('<span class="coach-label">意思</span>');
    expect(html).toContain('class="coach coach-stumble"');
  });

  it('拆法顯示意義區塊,帶走內容分出英文句型與中文提示', () => {
    const html = renderMarkdown([
      '拆法｜A request / can be retried / only if the operation is idempotent',
      '帶走｜only if + condition｜只有在某條件成立時',
    ].join('\n'));
    expect(html).toContain('<span class="coach-separator" aria-hidden="true">›</span>');
    expect(html).toContain('<span class="coach-pattern">only if + condition</span>');
    expect(html).toContain('<span class="coach-note">只有在某條件成立時</span>');
  });

  it('模型自作主張包的 code fence 直接丟掉', () => {
    expect(renderMarkdown('```markdown\n## 標題\n```')).toBe('<div class="h">標題</div>');
  });

  it('純文字不會被加料', () => {
    expect(renderMarkdown('查詢中…')).toBe('<p>查詢中…</p>');
  });

  it('空字串回空字串', () => {
    expect(renderMarkdown('')).toBe('');
  });
});
