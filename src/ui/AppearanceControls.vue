<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { observeAppearance, type Appearance } from './appearance';
const appearance = ref<Appearance>({ theme: 'system', reducedMotion: false });
const error = ref('');
const busy = ref(false);
let stop = () => {};
onMounted(() => {
  stop = observeAppearance(document.documentElement, value => { appearance.value = value; },
    () => { error.value = '外觀設定無法讀取，請重新開啟。'; });
});
onUnmounted(() => stop());
async function save(key: 'uiTheme' | 'uiReducedMotion', value: string | boolean) {
  busy.value = true;
  error.value = '';
  try { await browser.storage.local.set({ [key]: value }); }
  catch { error.value = '外觀設定未儲存，請再試一次。'; }
  finally { busy.value = false; }
}
</script>
<template>
  <div class="appearance-controls">
    <label class="theme-select"><span class="sr-only">外觀模式</span>
      <select aria-label="外觀模式" :value="appearance.theme" :disabled="busy"
        @change="save('uiTheme', ($event.target as HTMLSelectElement).value)">
        <option value="system">◐ 跟隨系統</option>
        <option value="day">☀ 白天 · 活潑遊戲</option>
        <option value="night">☾ 夜間 · 質感科技</option>
      </select>
    </label>
    <button type="button" :aria-pressed="appearance.reducedMotion" :disabled="busy"
      @click="save('uiReducedMotion', !appearance.reducedMotion)">減少動態</button>
    <p v-if="error" class="error" role="status">{{ error }}</p>
  </div>
</template>
<style scoped>
.appearance-controls { display: flex; align-items: center; flex-wrap: wrap; gap: .6rem; }
.theme-select { margin: 0; }
select, button { min-height: 40px; font-size: 12px; }
.error { width: 100%; margin: 0; }
</style>
