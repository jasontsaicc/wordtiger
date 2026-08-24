export interface CardOptions {
  /** 空字串代表不畫標題,漸進揭露的第一層用這個 */
  title: string;
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
      /* 文法分析是多行的,白空白要保留,太長要能捲 */
      .body { white-space: pre-wrap; max-height: 40vh; overflow-y: auto; }
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
  parts.push(`<div class="body">${escapeHtml(opts.body)}</div>`);
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

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
