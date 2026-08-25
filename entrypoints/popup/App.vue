<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  loadSettings, pageOrigin, saveSettings, type HighlightColors, type Settings,
} from '@/src/lib/settings';

const settings = ref<Settings | null>(null);
const tab = ref<Browser.tabs.Tab | null>(null);
const running = ref(false);
const status = ref('');

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
  settings.value = await loadSettings();
  [tab.value] = await browser.tabs.query({ active: true, currentWindow: true });
  running.value = await isRunning();
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
  } catch (err) {
    status.value = err instanceof Error ? err.message : String(err);
  }
}

async function toggleAuto(event: Event) {
  if (!settings.value || !pagePattern.value) return;
  const enabled = (event.target as HTMLInputElement).checked;

  if (enabled) {
    // permissions.request 必須直接留在使用者事件裡，前面不能先 await。
    const granted = await browser.permissions.request({ origins: [pagePattern.value] });
    if (!granted) {
      status.value = '未取得這個網站的自動標示權限。';
      return;
    }
    settings.value.autoOrigins = [...new Set([...settings.value.autoOrigins, pagePattern.value])];
    status.value = '已開啟；重新載入本頁後會自動標示。';
  } else {
    settings.value.autoOrigins = settings.value.autoOrigins.filter((x) => x !== pagePattern.value);
    status.value = '已關閉這個網站的自動標示。';
  }
  await saveSettings({ autoOrigins: settings.value.autoOrigins });
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
  await browser.runtime.openOptionsPage();
  window.close();
}
</script>

<template>
  <main v-if="settings">
    <header><img src="/icons/32.png" alt="" /><b>攔詞虎</b><span>WordTiger</span></header>
    <div class="actions">
      <button class="primary" :disabled="!pagePattern || blocked" @click="toggleHighlight">
        {{ running ? '關閉本頁標示' : '開啟本頁標示' }}
      </button>
      <button @click="openOptions">設定與詞庫</button>
    </div>

    <p v-if="blocked" class="warn">目前網站在黑名單內。</p>
    <label class="switch">
      <input type="checkbox" :checked="auto" :disabled="!pagePattern || blocked" @change="toggleAuto" />
      此網站自動標示
    </label>

    <section>
      <h2>高亮樣式</h2>
      <p class="note">1–{{ settings.threshold.toLocaleString() }} 名不標示</p>
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
    </section>

    <section>
      <h2>快捷鍵</h2>
      <div class="keys"><kbd>Alt+U</kbd> 開關　<kbd>A</kbd> 查詞　<kbd>S</kbd> 快速看懂</div>
      <div class="keys"><kbd>D</kbd> 拆懂這句　<kbd>F</kbd> 發音　<kbd>Space</kbd> 收藏　<kbd>X</kbd> 已認得　<kbd>Esc</kbd> 關閉</div>
    </section>

    <p v-if="status" class="status">{{ status }}</p>
  </main>
</template>

<style>
:root { font: 14px/1.45 system-ui, sans-serif; color: #202124; }
body { margin: 0; }
main { width: 340px; padding: 12px; box-sizing: border-box; }
header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
header img { width: 32px; height: 32px; border-radius: 7px; }
header b { font-size: 16px; }
header span { margin-left: auto; color: #6b7280; font-size: 12px; }
.actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
button { border: 1px solid #ccd0d5; border-radius: 7px; padding: 9px; background: white; cursor: pointer; }
button.primary { color: white; border-color: #2563eb; background: #2563eb; }
button:disabled { opacity: .45; cursor: not-allowed; }
.switch { display: flex; gap: 8px; align-items: center; margin: 13px 0; font-weight: 600; }
section { border-top: 1px solid #e5e7eb; padding-top: 9px; margin-top: 9px; }
h2 { margin: 0 0 7px; font-size: 13px; }
section label { display: flex; align-items: center; gap: 7px; margin: 6px 0; }
input[type="color"] { width: 30px; height: 24px; padding: 0; border: 0; background: none; }
.color-head, .color-row { display: grid; grid-template-columns: 1fr repeat(3, 42px); align-items: center; gap: 6px; }
.color-head { margin-bottom: 4px; color: #64748b; font-size: 11px; text-align: center; }
.color-head span:first-child { text-align: left; }
.color-row { min-height: 30px; }
.color-row input[type="color"] { width: 36px; }
.conjunction { margin-top: 10px; font-weight: 500; }
.keys { color: #4b5563; margin: 5px 0; font-size: 12px; }
.note { color: #64748b; margin: 4px 0; font-size: 12px; }
kbd { padding: 1px 4px; border: 1px solid #cbd5e1; border-radius: 4px; background: #f8fafc; }
.warn { color: #b4451f; }
.status { margin: 9px 0 0; color: #2563eb; font-size: 12px; }
@media (prefers-color-scheme: dark) {
  :root { color: #e5e7eb; background: #202124; }
  button { color: #e5e7eb; background: #303134; border-color: #5f6368; }
  .keys { color: #cbd5e1; }
  kbd { background: #303134; border-color: #5f6368; }
}
</style>
