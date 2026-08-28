/**
 * 僅支援卡片所需 Markdown。
 * 安全不變式：先跳脫完整輸入，再套用受控的行內格式。
 */

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

/** 僅接受已跳脫文字；支援粗體與行內程式碼。 */
function inline(escaped: string): string {
  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

const COACH_CLASSES: Record<string, string> = {
  原文: 'source', 意思: 'meaning', 拆法: 'breakdown',
  關鍵: 'stumble', 卡點: 'stumble', 白話英文: 'plain',
  帶走: 'takeaway', 用法: 'usage', 例句: 'example',
};

function renderCoachLine(line: string): string | null {
  const match = /^(原文|意思|拆法|關鍵|卡點|白話英文|帶走|用法|例句)｜(.*)$/.exec(line);
  if (!match) return null;

  const label = match[1]!;
  const raw = match[2]!;
  let content = inline(escapeHtml(raw));

  if (label === '拆法') {
    content = content.replace(/\s+\/\s+/g, ' <span class="coach-separator" aria-hidden="true">›</span> ');
  } else if (label === '帶走') {
    const separator = raw.indexOf('｜');
    if (separator > 0) {
      const pattern = raw.slice(0, separator).trim();
      const note = raw.slice(separator + 1).trim();
      content = `<span class="coach-pattern">${inline(escapeHtml(pattern))}</span><span class="coach-note">${inline(escapeHtml(note))}</span>`;
    }
  }

  return `<div class="coach coach-${COACH_CLASSES[label]}"><span class="coach-label">${label}</span><span class="coach-content">${content}</span></div>`;
}

export function renderMarkdown(src: string): string {
  const out: string[] = [];
  let list: string[] = [];
  let para: string[] = [];

  const flushList = () => {
    if (list.length === 0) return;
    out.push(`<ul>${list.join('')}</ul>`);
    list = [];
  };
  const flushPara = () => {
    if (para.length === 0) return;
    // 保留段落內換行。
    out.push(`<p>${para.join('<br>')}</p>`);
    para = [];
  };

  for (const raw of src.split('\n')) {
    const line = raw.trim();

    // 忽略模型偶爾加入的外層 code fence。
    if (line.startsWith('```')) continue;

    if (!line) {
      flushList();
      flushPara();
      continue;
    }

    const coach = renderCoachLine(line);
    if (coach) {
      flushList();
      flushPara();
      out.push(coach);
      continue;
    }

    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      flushList();
      flushPara();
      out.push(`<div class="h">${inline(escapeHtml(heading[1]!))}</div>`);
      continue;
    }

    const item = /^[-*]\s+(.*)$/.exec(line);
    if (item) {
      flushPara();
      list.push(`<li>${inline(escapeHtml(item[1]!))}</li>`);
      continue;
    }

    flushList();
    para.push(inline(escapeHtml(line)));
  }

  flushList();
  flushPara();
  return out.join('');
}
