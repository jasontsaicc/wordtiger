<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { loadSettings, pageOrigin, saveSettings, type Settings } from '@/src/lib/settings';

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
      func: () => Boolean((window as unknown as { __pvAbort?: unknown }).__pvAbort),
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
  if (settings.value) await saveSettings({ highlightColors: settings.value.highlightColors });
  status.value = '顏色已儲存，下次開啟標示時套用。';
}

async function openOptions() {
  await browser.runtime.openOptionsPage();
  window.close();
}
</script>

<template>
  <main v-if="settings">
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
      <h2>詞頻顏色</h2>
      <p class="note">1–{{ settings.threshold.toLocaleString() }} 名不標示</p>
      <label><input v-model="settings.highlightColors.saved" type="color" @change="saveColors" /> 我收藏的生詞</label>
      <label><input v-model="settings.highlightColors.learning" type="color" @change="saveColors" /> 程度稍上：{{ (settings.threshold + 1).toLocaleString() }}–{{ level1.toLocaleString() }}</label>
      <label><input v-model="settings.highlightColors.advanced" type="color" @change="saveColors" /> 進階：{{ (level1 + 1).toLocaleString() }}–{{ level2.toLocaleString() }}</label>
      <label><input v-model="settings.highlightColors.rare" type="color" @change="saveColors" /> 極少見：{{ level2.toLocaleString() }} 名外</label>
    </section>

    <section>
      <h2>快捷鍵</h2>
      <div class="keys"><kbd>Alt+U</kbd> 開關　<kbd>A</kbd> 查詞　<kbd>S</kbd> 翻譯</div>
      <div class="keys"><kbd>D</kbd> 文法　<kbd>F</kbd> 發音　<kbd>Space</kbd> 收藏　<kbd>Esc</kbd> 關閉</div>
    </section>

    <p v-if="status" class="status">{{ status }}</p>
  </main>
</template>

<style>
:root { font: 14px/1.45 system-ui, sans-serif; color: #202124; }
body { margin: 0; }
main { width: 340px; padding: 12px; box-sizing: border-box; }
.actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
button { border: 1px solid #ccd0d5; border-radius: 7px; padding: 9px; background: white; cursor: pointer; }
button.primary { color: white; border-color: #2563eb; background: #2563eb; }
button:disabled { opacity: .45; cursor: not-allowed; }
.switch { display: flex; gap: 8px; align-items: center; margin: 13px 0; font-weight: 600; }
section { border-top: 1px solid #e5e7eb; padding-top: 9px; margin-top: 9px; }
h2 { margin: 0 0 7px; font-size: 13px; }
section label { display: flex; align-items: center; gap: 7px; margin: 6px 0; }
input[type="color"] { width: 30px; height: 24px; padding: 0; border: 0; background: none; }
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
