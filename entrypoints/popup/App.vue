<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AppearanceControls from '@/src/ui/AppearanceControls.vue';
import {
  loadSettings, pageOrigin, saveSettings, type HighlightColors, type Settings,
} from '@/src/lib/settings';

const settings = ref<Settings | null>(null);
const tab = ref<Browser.tabs.Tab | null>(null);
const running = ref(false);
const status = ref('');
const loadError = ref('');
const version = browser.runtime.getManifest().version;

const pagePattern = computed(() => {
  const origin = pageOrigin(tab.value?.url ?? '');
  return origin ? `${origin}/*` : null;
});

const auto = computed(() =>
  !!pagePattern.value && !!settings.value?.autoOrigins.includes(pagePattern.value),
);

const blocked = computed(() => {
  if (!settings.value || !tab.value?.url) return false;
  try {
    const host = new URL(tab.value.url).hostname;
    return settings.value.blockedHosts.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return true;
  }
});

const level1 = computed(() => Math.floor((settings.value?.threshold ?? 0) * 1.5));
const level2 = computed(() => Math.floor((settings.value?.threshold ?? 0) * 2.5));
const highlightTiers = [
  { key: 'saved', label: '收藏' },
  { key: 'learning', label: '程度外' },
  { key: 'advanced', label: '更高階' },
  { key: 'rare', label: '極低頻' },
] as const;
type ColorSetting = 'highlightColors' | 'highlightTextColors' | 'highlightUnderlineColors';

onMounted(async () => {
  try {
    settings.value = await loadSettings();
    [tab.value] = await browser.tabs.query({ active: true, currentWindow: true });
    running.value = await isRunning();
  } catch { loadError.value = '小虎暫時無法讀取設定，請重新開啟。'; }
});

async function isRunning(): Promise<boolean> {
  if (!tab.value?.id || !pagePattern.value) return false;
  try {
    const [result] = await browser.scripting.executeScript({
      target: { tabId: tab.value.id },
      func: () => Boolean((window as unknown as { __wordTigerAbort?: unknown }).__wordTigerAbort),
    });
    return Boolean(result?.result);
  } catch {
    return false;
  }
}

async function toggleHighlight() {
  if (!tab.value?.id || !pagePattern.value || blocked.value) return;
  status.value = '';
  try {
    await browser.scripting.executeScript({
      target: { tabId: tab.value.id, allFrames: true },
      files: ['/content-scripts/highlight.js'],
    });
    running.value = await isRunning();
    await browser.tabs.sendMessage(tab.value.id, {
      type: 'highlightState', active: running.value,
    }).catch(() => {});
  } catch (err) {
    status.value = err instanceof Error ? err.message : String(err);
  }
}

async function toggleAuto(event: Event) {
  if (!settings.value || !pagePattern.value) return;
  const enabled = (event.target as HTMLInputElement).checked;

  if (enabled) {
    settings.value.autoOrigins = [...new Set([...settings.value.autoOrigins, pagePattern.value])];
    status.value = '已開啟；重新載入本頁後會自動標示。';
  } else {
    settings.value.autoOrigins = settings.value.autoOrigins.filter((x) => x !== pagePattern.value);
    status.value = '已關閉這個網站的自動標示。';
  }
  await saveSettings({ autoOrigins: settings.value.autoOrigins });
}

async function saveThreshold() {
  if (settings.value) await saveSettings({ threshold: settings.value.threshold });
  status.value = '門檻已儲存，下次開啟標示時套用。';
}

async function saveColors() {
  if (settings.value) await saveSettings({
    highlightColors: settings.value.highlightColors,
    highlightTextColors: settings.value.highlightTextColors,
    highlightUnderlineColors: settings.value.highlightUnderlineColors,
  });
  status.value = '顏色已儲存，下次開啟標示時套用。';
}

function pickerColor(value: string) {
  return value.slice(0, 7);
}

function setHighlightColor(group: ColorSetting, tier: keyof HighlightColors, event: Event) {
  if (!settings.value) return;
  const rgb = (event.target as HTMLInputElement).value;
  const alpha = settings.value[group][tier].slice(7);
  settings.value[group][tier] = rgb + alpha;
  void saveColors();
}

async function saveConjunctions() {
  if (settings.value) await saveSettings({ markConjunctions: settings.value.markConjunctions });
  status.value = '連詞設定已儲存，下次開啟標示時套用。';
}

async function openOptions() {
  await browser.tabs.create({ url: browser.runtime.getURL('/options.html#settings') });
  window.close();
}

async function openReview() {
  await browser.tabs.create({ url: browser.runtime.getURL('/options.html#review') });
  window.close();
}
</script>

<template>
  <main v-if="loadError" role="alert">{{ loadError }}</main>
  <main v-else-if="settings">
    <header><img src="/icons/128.png" alt="" /><b>攔詞虎</b><span>WordTiger v{{ version }}</span></header>
    <AppearanceControls />
    <p class="site-name">{{ tab?.url && pagePattern ? new URL(tab.url).hostname : '目前頁面不支援標示' }}</p>
    <div class="actions">
      <button class="primary" :aria-pressed="running" :disabled="!pagePattern || blocked" @click="toggleHighlight">
        {{ running ? '關閉本頁標示' : '開啟本頁標示' }}
      </button>
      <button class="review" @click="openReview">今晚打老虎</button>
      <button @click="openOptions">設定與詞庫</button>
    </div>

    <p v-if="blocked" class="warn">目前網站在黑名單內。</p>
    <p class="note">小虎預設在所有一般網頁出現；點一下等同 Alt+U，也可以直接拖開。</p>
    <label class="switch">
      <input type="checkbox" :checked="auto" :disabled="!pagePattern || blocked" @change="toggleAuto" />
      永遠在此網站自動標示
    </label>
    <p class="note">關閉時只在手動開啟標示後存取；開啟後會記住目前網站。</p>

    <details class="highlight-details">
      <summary>高亮樣式與程度</summary>
      <!-- min 對齊 step，否則預設的 10,000 會落在格線外，一拉就跳掉。 -->
      <input class="threshold" type="range" min="2000" max="30000" step="2000"
        v-model.number="settings.threshold" aria-label="高亮詞頻排名門檻"
        @change="saveThreshold" />
      <p class="note">1–{{ settings.threshold.toLocaleString() }} 名不標示；往右拉，亮的字變少。</p>
      <div class="color-head"><span>等級</span><span>背景</span><span>字體</span><span>底線</span></div>
      <div v-for="tier in highlightTiers" :key="tier.key" class="color-row">
        <span>{{ tier.label }}</span>
        <input :value="pickerColor(settings.highlightColors[tier.key])" type="color"
          :aria-label="`${tier.label}背景色`" @change="setHighlightColor('highlightColors', tier.key, $event)" />
        <input :value="pickerColor(settings.highlightTextColors[tier.key])" type="color"
          :aria-label="`${tier.label}字體色`" @change="setHighlightColor('highlightTextColors', tier.key, $event)" />
        <input :value="pickerColor(settings.highlightUnderlineColors[tier.key])" type="color"
          :aria-label="`${tier.label}底線色`" @change="setHighlightColor('highlightUnderlineColors', tier.key, $event)" />
      </div>
      <label class="switch conjunction">
        <input v-model="settings.markConjunctions" type="checkbox" @change="saveConjunctions" />
        連詞標記（點線／雙線）
      </label>
      <p class="note">程度外 {{ (settings.threshold + 1).toLocaleString() }}–{{ level1.toLocaleString() }}；更高階至 {{ level2.toLocaleString() }}。</p>
    </details>

    <section>
      <h2>快捷鍵</h2>
      <div class="keys"><kbd>Alt+U</kbd> 開關　<kbd>A</kbd> 查詞　<kbd>S</kbd> 快速看懂</div>
      <div class="keys"><kbd>D</kbd> 拆懂這句　<kbd>F</kbd> AI 發音　<kbd>Space</kbd> 收藏　<kbd>X</kbd> 已認得　<kbd>Esc</kbd> 關閉</div>
    </section>

    <p v-if="status" class="status" role="status">{{ status }}</p>
  </main>
  <main v-else role="status">小虎準備中…</main>
</template>

<style scoped>
/* Popup auto-sizing needs an intrinsic root width; vw depends on the popup's initial tiny viewport. */
:global(html) { width: 380px; min-width: 380px; overflow: hidden; }
:global(body) { max-height: 600px; overflow-y: auto; overscroll-behavior: contain; }
main { width: 100%; padding: 18px; font-size: 13px; }
header { display: flex; align-items: center; gap: 9px; margin-bottom: 18px; }
header img { width: 40px; height: 40px; filter: drop-shadow(0 4px 8px #13173918); animation: wt-arrive 400ms ease-out; }
header b { font-size: 18px; color: var(--wt-ink); }
header span { margin-left: auto; color: var(--wt-muted); font-size: 11px; }
.site-name { color: var(--wt-muted); font-size: 12px; overflow-wrap: anywhere; margin: 20px 0 10px; }
.actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 18px; }
button.primary { grid-column: 1 / -1; color: var(--wt-on-accent); border-color: var(--wt-accent); background: var(--wt-accent); min-height: 46px; font-weight: 750; }
button.review { color: var(--wt-accent); background: var(--wt-wash); font-weight: 700; }
.switch { display: flex; gap: 8px; align-items: center; margin: 13px 0; font-weight: 600; }
section, details { border-top: 1px solid var(--wt-line); padding-top: 12px; margin-top: 16px; }
summary { cursor: pointer; color: var(--wt-ink); font-weight: 650; padding: 4px 0; }
details[open] summary { margin-bottom: 15px; }
h2 { margin: 0 0 7px; font-size: 13px; }
input[type="color"] { width: 30px; height: 28px; padding: 0; border: 0; background: none; }
.threshold { display: block; width: 100%; margin: 0 0 2px; }
.color-head, .color-row { display: grid; grid-template-columns: 1fr repeat(3, 42px); align-items: center; gap: 6px; }
.color-head { margin: 12px 0 4px; color: var(--wt-muted); font-size: 11px; text-align: center; }
.color-head span:first-child { text-align: left; }
.color-row { min-height: 34px; }
.color-row input[type="color"] { width: 36px; }
.conjunction { margin-top: 10px; font-weight: 500; }
.keys { color: var(--wt-muted); margin: 7px 0; font-size: 11px; line-height: 1.9; }
.note { color: var(--wt-muted); margin: 5px 0; font-size: 12px; }
kbd { padding: 2px 4px; border: 1px solid var(--wt-line); border-radius: 5px; background: var(--wt-surface); }
.status { margin: 12px 0 0; color: var(--wt-accent); font-size: 12px; }
</style>
