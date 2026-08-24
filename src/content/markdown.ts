/**
 * 極簡 Markdown 渲染器,只認查詞卡片實際會用到的那幾種語法。
 *
 * 為什麼不用現成套件:卡片會被插進**任何**網頁,AI 回來的內容直接塞 innerHTML
 * 等於在每個你瀏覽的網站上開一個 XSS 洞。marked 加 DOMPurify 要拉兩個相依、
 * 幾十 KB,而卡片只需要粗體、標題、清單三種東西。
 *
 * 安全性靠一條不變式:**先跳脫整行,再在已跳脫的字串上套用行內樣式**。
 * 跳脫之後字串裡不可能再有 `<`,所以輸出裡的標籤只可能是這個檔案自己產的那幾個。
 * 順序反過來就會有洞,改這個檔案時務必守住這一點。
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

/** 只能在已經跳脫過的字串上呼叫。粗體和行內程式碼,其他一律當純文字。 */
function inline(escaped: string): string {
  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
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
    // 段落內的單一換行保留成 <br>。文法分析那種「一點一行」的輸出靠這個。
    out.push(`<p>${para.join('<br>')}</p>`);
    para = [];
  };

  for (const raw of src.split('\n')) {
    const line = raw.trim();

    // 系統層叫模型不要包 code fence,但模型常常還是包。與其讓 ``` 原樣顯示在
    // 卡片上,不如直接丟掉這一行。
    if (line.startsWith('```')) continue;

    if (!line) {
      flushList();
      flushPara();
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
