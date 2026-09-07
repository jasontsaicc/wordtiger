import { describe, it, expect } from 'vitest';
import { chooseCardPlacement, hideCard, renderCardHtml, showCard } from './card';

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

  it('揭曉的對錯回饋走自己的區塊,不進 Markdown', () => {
    const html = renderCardHtml({
      title: 'slam', body: '## 詞性與釋義',
      verdict: { kind: 'wrong', text: '✗ 答錯了。你猜「甲」,正解是「乙」。' },
    });

    expect(html).toContain('<div class="verdict wrong">');
    expect(html).toContain('答錯了');
    // 回饋排在本文之上。
    expect(html.indexOf('verdict')).toBeLessThan(html.indexOf('class="body"'));
  });

  it('回饋文字照樣跳脫,選項內容是模型產的', () => {
    const html = renderCardHtml({
      title: 'slam', body: '本文',
      verdict: { kind: 'right', text: '✓ 答對了！正解是「<img src=x>」。' },
    });

    expect(html).toContain('&lt;img src=x&gt;');
    expect(html).not.toContain('<img src=x>');
  });

  it('沒有題目時不畫回饋區塊', () => {
    expect(renderCardHtml({ title: 'slam', body: '本文' })).not.toContain('verdict');
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

  it('給了 onRetry 才畫重試鈕,非 AI 卡片不該出現', () => {
    const opts = { title: 'deploy', body: '部署' };
    expect(renderCardHtml(opts)).not.toContain('class="retry"');
    expect(renderCardHtml({ ...opts, onRetry: () => {} })).toContain('class="retry"');
  });

  it('載入中的重試鈕要 disabled,不然連點會開兩條 stream', () => {
    const html = renderCardHtml({ title: 'a', body: 'b', loading: true, onRetry: () => {} });
    expect(html).toMatch(/class="retry"[^>]*disabled/);
  });

  it('有選項時渲染三個按鈕,沒有就不畫', () => {
    expect(renderCardHtml({ title: 'a', body: 'b' })).not.toContain('class="quiz"');
    const html = renderCardHtml({ title: 'a', body: 'b', choices: ['甲', '乙', '丙'] });
    expect(html).toContain('class="quiz"');
    expect((html.match(/class="quiz-choice"/g) ?? []).length).toBe(3);
    expect(html).toContain('甲');
    expect(html).toContain('乙');
    expect(html).toContain('丙');
    expect(html).toContain('data-position="0"');
    expect(html).toContain('data-position="1"');
    expect(html).toContain('data-position="2"');
  });

  it('選項按鈕的文字要跳脫,不能真的變成節點', () => {
    const html = renderCardHtml({
      title: '', body: 'b', choices: ['<img src=x onerror=alert(1)>', '乙', '丙'],
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

describe('showCard fullscreen placement', () => {
  it('進入與離開 fullscreen 時把卡片 host 重掛到正確容器', () => {
    const fullscreen = document.createElement('div');
    document.body.appendChild(fullscreen);
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: null,
    });

    showCard({ title: '', body: '卡片', rect: new DOMRect() });
    const host = document.body.lastElementChild!;
    expect(host.parentElement).toBe(document.body);

    Object.defineProperty(document, 'fullscreenElement', { value: fullscreen });
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(host.parentElement).toBe(fullscreen);

    Object.defineProperty(document, 'fullscreenElement', { value: null });
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(host.parentElement).toBe(document.body);

    hideCard();
    host.remove();
    fullscreen.remove();
  });
});
