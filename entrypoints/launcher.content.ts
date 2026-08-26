type LauncherMessage = { type: 'highlightState'; active: boolean };

export default defineContentScript({
  matches: ['<all_urls>'],

  main() {
    const mascot = mountMascot(async () => {
      const active = await browser.runtime.sendMessage({ type: 'toggleHighlightFromMascot' });
      return active === true;
    }, browser.runtime.getURL('/icons/128.png'));

    const onMessage = (message: LauncherMessage) => {
      if (message.type === 'highlightState') mascot.setActive(message.active);
    };
    browser.runtime.onMessage.addListener(onMessage);
  },
});

export function mountMascot(toggle: () => Promise<boolean>, iconUrl: string) {
  const host = document.createElement('div');
  host.id = 'wordtiger-mascot-launcher';
  host.style.cssText = 'all: initial; position: fixed; right: 18px; bottom: 88px; width: 50px; height: 50px; z-index: 2147483646;';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      button {
        all: unset; box-sizing: border-box; width: 50px; height: 50px; display: grid;
        place-items: center; cursor: grab; border-radius: 50%; touch-action: none;
        background: rgba(255,255,255,.9); border: 1px solid rgba(148,163,184,.4);
        box-shadow: 0 8px 24px rgba(15,23,42,.18), 0 2px 6px rgba(15,23,42,.1);
        backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
        transition: transform 120ms ease-out, box-shadow 180ms ease, background 180ms ease;
        animation: arrive 280ms cubic-bezier(.2,.8,.2,1);
      }
      button:hover { transform: translateY(-2px); box-shadow: 0 12px 28px rgba(15,23,42,.22), 0 3px 8px rgba(15,23,42,.12); }
      button:active { transform: scale(.92); transition-duration: 80ms; }
      button[data-dragging="true"] { cursor: grabbing; transform: scale(1.04); transition: none; }
      button:focus-visible { outline: 3px solid #2563eb; outline-offset: 3px; }
      button[aria-pressed="true"] {
        background: rgba(255,247,237,.96);
        box-shadow: 0 0 0 3px rgba(245,158,11,.3), 0 10px 28px rgba(245,158,11,.28);
      }
      button[aria-pressed="true"] img { animation: wake 520ms cubic-bezier(.2,.8,.2,1); }
      button[aria-busy="true"] img { opacity: .65; }
      button[data-error="true"] { box-shadow: 0 0 0 3px rgba(220,38,38,.25), 0 8px 24px rgba(15,23,42,.18); }
      img { width: 34px; height: 34px; border-radius: 8px; pointer-events: none; }
      @keyframes arrive { from { opacity: 0; transform: translateY(8px) scale(.9); } }
      @keyframes wake {
        30% { transform: translateY(-6px) rotate(-7deg) scale(1.12); }
        62% { transform: translateY(1px) rotate(5deg) scale(1.06,.9); }
      }
      @media (prefers-reduced-motion: reduce) {
        button, button img { animation: none !important; transition: none !important; }
      }
      @media (prefers-reduced-transparency: reduce) {
        button { background: #fff; backdrop-filter: none; -webkit-backdrop-filter: none; }
      }
      @media (prefers-contrast: more) { button { border: 2px solid currentColor; } }
      @media (prefers-color-scheme: dark) {
        button { background: rgba(15,23,42,.92); border-color: rgba(203,213,225,.45); }
        button[aria-pressed="true"] { background: rgba(67,45,16,.96); }
      }
    </style>
    <button type="button" aria-pressed="false"><img src="${iconUrl}" alt=""></button>
  `;
  const button = shadow.querySelector<HTMLButtonElement>('button')!;
  let pending = false;
  let suppressClick = false;
  let dragAbort: AbortController | undefined;

  const setActive = (active: boolean) => {
    button.ariaPressed = String(active);
    button.ariaLabel = active ? '關閉攔詞虎生詞標示' : '開啟攔詞虎生詞標示';
    button.title = `${button.ariaLabel}（Alt+U）`;
  };
  setActive(false);

  button.addEventListener('click', async () => {
    if (suppressClick) return;
    if (pending) return;
    pending = true;
    button.ariaBusy = 'true';
    delete button.dataset.error;
    try {
      setActive(await toggle());
    } catch (error) {
      button.dataset.error = 'true';
      button.title = `切換失敗：${error instanceof Error ? error.message : String(error)}`;
    } finally {
      pending = false;
      button.ariaBusy = 'false';
    }
  });

  button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    dragAbort?.abort();
    dragAbort = new AbortController();

    const box = host.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    let left = box.left;
    let top = box.top;
    let dragging = false;

    const move = (next: PointerEvent) => {
      const dx = next.clientX - startX;
      const dy = next.clientY - startY;
      if (!dragging && Math.hypot(dx, dy) < 10) return;
      if (!dragging) {
        dragging = true;
        suppressClick = true;
        button.dataset.dragging = 'true';
        host.style.left = `${box.left}px`;
        host.style.top = `${box.top}px`;
        host.style.right = 'auto';
        host.style.bottom = 'auto';
      }
      left = Math.max(8, Math.min(box.left + dx, window.innerWidth - box.width - 8));
      top = Math.max(8, Math.min(box.top + dy, window.innerHeight - box.height - 8));
      host.style.transform = `translate3d(${left - box.left}px, ${top - box.top}px, 0)`;
    };
    const finish = (next?: PointerEvent) => {
      if (next) move(next);
      dragAbort?.abort();
      dragAbort = undefined;
      delete button.dataset.dragging;
      if (!dragging) return;
      host.style.left = `${left}px`;
      host.style.top = `${top}px`;
      host.style.transform = '';
      setTimeout(() => { suppressClick = false; }, 0);
    };

    window.addEventListener('pointermove', move, { signal: dragAbort.signal });
    window.addEventListener('pointerup', finish, { once: true, signal: dragAbort.signal });
    window.addEventListener('pointercancel', () => finish(), {
      once: true, signal: dragAbort.signal,
    });
  });

  document.body.appendChild(host);
  return {
    host, button, setActive,
    destroy: () => {
      dragAbort?.abort();
      host.remove();
    },
  };
}
