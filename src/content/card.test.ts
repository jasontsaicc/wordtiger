import { describe, it, expect } from 'vitest';
import { chooseCardPlacement, renderCardHtml } from './card';

describe('chooseCardPlacement', () => {
  it('依序避讓到右、左、下、上方，長卡片仍不壓住觸發位置', () => {
    const card = { width: 420, height: 300 };
    const viewport = { width: 1200, height: 800 };

    expect(chooseCardPlacement({ left: 300, right: 340, top: 300, bottom: 320 }, card, viewport)).toBe('right');
    expect(chooseCardPlacement({ left: 900, right: 940, top: 300, bottom: 320 }, card, viewport)).toBe('left');
    expect(chooseCardPlacement({ left: 390, right: 430, top: 100, bottom: 120 }, card, { width: 800, height: 800 })).toBe('below');
    expect(chooseCardPlacement({ left: 390, right: 430, top: 680, bottom: 700 }, card, { width: 800, height: 800 })).toBe('above');
  });
});

describe('renderCardHtml', () => {
  it('有標題時畫標題那一行', () => {
    const html = renderCardHtml({ title: 'deploy', body: '部署' });
    expect(html).toContain('class="title"');
    expect(html).toContain('class="brand"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('deploy');
  });

  it('標題是空字串時不畫標題,漸進揭露的第一層靠這個', () => {
    const html = renderCardHtml({ title: '', body: '部署' });
    expect(html).not.toContain('class="title"');
    expect(html).not.toContain('class="brand"');
    expect(html).toContain('部署');
  });

  it('marked 時標題加上 marked class', () => {
    const html = renderCardHtml({ title: 'deploy', body: '部署', marked: true });
    expect(html).toContain('marked');
  });

  it('沒給 hint 就不畫提示行', () => {
    expect(renderCardHtml({ title: 'a', body: 'b' })).not.toContain('class="hint"');
  });

  it('快捷鍵提示拆成容易掃讀的標籤', () => {
    const html = renderCardHtml({ title: 'a', body: 'b', hint: 'Space 收藏 · Esc 關閉' });
    expect(html).toContain('<span>Space 收藏</span><span>Esc 關閉</span>');
  });

  it('AI 回傳的 HTML 標籤要被跳脫,不能真的變成節點', () => {
    const html = renderCardHtml({ title: '', body: '<img src=x onerror=alert(1)>' });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('標題也要跳脫', () => {
    const html = renderCardHtml({ title: '<b>x</b>', body: 'y' });
    expect(html).not.toContain('<b>');
  });

  it('多行內容換行成 br,文法分析是多行的', () => {
    const html = renderCardHtml({ title: '', body: '・第一點\n・第二點' });
    expect(html).toContain('・第一點<br>・第二點');
  });

  it('body 走 Markdown 渲染,查詞的整份輸出靠這個', () => {
    const html = renderCardHtml({ title: 'deploy', body: '## 詞性與釋義\n- **部署**' });
    expect(html).toContain('<div class="h">詞性與釋義</div>');
    expect(html).toContain('<strong>部署</strong>');
  });
});
