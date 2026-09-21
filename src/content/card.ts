import palette from '@/src/ui/palette.css?inline';
import { observeAppearance } from '@/src/ui/appearance';
import { renderMarkdown, escapeHtml } from './markdown';

export interface CardOptions {
  /** 空字串代表不顯示標題。 */
  title: string;
  /** 以 Markdown 渲染；渲染器負責跳脫 AI 內容。 */
  body: string;
  rect: DOMRect;
  hint?: string;
  marked?: boolean;
  loading?: boolean;
  celebrate?: boolean;
  onClose?: () => void;
  /** 只有 AI 卡片給;沒給就不畫重試鈕。 */
  onRetry?: () => void;
  /** 三選一畫面顯示順序;給了才畫按鈕,只有題目 pending 時才傳。 */
  choices?: [string, string, string];
  /** 點第 i 個按鈕時呼叫,i 是畫面位置索引,不是洗牌前的原始索引。 */
  onPick?: (position: 0 | 1 | 2) => void;
  /** 三選一揭曉後的對錯回饋;放在 body 之上,不進 Markdown。 */
  verdict?: { kind: 'right' | 'wrong' | 'skipped'; text: string };
}

let host: HTMLDivElement | null = null;
let root: ShadowRoot | null = null;
let placement: 'right' | 'left' | 'below' | 'above' | null = null;
let anchor: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'> | null = null;
let dragged = false;
let wasLoading = false;
let dragAbort: AbortController | null = null;
let stopAppearance: (() => void) | null = null;

const GAP = 10;
const MARGIN = 12;

/** Shadow DOM 隔離網站樣式，卡片掛在獨立 host 上。 */
function ensureRoot(): ShadowRoot {
  if (root) return root;
  host = document.createElement('div');
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; pointer-events: none;';
  root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      ${palette}
      /**
       * 一張卡只有一個重點色。區塊分兩層：參考資料給安靜的灰線，
       * 要你帶走的（卡點、帶走、用法、例句）才點亮琥珀。
       */
      .card {
        --ink: var(--wt-ink); --body: var(--wt-body); --muted: var(--wt-muted);
        --surface: var(--wt-surface); --border: var(--wt-line);
        --chip: var(--wt-raised); --chip-border: var(--wt-line); --chip-hover: var(--wt-wash);
        --rail: var(--wt-line); --sep: var(--wt-muted);
        --accent: var(--wt-accent); --accent-ink: var(--wt-accent); --wash: var(--wt-wash);
        --danger: var(--wt-danger);

        box-sizing: border-box; width: min(420px, calc(100vw - 24px));
        position: relative; overflow: hidden; padding: 14px 16px 12px; pointer-events: auto;
        font: 14px/1.65 ui-sans-serif, system-ui, -apple-system, sans-serif;
        color: var(--body); background: var(--surface);
        border: 1px solid var(--border); border-radius: 20px;
        box-shadow: 0 18px 50px rgba(15,23,42,.22), 0 2px 8px rgba(15,23,42,.08);
        backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px);
        animation: enter 120ms ease-out;
      }
      /* 單色琥珀，但保留 200% 寬度讓 stripe 動畫在載入時還跑得動。 */
      .card::before { content: ''; position: absolute; inset: 0 0 auto; height: 3px; background: linear-gradient(90deg, var(--accent), #ffa44f, var(--accent), #ffa44f, var(--accent)); background-size: 200% 100%; }
      .header { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; cursor: grab; touch-action: none; user-select: none; }
      .dragging { transform: scale(1.01); box-shadow: 0 24px 64px rgba(15,23,42,.28), 0 4px 12px rgba(15,23,42,.12); }
      .dragging .header { cursor: grabbing; }
      .brand { width: 28px; height: 28px; flex: 0 0 auto; border-radius: 7px; opacity: .92; transform-origin: 50% 85%; filter: drop-shadow(0 3px 4px rgba(245,158,11,.18)); will-change: transform, filter; }
      .title { min-width: 0; flex: 1; color: var(--ink); font-size: 18px; font-weight: 750; letter-spacing: -.02em; }
      .close, .retry { width: 26px; height: 26px; padding: 0; color: var(--muted); background: var(--chip); border: 0; border-radius: 50%; cursor: pointer; font: 18px/24px system-ui; }
      .close:hover, .retry:not(:disabled):hover { color: var(--ink); background: var(--chip-hover); }
      .retry { font-size: 15px; }
      .retry:disabled { opacity: .4; cursor: default; }
      .retry + .close { margin-left: -6px; }
      .body { max-height: min(60vh, 520px); overflow-y: auto; scrollbar-width: thin; }
      .body p { margin: 0 0 6px; }
      .body ul { margin: 0 0 6px; padding-left: 18px; }
      .body li { margin: 1px 0; }
      .body strong { color: var(--ink); }
      .body code {
        color: var(--accent-ink); background: var(--wash); border-radius: 4px;
        padding: 0 3px; font-family: ui-monospace, monospace; font-size: 13px;
      }
      /* 查詞卡的 ## 標題；延伸細線讓它跟拆句卡的區塊讀起來是同一套。 */
      .body .h {
        display: flex; align-items: center; gap: 7px;
        font-weight: 700; color: var(--accent-ink);
        margin: 10px 0 3px; font-size: 13px;
      }
      .body .h::after { content: ''; flex: 1; height: 1px; background: var(--rail); }
      .body .h:first-child { margin-top: 0; }
      .coach { display: grid; grid-template-columns: 3.5em minmax(0, 1fr); gap: 8px; margin: 0 0 7px; }
      .coach-label { padding-top: 2px; color: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: .04em; }
      .coach-content { min-width: 0; }
      .coach-meaning .coach-content { color: var(--ink); font-size: 15px; font-weight: 650; line-height: 1.55; }
      .coach-source, .coach-breakdown, .coach-plain, .coach-usage, .coach-example {
        padding-left: 10px; border-left: 2px solid var(--rail);
      }
      .coach-separator { margin: 0 .3em; color: var(--sep); }
      .coach-stumble, .coach-takeaway {
        padding: 7px 10px; border-left: 2px solid var(--accent);
        border-radius: 0 8px 8px 0; background: var(--wash);
      }
      .coach-stumble .coach-label, .coach-takeaway .coach-label,
      .coach-usage .coach-label, .coach-example .coach-label { color: var(--accent-ink); }
      .coach-pattern { display: block; color: var(--ink); font-weight: 700; }
      .coach-note { display: block; margin-top: 1px; color: var(--muted); font-size: 12px; }
      .hint { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 10px; color: var(--muted); font-size: 11px; }
      .hint span { padding: 2px 7px; border: 1px solid var(--chip-border); border-radius: 999px; background: var(--chip); }
      .quiz { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
      .quiz-choice {
        padding: 8px 10px; text-align: left; color: var(--body); background: var(--chip);
        border: 1px solid var(--chip-border); border-radius: 8px; cursor: pointer; font: inherit;
      }
      .quiz-choice:hover { background: var(--chip-hover); }
      .quiz-choice:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
      .verdict { margin-bottom: 8px; font-weight: 600; color: var(--muted); }
      .verdict.right { color: var(--accent-ink); }
      .verdict.wrong { color: var(--danger); }
      .marked { color: var(--accent-ink); }
      .loading .body { color: var(--muted); }
      .card:not(.loading):not(.complete):not(.celebrate) .header:hover .brand { animation: hello 520ms cubic-bezier(.2,.8,.2,1); }
      .loading::before { animation: stripe 1.1s linear infinite; }
      .loading .brand { animation: hunt 880ms ease-in-out infinite; }
      .complete, .celebrate { animation: card-pop 560ms cubic-bezier(.2,.8,.2,1); }
      .complete::before, .celebrate::before { animation: stripe 480ms linear 2; }
      .complete .brand, .celebrate .brand { animation: caught 620ms cubic-bezier(.2,.8,.2,1); }
      .dragging .brand { animation: none; transform: scale(.88) rotate(-5deg); filter: drop-shadow(0 6px 8px rgba(245,158,11,.38)); }
      .error .body { color: var(--danger); }
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
      @media (prefers-reduced-transparency: reduce) { .card { --surface: var(--wt-surface); backdrop-filter: none; -webkit-backdrop-filter: none; } }
      @media (prefers-contrast: more) {
        .coach-source, .coach-breakdown, .coach-plain, .coach-usage, .coach-example,
        .coach-stumble, .coach-takeaway { border: 1px solid currentColor; }
      }
      :host([data-motion="reduce"]) *, :host([data-motion="reduce"]) *::before { animation: none !important; transition: none !important; }
      .close:focus-visible, .retry:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      .close, .retry { min-width: 30px; min-height: 30px; }
    </style>
    <div class="card" role="dialog" aria-live="polite"></div>
  `;
  root.addEventListener('pointerdown', (event) => startDrag(event as PointerEvent));
  mountHost();
  document.addEventListener('fullscreenchange', mountHost);
  return root;
}

function mountHost(): void {
  if (!host) return;
  (document.fullscreenElement ?? document.body).appendChild(host);
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

/** 渲染卡片 HTML；AI 內容由 renderMarkdown 跳脫。 */
export function renderCardHtml(opts: Omit<CardOptions, 'rect'>): string {
  const parts: string[] = [];

  if (opts.title) {
    const cls = opts.marked ? 'title marked' : 'title';
    const icon = browser.runtime.getURL('/icons/32.png');
    const retry = opts.onRetry
      ? `<button class="retry" type="button" aria-label="重問一次"${opts.loading ? ' disabled' : ''}>↻</button>`
      : '';
    parts.push(`<div class="header"><img class="brand" src="${icon}" alt="" aria-hidden="true"><div class="${cls}">${escapeHtml(opts.title)}</div>${retry}<button class="close" type="button" aria-label="關閉">×</button></div>`);
  }
  if (opts.verdict) {
    parts.push(`<div class="verdict ${opts.verdict.kind}">${escapeHtml(opts.verdict.text)}</div>`);
  }
  parts.push(`<div class="body">${renderMarkdown(opts.body)}</div>`);
  if (opts.choices) {
    parts.push(`<div class="quiz">${opts.choices.map((choice, i) =>
      `<button class="quiz-choice" type="button" data-position="${i}">${escapeHtml(choice)}</button>`,
    ).join('')}</div>`);
  }
  if (opts.hint) {
    parts.push(`<div class="hint">${opts.hint.split(' · ').map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>`);
  }

  return parts.join('');
}

export function showCard(opts: CardOptions): void {
  const shadow = ensureRoot();
  stopAppearance ??= observeAppearance(host!);
  const card = shadow.querySelector<HTMLElement>('.card')!;
  const loading = Boolean(opts.loading);
  const sameAnchor = anchor
    && anchor.left === opts.rect.left && anchor.right === opts.rect.right
    && anchor.top === opts.rect.top && anchor.bottom === opts.rect.bottom;

  // 拖過去的位置是使用者選的,只有換錨點才收回;同錨點重畫(串流、重問)要留在原地。
  if (!sameAnchor) dragged = false;
  if (!sameAnchor || (loading && !wasLoading)) {
    anchor = opts.rect;
    placement = null;
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
  card.querySelector('.retry')?.addEventListener('click', () => opts.onRetry?.(), { once: true });
  card.querySelectorAll<HTMLButtonElement>('.quiz-choice').forEach((btn) => {
    const position = Number(btn.dataset.position) as 0 | 1 | 2;
    btn.addEventListener('click', () => opts.onPick?.(position), { once: true });
  });

  host!.style.display = 'block';
  host!.style.visibility = 'hidden';
  positionCard(card, opts.rect, loading);
  host!.style.visibility = 'visible';
  wasLoading = loading;
}

export function hideCard(): void {
  stopAppearance?.();
  stopAppearance = null;
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
    host!.style.transition = host!.dataset.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches
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
