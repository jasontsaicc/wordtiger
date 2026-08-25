import { renderMarkdown, escapeHtml } from './markdown';

export interface CardOptions {
  /** 空字串代表不畫標題 */
  title: string;
  /** 當成 Markdown 渲染。內容來自 AI,渲染器負責跳脫 */
  body: string;
  rect: DOMRect;
  hint?: string;
  marked?: boolean;
  loading?: boolean;
  onClose?: () => void;
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
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; pointer-events: none;';
  root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      .card {
        box-sizing: border-box; width: min(420px, calc(100vw - 24px));
        padding: 14px 16px 12px; pointer-events: auto;
        font: 14px/1.65 ui-sans-serif, system-ui, -apple-system, sans-serif;
        color: #172033; background: rgba(255,255,255,.96);
        border: 1px solid rgba(148,163,184,.35); border-radius: 14px;
        box-shadow: 0 18px 50px rgba(15,23,42,.22), 0 2px 8px rgba(15,23,42,.08);
        backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px);
        animation: enter 120ms ease-out;
      }
      .header { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
      .title { min-width: 0; flex: 1; color: #111827; font-size: 18px; font-weight: 750; letter-spacing: -.02em; }
      .close { width: 26px; height: 26px; padding: 0; color: #64748b; background: #f1f5f9; border: 0; border-radius: 50%; cursor: pointer; font: 18px/24px system-ui; }
      .close:hover { color: #111827; background: #e2e8f0; }
      /* 查詞是整份 Markdown,會很長,一定要能捲 */
      .body { max-height: min(60vh, 520px); overflow-y: auto; scrollbar-width: thin; }
      /* 以下對應 renderMarkdown 產出的那幾個標籤 */
      .body p { margin: 0 0 6px; }
      .body ul { margin: 0 0 6px; padding-left: 18px; }
      .body li { margin: 1px 0; }
      .body strong { color: #111827; }
      .body code {
        color: #4338ca; background: #eef2ff; border-radius: 4px;
        padding: 0 3px; font-family: ui-monospace, monospace; font-size: 13px;
      }
      .body .h {
        font-weight: 700; color: #4f46e5;
        margin: 10px 0 3px; font-size: 13px;
      }
      .body .h:first-child { margin-top: 0; }
      .hint { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 10px; color: #64748b; font-size: 11px; }
      .hint span { padding: 2px 7px; border: 1px solid #e2e8f0; border-radius: 999px; background: #f8fafc; }
      .marked { color: #e11d48; }
      .loading .body { color: #64748b; }
      .loading .body::before { content: ''; display: inline-block; width: 10px; height: 10px; margin-right: 8px; border: 2px solid #c7d2fe; border-top-color: #4f46e5; border-radius: 50%; animation: spin .7s linear infinite; }
      .error .body { color: #b91c1c; }
      @keyframes enter { from { opacity: 0; transform: translateY(-4px) scale(.99); } }
      @keyframes spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) { .card, .loading .body::before { animation: none; } }
      @media (prefers-color-scheme: dark) {
        .card { color: #dbe4f0; background: rgba(15,23,42,.96); border-color: rgba(148,163,184,.25); }
        .title, .body strong { color: #f8fafc; }
        .body .h, .body code { color: #c7d2fe; }
        .body code, .close, .hint span { background: #1e293b; }
        .close { color: #cbd5e1; }
        .hint span { border-color: #334155; }
      }
    </style>
    <div class="card" role="dialog" aria-live="polite"></div>
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
    parts.push(`<div class="header"><div class="${cls}">${escapeHtml(opts.title)}</div><button class="close" type="button" aria-label="關閉">×</button></div>`);
  }
  parts.push(`<div class="body">${renderMarkdown(opts.body)}</div>`);
  if (opts.hint) {
    parts.push(`<div class="hint">${opts.hint.split(' · ').map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>`);
  }

  return parts.join('');
}

export function showCard(opts: CardOptions): void {
  const shadow = ensureRoot();
  const card = shadow.querySelector('.card')!;

  card.innerHTML = renderCardHtml(opts);
  card.classList.toggle('loading', Boolean(opts.loading));
  card.classList.toggle('error', opts.body.startsWith('查詢失敗'));
  card.querySelector('.close')?.addEventListener('click', () => {
    hideCard();
    opts.onClose?.();
  }, { once: true });

  host!.style.display = 'block';
  host!.style.visibility = 'hidden';
  const box = card.getBoundingClientRect();
  const left = Math.max(12, Math.min(opts.rect.left, window.innerWidth - box.width - 12));
  const below = opts.rect.bottom + 10;
  const top = below + box.height <= window.innerHeight - 12
    ? below
    : Math.max(12, opts.rect.top - box.height - 10);
  host!.style.left = `${left}px`;
  host!.style.top = `${top}px`;
  host!.style.visibility = 'visible';
}

export function hideCard(): void {
  if (host) host.style.display = 'none';
}
