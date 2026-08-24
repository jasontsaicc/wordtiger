<script setup lang="ts">
import { ref, onMounted } from 'vue';
import {
  loadSettings, saveSettings, originPattern, OPENAI_BASE_URL, OPENAI_MODELS,
  type HighlightColors, type Settings,
} from '@/src/lib/settings';
import WordLibrary from './WordLibrary.vue';
import PromptEditor from './PromptEditor.vue';
import CachedAnswers from './CachedAnswers.vue';

const settings = ref<Settings | null>(null);
const granted = ref(false);
const loadError = ref('');
const tab = ref<'settings' | 'contexts' | 'cache'>('settings');
const highlightTiers = [
  { key: 'saved', label: '我收藏的生詞' },
  { key: 'learning', label: '我的程度之外' },
  { key: 'advanced', label: '更高等級詞彙' },
  { key: 'rare', label: '詞頻表之外' },
] as const;
type ColorSetting = 'highlightColors' | 'highlightTextColors' | 'highlightUnderlineColors';

onMounted(async () => {
  // 沒有這個 try 的話,載入失敗時 settings 停在 null,下面的 v-if 什麼都不畫,
  // 頁面就是一片白,而且 console 乾乾淨淨。白畫面要能說出自己為什麼白。
  try {
    settings.value = await loadSettings();
    await refreshGrant();
  } catch (err) {
    loadError.value = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error('[pv] options 載入失敗', err);
  }
});

async function persist() {
  if (settings.value) await saveSettings(settings.value);
  await refreshGrant();
}

function pickerColor(value: string) {
  return value.slice(0, 7);
}

function setHighlightColor(group: ColorSetting, tier: keyof HighlightColors, event: Event) {
  if (!settings.value) return;
  const rgb = (event.target as HTMLInputElement).value;
  const alpha = settings.value[group][tier].slice(7);
  settings.value[group][tier] = rgb + alpha;
  void persist();
}

async function refreshGrant() {
  const origin = originPattern(settings.value?.baseUrl ?? '');
  granted.value = origin
    ? await browser.permissions.contains({ origins: [origin] })
    : false;
}

/**
 * 授權必須由使用者手勢直接觸發,所以 request 要是這個 handler 的第一件事。
 * 中間先 await 別的東西,Chrome 會判定手勢已經過期而拒絕。
 */
async function grantHost() {
  const origin = originPattern(settings.value?.baseUrl ?? '');
  if (!origin) return;
  granted.value = await browser.permissions.request({ origins: [origin] });
}

</script>

<template>
  <main v-if="loadError" class="wrap">
    <h1>個人詞庫</h1>
    <p class="warn">設定載入失敗:{{ loadError }}</p>
    <p class="note">開 DevTools console 看完整堆疊。也檢查 edge://extensions 的 service worker 有沒有紅字。</p>
  </main>

  <main v-else-if="settings" class="wrap" :class="{ wide: tab === 'contexts' }">
    <h1>個人詞庫</h1>

    <nav>
      <button :class="{ active: tab === 'settings' }" @click="tab = 'settings'">設定</button>
      <button :class="{ active: tab === 'contexts' }" @click="tab = 'contexts'">生詞語境</button>
      <button :class="{ active: tab === 'cache' }" @click="tab = 'cache'">快取回答</button>
    </nav>

    <template v-if="tab === 'settings'">
    <section>
      <h2>AI 設定</h2>
      <label>服務
        <select v-model="settings.baseUrl" @change="persist">
          <option :value="OPENAI_BASE_URL">OpenAI — {{ OPENAI_BASE_URL }}</option>
        </select>
      </label>
      <label>API Key
        <input v-model="settings.apiKey" type="password" @change="persist" />
      </label>
      <label>Model
        <select v-model="settings.model" @change="persist">
          <option v-for="item in OPENAI_MODELS" :key="item.value" :value="item.value">
            {{ item.label }}
          </option>
        </select>
      </label>
      <p class="note">目前先固定 OpenAI；GPT-4o mini 適合快速翻譯，GPT-4.1 mini 適合較完整的查詞輸出。</p>

      <p v-if="!originPattern(settings.baseUrl)" class="warn">
        先填一個完整網址,例如 https://api.openai.com/v1。
      </p>
      <p v-else-if="granted" class="ok">
        已授權連線到 {{ originPattern(settings.baseUrl) }}
      </p>
      <p v-else class="warn">
        還沒授權連線到 {{ originPattern(settings.baseUrl) }},查詞會失敗。
        <button @click="grantHost">授權這個網域</button>
      </p>
    </section>

    <section>
      <h2>你的背景</h2>
      <textarea v-model="settings.profile" rows="4" @change="persist"
        placeholder="我是 DevOps 工程師,熟 Python / Shell / AWS。解釋單字時,如果這個字在軟體工程或維運領域有特定用法,優先給那個意思。" />
      <p class="note">這段會被放進查詞、翻譯、文法分析的 prompt。</p>
    </section>

    <section>
      <h2>高亮門檻</h2>
      <input type="range" min="1000" max="30000" step="2000"
        v-model.number="settings.threshold" @change="persist" />
      <p>高亮詞頻排名 <b>{{ settings.threshold.toLocaleString() }}</b> 名以外的字。每次調整 2,000 名；往右拉，亮的字變少。</p>
      <div class="colors">
        <div class="color-head"><b>等級</b><b>背景</b><b>字體</b><b>下劃線</b></div>
        <div v-for="tier in highlightTiers" :key="tier.key" class="color-row">
          <span>{{ tier.label }}</span>
          <input :value="pickerColor(settings.highlightColors[tier.key])" type="color"
            :aria-label="`${tier.label}背景色`" @change="setHighlightColor('highlightColors', tier.key, $event)" />
          <input :value="pickerColor(settings.highlightTextColors[tier.key])" type="color"
            :aria-label="`${tier.label}字體色`" @change="setHighlightColor('highlightTextColors', tier.key, $event)" />
          <input :value="pickerColor(settings.highlightUnderlineColors[tier.key])" type="color"
            :aria-label="`${tier.label}下劃線色`" @change="setHighlightColor('highlightUnderlineColors', tier.key, $event)" />
        </div>
      </div>
      <label class="switch">
        <input v-model="settings.markConjunctions" type="checkbox" @change="persist" />
        連詞標記：並列連詞用點線，從句連詞用雙線
      </label>
      <p class="note">背景色支援透明度；新配色使用淡色背景、黑字和較深下劃線，讓技術文件更容易掃讀。</p>
    </section>

    <section>
      <h2>不啟用的網域</h2>
      <textarea rows="3" :value="settings.blockedHosts.join('\n')"
        @change="(e: any) => { settings!.blockedHosts = e.target.value.split('\n').map((s: string) => s.trim()).filter(Boolean); persist(); }" />
      <p class="note">一行一個。公司內網放這裡,網頁內容就不會被送到 AI。</p>
    </section>

    <PromptEditor v-model="settings.templates" @update:modelValue="persist" />
    </template>

    <WordLibrary v-else-if="tab === 'contexts'" />
    <CachedAnswers v-else />

  </main>
</template>

<style scoped>
.wrap { max-width: 720px; margin: 2rem auto; font: 15px/1.7 system-ui, sans-serif; }
.wrap.wide { max-width: 1100px; }
section { margin-bottom: 2.5rem; }
nav { display: flex; gap: .5rem; margin-bottom: 2rem; border-bottom: 1px solid #ddd; }
nav button { padding: .65rem 1rem; border: 0; border-bottom: 3px solid transparent; background: none; cursor: pointer; }
nav button.active { color: #5b4bc4; border-bottom-color: #7c6ee6; font-weight: 700; }
label { display: block; margin-bottom: .75rem; }
input[type="text"], input[type="password"], input:not([type]), textarea, select { width: 100%; padding: .4rem; }
input[type="range"] { width: 100%; }
.colors { margin: 1rem 0; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
.color-head, .color-row { display: grid; grid-template-columns: minmax(180px, 1fr) repeat(3, 72px); align-items: center; gap: .75rem; padding: .55rem .75rem; }
.color-head { color: #64748b; background: #f8fafc; font-size: 12px; text-align: center; }
.color-head b:first-child { text-align: left; }
.color-row + .color-row { border-top: 1px solid #e2e8f0; }
.color-row input[type="color"] { width: 100%; height: 32px; padding: 0; border: 0; background: none; cursor: pointer; }
.switch { display: flex; gap: .5rem; align-items: center; }
.note { opacity: .6; font-size: 13px; }
.warn { color: #b4451f; font-size: 13px; }
.ok { color: #2b7a3d; font-size: 13px; }
table { width: 100%; border-collapse: collapse; }
td { padding: .4rem; border-bottom: 1px solid #ddd; cursor: pointer; }
blockquote { border-left: 3px solid #c8c0ff; margin: .5rem 0; padding-left: .75rem; }
</style>
