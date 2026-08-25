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
  celebrate?: boolean;
  onClose?: () => void;
}

let host: HTMLDivElement | null = null;
let root: ShadowRoot | null = null;
let placement: 'right' | 'left' | 'below' | 'above' | null = null;
let anchor: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'> | null = null;
let dragged = false;
let wasLoading = false;
let dragAbort: AbortController | null = null;

const GAP = 10;
const MARGIN = 12;

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
        position: relative; overflow: hidden; padding: 14px 16px 12px; pointer-events: auto;
        font: 14px/1.65 ui-sans-serif, system-ui, -apple-system, sans-serif;
        color: #172033; background: rgba(255,255,255,.96);
        border: 1px solid rgba(148,163,184,.35); border-radius: 14px;
        box-shadow: 0 18px 50px rgba(15,23,42,.22), 0 2px 8px rgba(15,23,42,.08);
        backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px);
        animation: enter 120ms ease-out;
      }
      .card::before { content: ''; position: absolute; inset: 0 0 auto; height: 3px; background: linear-gradient(90deg, #f59e0b 0%, #fb7185 25%, #22d3ee 50%, #f59e0b 75%, #22d3ee 100%); background-size: 200% 100%; opacity: .7; }
      .header { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; cursor: grab; touch-action: none; user-select: none; }
      .dragging { transform: scale(1.01); box-shadow: 0 24px 64px rgba(15,23,42,.28), 0 4px 12px rgba(15,23,42,.12); }
      .dragging .header { cursor: grabbing; }
      .brand { width: 28px; height: 28px; flex: 0 0 auto; border-radius: 7px; opacity: .92; transform-origin: 50% 85%; filter: drop-shadow(0 3px 4px rgba(245,158,11,.18)); will-change: transform, filter; }
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
      .card:not(.loading):not(.complete):not(.celebrate) .header:hover .brand { animation: hello 520ms cubic-bezier(.2,.8,.2,1); }
      .loading::before { animation: stripe 1.1s linear infinite; }
      .loading .brand { animation: hunt 880ms ease-in-out infinite; }
      .complete, .celebrate { animation: card-pop 560ms cubic-bezier(.2,.8,.2,1); }
      .complete::before, .celebrate::before { animation: stripe 480ms linear 2; }
      .complete .brand, .celebrate .brand { animation: caught 620ms cubic-bezier(.2,.8,.2,1); }
      .dragging .brand { animation: none; transform: scale(.88) rotate(-5deg); filter: drop-shadow(0 6px 8px rgba(245,158,11,.38)); }
      .error .body { color: #b91c1c; }
      @keyframes enter { from { opacity: 0; transform: translateY(-4px) scale(.99); } }
      @keyframes hello { 30% { transform: translateY(-4px) rotate(-7deg) scale(1.1); } 60% { transform: translateY(1px) rotate(5deg) scale(1.04,.92); } }
      @keyframes hunt {
        0%, 100% { transform: translateY(0) rotate(-3deg); }
        18% { transform: translateY(2px) rotate(-5deg) scale(1.08,.9); }
        48% { transform: translate(3px,-7px) rotate(7deg) scale(.96,1.1); filter: drop-shadow(-3px 7px 6px rgba(245,158,11,.34)); }
        68% { transform: translateY(1px) rotate(-2deg) scale(1.12,.86); }
        82% { transform: translateY(-2px) rotate(2deg) scale(.98,1.04); }
      }
      @keyframes caught {
        30% { transform: translate(-3px,-8px) rotate(-9deg) scale(1.18); filter: drop-shadow(4px 8px 7px rgba(245,158,11,.42)); }
        55% { transform: translate(3px,1px) rotate(6deg) scale(1.12,.84); }
        76% { transform: translate(-1px,-3px) rotate(-4deg) scale(.98,1.08); }
      }
      @keyframes card-pop { 35% { transform: translateY(-2px) scale(1.012); } 65% { transform: translateY(1px) scale(.997); } }
      @keyframes stripe { to { background-position: -200% 0; } }
      @media (prefers-reduced-motion: reduce) { .card, .brand, .card::before { animation: none !important; } }
      @media (prefers-reduced-transparency: reduce) { .card { background: #fff; backdrop-filter: none; -webkit-backdrop-filter: none; } }
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
  root.addEventListener('pointerdown', (event) => startDrag(event as PointerEvent));
  document.body.appendChild(host);
  return root;
}

export function chooseCardPlacement(
  rect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
): 'right' | 'left' | 'below' | 'above' {
  const right = viewport.width - rect.right - GAP - MARGIN;
  const left = rect.left - GAP - MARGIN;
  const below = viewport.height - rect.bottom - GAP - MARGIN;
  const above = rect.top - GAP - MARGIN;

  if (right >= card.width) return 'right';
  if (left >= card.width) return 'left';
  if (below >= card.height) return 'below';
  if (above >= card.height) return 'above';
  return below >= above ? 'below' : 'above';
}

/**
 * 產卡片的 HTML。純函式,不碰 DOM 狀態,所以測得到。
 * body 來自 AI,一定要跳脫。
 */
export function renderCardHtml(opts: Omit<CardOptions, 'rect'>): string {
  const parts: string[] = [];

  if (opts.title) {
    const cls = opts.marked ? 'title marked' : 'title';
    const icon = browser.runtime.getURL('/icons/32.png');
    parts.push(`<div class="header"><img class="brand" src="${icon}" alt="" aria-hidden="true"><div class="${cls}">${escapeHtml(opts.title)}</div><button class="close" type="button" aria-label="關閉">×</button></div>`);
  }
  parts.push(`<div class="body">${renderMarkdown(opts.body)}</div>`);
  if (opts.hint) {
    parts.push(`<div class="hint">${opts.hint.split(' · ').map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>`);
  }

  return parts.join('');
}

export function showCard(opts: CardOptions): void {
  const shadow = ensureRoot();
  const card = shadow.querySelector<HTMLElement>('.card')!;
  const loading = Boolean(opts.loading);
  const sameAnchor = anchor
    && anchor.left === opts.rect.left && anchor.right === opts.rect.right
    && anchor.top === opts.rect.top && anchor.bottom === opts.rect.bottom;

  if (!sameAnchor || (loading && !wasLoading)) {
    anchor = opts.rect;
    placement = null;
    dragged = false;
  }

  card.innerHTML = renderCardHtml(opts);
  card.classList.toggle('loading', loading);
  card.classList.toggle('complete', wasLoading && !loading && !opts.body.startsWith('查詢失敗'));
  card.classList.toggle('celebrate', Boolean(opts.celebrate));
  card.classList.toggle('error', opts.body.startsWith('查詢失敗'));
  card.querySelector('.close')?.addEventListener('click', () => {
    hideCard();
    opts.onClose?.();
  }, { once: true });

  host!.style.display = 'block';
  host!.style.visibility = 'hidden';
  positionCard(card, opts.rect, loading);
  host!.style.visibility = 'visible';
  wasLoading = loading;
}

export function hideCard(): void {
  dragAbort?.abort();
  dragAbort = null;
  root?.querySelector('.card')?.classList.remove('dragging');
  if (host) host.style.display = 'none';
  placement = null;
  anchor = null;
  dragged = false;
  wasLoading = false;
}

function positionCard(card: HTMLElement, rect: DOMRect, loading: boolean): void {
  const firstBox = card.getBoundingClientRect();
  const placementBox = loading
    ? { width: firstBox.width, height: Math.max(firstBox.height, Math.min(400, window.innerHeight - MARGIN * 2)) }
    : firstBox;
  placement ??= chooseCardPlacement(rect, placementBox, {
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const body = card.querySelector<HTMLElement>('.body')!;
  body.style.maxHeight = '';
  const boxBeforeCap = card.getBoundingClientRect();
  const chromeHeight = boxBeforeCap.height - body.getBoundingClientRect().height;
  const verticalRoom = placement === 'below'
    ? window.innerHeight - rect.bottom - GAP - MARGIN
    : placement === 'above'
      ? rect.top - GAP - MARGIN
      : window.innerHeight - MARGIN * 2;
  body.style.maxHeight = `${Math.max(48, Math.min(520, verticalRoom - chromeHeight))}px`;

  const box = card.getBoundingClientRect();
  if (dragged) {
    const current = host!.getBoundingClientRect();
    host!.style.left = `${clamp(current.left, MARGIN, window.innerWidth - box.width - MARGIN)}px`;
    host!.style.top = `${clamp(current.top, MARGIN, window.innerHeight - box.height - MARGIN)}px`;
    host!.style.bottom = 'auto';
    return;
  }

  host!.style.transition = 'none';
  host!.style.right = 'auto';
  const left = placement === 'right'
    ? rect.right + GAP
    : placement === 'left'
      ? rect.left - box.width - GAP
      : clamp(rect.left, MARGIN, window.innerWidth - box.width - MARGIN);
  host!.style.left = `${left}px`;

  if (placement === 'above') {
    host!.style.top = 'auto';
    host!.style.bottom = `${window.innerHeight - rect.top + GAP}px`;
  } else {
    const top = placement === 'below'
      ? rect.bottom + GAP
      : clamp(rect.top, MARGIN, window.innerHeight - box.height - MARGIN);
    host!.style.top = `${top}px`;
    host!.style.bottom = 'auto';
  }
}

function startDrag(event: PointerEvent): void {
  const target = event.target as HTMLElement;
  const header = target.closest<HTMLElement>('.header');
  if (!host || !header || target.closest('button') || event.button !== 0) return;

  event.preventDefault();
  header.setPointerCapture(event.pointerId);
  dragAbort?.abort();
  dragAbort = new AbortController();

  const card = root!.querySelector<HTMLElement>('.card')!;
  const box = card.getBoundingClientRect();
  const offsetX = event.clientX - box.left;
  const offsetY = event.clientY - box.top;
  dragged = true;
  card.classList.add('dragging');
  host.style.transition = 'none';
  host.style.left = `${box.left}px`;
  host.style.top = `${box.top}px`;
  host.style.bottom = 'auto';

  const move = (next: PointerEvent) => {
    host!.style.left = `${clamp(next.clientX - offsetX, MARGIN, window.innerWidth - box.width - MARGIN)}px`;
    host!.style.top = `${clamp(next.clientY - offsetY, MARGIN, window.innerHeight - box.height - MARGIN)}px`;
  };
  const finish = () => {
    dragAbort?.abort();
    dragAbort = null;
    card.classList.remove('dragging');
    const left = Number.parseFloat(host!.style.left);
    const right = window.innerWidth - box.width - MARGIN;
    const snap = left - MARGIN < 36 ? MARGIN : right - left < 36 ? right : left;
    host!.style.transition = matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'none'
      : 'left 180ms cubic-bezier(.2,.8,.2,1)';
    host!.style.left = `${snap}px`;
  };

  window.addEventListener('pointermove', move, { signal: dragAbort.signal });
  window.addEventListener('pointerup', finish, { once: true, signal: dragAbort.signal });
  window.addEventListener('pointercancel', finish, { once: true, signal: dragAbort.signal });
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}
