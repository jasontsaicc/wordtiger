import { renderMarkdown, escapeHtml } from './markdown';

export interface CardOptions {
  /** 空字串代表不畫標題 */
  title: string;
  /** 當成 Markdown 渲染。內容來自 AI,渲染器負責跳脫 */
  body: string;
  rect: DOMRect;
  hint?: string;
  marked?: boolean;
}

let host: HTMLDivElement | null = null;
let root: ShadowRoot | null = null;

/**
 * 卡片是唯一一個被插進網頁的節點,而且掛在 body 底下不碰正文。
 * 用 Shadow DOM 隔離樣式,不然要寫幾十 KB 的防禦性 CSS 去對抗各網站的樣式。
 */
function ensureRoot(): ShadowRoot {
  if (root) return root;
  host = document.createElement('div');
  host.style.cssText = 'all: initial; position: absolute; z-index: 2147483647;';
  root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      .card {
        font: 14px/1.6 system-ui, sans-serif;
        background: #1f1f22; color: #f0f0f2;
        border-radius: 6px; padding: 8px 10px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.3);
        max-width: 380px;
      }
      .title { font-weight: 600; margin-bottom: 2px; }
      /* 查詞是整份 Markdown,會很長,一定要能捲 */
      .body { max-height: 60vh; overflow-y: auto; }
      /* 以下對應 renderMarkdown 產出的那幾個標籤 */
      .body p { margin: 0 0 6px; }
      .body ul { margin: 0 0 6px; padding-left: 18px; }
      .body li { margin: 1px 0; }
      .body strong { color: #fff; }
      .body code {
        background: #333338; border-radius: 3px;
        padding: 0 3px; font-family: ui-monospace, monospace; font-size: 13px;
      }
      .body .h {
        font-weight: 600; color: #c8c0ff;
        margin: 10px 0 3px; font-size: 13px;
      }
      .body .h:first-child { margin-top: 0; }
      .hint { opacity: 0.5; font-size: 12px; margin-top: 6px; }
      .marked { color: #c8c0ff; }
    </style>
    <div class="card"></div>
  `;
  document.body.appendChild(host);
  return root;
}

/**
 * 產卡片的 HTML。純函式,不碰 DOM 狀態,所以測得到。
 * body 來自 AI,一定要跳脫。
 */
export function renderCardHtml(opts: Omit<CardOptions, 'rect'>): string {
  const parts: string[] = [];

  if (opts.title) {
    const cls = opts.marked ? 'title marked' : 'title';
    parts.push(`<div class="${cls}">${escapeHtml(opts.title)}</div>`);
  }
  parts.push(`<div class="body">${renderMarkdown(opts.body)}</div>`);
  if (opts.hint) {
    parts.push(`<div class="hint">${escapeHtml(opts.hint)}</div>`);
  }

  return parts.join('');
}

export function showCard(opts: CardOptions): void {
  const shadow = ensureRoot();
  const card = shadow.querySelector('.card')!;

  card.innerHTML = renderCardHtml(opts);

  host!.style.left = `${opts.rect.left + window.scrollX}px`;
  host!.style.top = `${opts.rect.bottom + window.scrollY + 4}px`;
  host!.style.display = 'block';
}

export function hideCard(): void {
  if (host) host.style.display = 'none';
}
