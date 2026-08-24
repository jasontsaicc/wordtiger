import { describe, it, expect } from 'vitest';
import { renderCardHtml } from './card';

describe('renderCardHtml', () => {
  it('有標題時畫標題那一行', () => {
    const html = renderCardHtml({ title: 'deploy', body: '部署' });
    expect(html).toContain('class="title"');
    expect(html).toContain('deploy');
  });

  it('標題是空字串時不畫標題,漸進揭露的第一層靠這個', () => {
    const html = renderCardHtml({ title: '', body: '部署' });
    expect(html).not.toContain('class="title"');
    expect(html).toContain('部署');
  });

  it('marked 時標題加上 marked class', () => {
    const html = renderCardHtml({ title: 'deploy', body: '部署', marked: true });
    expect(html).toContain('marked');
  });

  it('沒給 hint 就不畫提示行', () => {
    expect(renderCardHtml({ title: 'a', body: 'b' })).not.toContain('class="hint"');
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

  it('保留換行字元,文法分析是多行的', () => {
    const html = renderCardHtml({ title: '', body: '・第一點\n・第二點' });
    expect(html).toContain('\n');
  });
});
