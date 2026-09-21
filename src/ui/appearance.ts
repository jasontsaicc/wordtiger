export interface Appearance {
  theme: 'system' | 'day' | 'night';
  reducedMotion: boolean;
}

/** Separate keys keep appearance updates away from AI settings and credentials. */
export function observeAppearance(
  target: HTMLElement,
  onChange: (appearance: Appearance) => void = () => {},
  onError: () => void = () => {},
): () => void {
  let disposed = false;
  let values: Record<string, unknown> = {};
  const pending: Record<string, unknown> = {};
  function apply() {
    const theme = values.uiTheme === 'day' || values.uiTheme === 'night' ? values.uiTheme : 'system';
    const reducedMotion = values.uiReducedMotion === true;
    target.dataset.theme = theme;
    target.dataset.motion = reducedMotion ? 'reduce' : 'full';
    onChange({ theme, reducedMotion });
  }
  const changed = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'local' || disposed || !('uiTheme' in changes || 'uiReducedMotion' in changes)) return;
    for (const key of ['uiTheme', 'uiReducedMotion']) {
      if (key in changes) pending[key] = changes[key]?.newValue;
    }
    values = { ...values, ...pending };
    apply();
  };
  browser.storage.onChanged.addListener(changed);
  void browser.storage.local.get(['uiTheme', 'uiReducedMotion']).then((stored) => {
    if (disposed) return;
    // Changes received while get() was pending take precedence over its snapshot.
    values = { ...stored, ...pending };
    apply();
  }).catch(() => { if (!disposed) onError(); });
  return () => { disposed = true; browser.storage.onChanged.removeListener(changed); };
}
