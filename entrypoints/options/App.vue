<script setup lang="ts">
import { ref, onMounted } from 'vue';
import {
  loadSettings, saveSettings, originPattern, OPENAI_BASE_URL, OPENAI_MODELS,
  type HighlightColors, type Settings,
} from '@/src/lib/settings';
import WordLibrary from './WordLibrary.vue';
import PromptEditor from './PromptEditor.vue';
import CachedAnswers from './CachedAnswers.vue';
import SyncPanel from './SyncPanel.vue';
import ReviewSession from './ReviewSession.vue';
import LearningDashboard from './LearningDashboard.vue';
import type { ReviewItem } from '@/src/lib/db';

const settings = ref<Settings | null>(null);
const granted = ref(false);
const loadError = ref('');
type Tab = 'review' | 'activity' | 'contexts' | 'cache' | 'settings';
const tab = ref<Tab>(location.hash === '#review' || location.hash === '#activity'
  ? location.hash.slice(1) as Tab
  : 'settings');
const reviewItems = ref<ReviewItem[]>([]);
const reviewTotal = ref(0);
const reviewDone = ref(0);
const reviewCaught = ref(0);
const highlightTiers = [
  { key: 'saved', label: '我收藏的生詞' },
  { key: 'learning', label: '我的程度之外' },
  { key: 'advanced', label: '更高等級詞彙' },
  { key: 'rare', label: '極低頻詞彙' },
] as const;
type ColorSetting = 'highlightColors' | 'highlightTextColors' | 'highlightUnderlineColors';

onMounted(async () => {
  // 沒有這個 try 的話,載入失敗時 settings 停在 null,下面的 v-if 什麼都不畫,
  // 頁面就是一片白,而且 console 乾乾淨淨。白畫面要能說出自己為什麼白。
  try {
    settings.value = await loadSettings();
    await Promise.all([refreshGrant(), loadReviewItems()]);
  } catch (err) {
    loadError.value = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error('[wordtiger] options 載入失敗', err);
  }
});

async function loadReviewItems() {
  reviewItems.value = (await browser.runtime.sendMessage({ type: 'listReviewItems' })) ?? [];
  reviewTotal.value = reviewItems.value.length;
  reviewDone.value = 0;
  reviewCaught.value = 0;
}

function selectTab(next: Tab) {
  tab.value = next;
  history.replaceState(null, '', next === 'review' || next === 'activity'
    ? `#${next}`
    : location.pathname);
}

function reviewed({ word, remembered }: { word: string; remembered: boolean }) {
  reviewItems.value = reviewItems.value.filter((item) => item.word !== word);
  reviewDone.value++;
  if (remembered) reviewCaught.value++;
}

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
/** 換了端點,舊網域的授權就不算數了,存完立刻重新檢查一次。 */
async function onEndpointChange() {
  await persist();
  await refreshGrant();
}

async function grantHost() {
  const origin = originPattern(settings.value?.baseUrl ?? '');
  if (!origin) return;
  granted.value = await browser.permissions.request({ origins: [origin] });
}

</script>

<template>
  <main v-if="loadError" class="wrap">
    <header class="page-head">
      <img class="logo" src="/icons/48.png" alt="" />
      <div><h1>攔詞虎</h1><p>把英文裡的攔路虎，一隻隻抓起來</p></div>
    </header>
    <p class="warn">設定載入失敗:{{ loadError }}</p>
    <p class="note">開 DevTools console 看完整堆疊。也檢查 edge://extensions 的 service worker 有沒有紅字。</p>
  </main>

  <main v-else-if="settings" class="wrap" :class="{ wide: tab === 'contexts' || tab === 'activity' }">
    <header class="page-head">
      <img class="logo" src="/icons/48.png" alt="" />
      <div><h1>攔詞虎</h1><p>WordTiger by JasonDevOps</p></div>
    </header>

    <nav>
      <button :class="{ active: tab === 'review' }" @click="selectTab('review')">
        今晚打老虎 <span v-if="reviewItems.length" class="nav-count">{{ reviewItems.length }}</span>
      </button>
      <button :class="{ active: tab === 'activity' }" @click="selectTab('activity')">學習足跡</button>
      <button :class="{ active: tab === 'contexts' }" @click="selectTab('contexts')">我的攔路虎</button>
      <button :class="{ active: tab === 'cache' }" @click="selectTab('cache')">AI 回答庫</button>
      <button :class="{ active: tab === 'settings' }" @click="selectTab('settings')">設定</button>
    </nav>

    <ReviewSession v-if="tab === 'review'"
      :key="reviewItems[0]?.word ?? `done-${reviewDone}`"
      :item="reviewItems[0] ?? null" :done="reviewDone" :total="reviewTotal"
      :caught="reviewCaught" @reviewed="reviewed" @next-round="loadReviewItems" />

    <LearningDashboard v-else-if="tab === 'activity'" />

    <template v-else-if="tab === 'settings'">
    <SyncPanel />
    <section>
      <h2>AI 閱讀教練</h2>
      <p class="note">查詞、快速看懂和拆句共用這組設定。</p>
      <label>服務
        <input v-model.trim="settings.baseUrl" type="url"
          :placeholder="OPENAI_BASE_URL" @change="onEndpointChange" />
      </label>
      <label>API Key
        <input v-model="settings.apiKey" type="password" @change="persist" />
      </label>
      <label>Model
        <input v-model.trim="settings.model" list="ai-models"
          :placeholder="OPENAI_MODELS[0].value" @change="persist" />
        <datalist id="ai-models">
          <option v-for="item in OPENAI_MODELS" :key="item.value" :value="item.value">
            {{ item.label }}
          </option>
        </datalist>
      </label>
      <p class="note">
        任何 OpenAI 相容端點都可以，網址填到 <code>/v1</code> 為止。
        Model 欄位可直接輸入該服務的模型名稱。換服務之後要重新授權新的網域。
        已快取的回答不會自動重查；測試新服務時可到「AI 回答庫」清除。
      </p>
      <p class="note">
        OpenAI 常用選項：
        <button v-for="item in OPENAI_MODELS" :key="item.value" type="button" class="chip"
          @click="settings.model = item.value; persist()">{{ item.label }}</button>
      </p>

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
      <h2>讓老虎認識你</h2>
      <textarea v-model="settings.profile" rows="4" @change="persist"
        placeholder="我是 DevOps 工程師,熟 Python / Shell / AWS。解釋單字時,如果這個字在軟體工程或維運領域有特定用法,優先給那個意思。" />
      <p class="note">告訴攔詞虎你的工作與英文程度，回答會更貼近你正在讀的內容。</p>
    </section>

    <section>
      <h2>閱讀標示</h2>
      <p class="note">決定哪些字會跳出來攔你。</p>
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
      <p class="note">
        詞頻排名資料來自 SUBTLEX-US（Brysbaert &amp; New, 2009），
        經 npm 套件 <code>subtlex-word-frequencies</code> 轉成本地詞表，不會連外查詢。
      </p>
    </section>

    <section>
      <h2>老虎不出沒的地方</h2>
      <textarea rows="3" :value="settings.blockedHosts.join('\n')"
        @change="(e: any) => { settings!.blockedHosts = e.target.value.split('\n').map((s: string) => s.trim()).filter(Boolean); persist(); }" />
      <p class="note">一行一個。公司內網放這裡,網頁內容就不會被送到 AI。</p>
    </section>

    <PromptEditor v-model="settings.templates" @update:modelValue="persist" />
    </template>

    <WordLibrary v-else-if="tab === 'contexts'" />
    <CachedAnswers v-else-if="tab === 'cache'" />

  </main>
</template>

<style scoped>
:global(*) { box-sizing: border-box; }
:global(body) { margin: 0; color: #1e293b; background: #f6f7fb; }
.wrap { max-width: 760px; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; font: 15px/1.65 ui-sans-serif, system-ui, sans-serif; }
.wrap.wide { max-width: 1100px; }
.page-head { display: flex; align-items: center; gap: .9rem; margin-bottom: 1.5rem; }
.page-head h1, .page-head p { margin: 0; }
.page-head h1 { color: #0f172a; font-size: 25px; line-height: 1.2; letter-spacing: -.03em; }
.page-head p { color: #64748b; font-size: 13px; }
.logo { width: 42px; height: 42px; border-radius: 10px; }
section { margin-bottom: 1rem; padding: 1.25rem; border: 1px solid #e2e8f0; border-radius: 14px; background: white; box-shadow: 0 1px 2px #0f172a08; }
section h2 { margin-top: 0; color: #0f172a; font-size: 17px; }
nav { display: flex; flex-wrap: wrap; gap: .35rem; margin-bottom: 1.25rem; padding: .3rem; border: 1px solid #e2e8f0; border-radius: 11px; background: #eef0f6; }
nav button { flex: 1; min-width: 120px; padding: .6rem 1rem; border: 0; border-radius: 8px; color: #64748b; background: transparent; cursor: pointer; }
nav button.active { color: #3730a3; background: white; box-shadow: 0 1px 4px #0f172a18; font-weight: 700; }
.nav-count { display: inline-grid; min-width: 19px; height: 19px; place-items: center; margin-left: .25rem; padding: 0 .25rem; border-radius: 999px; color: white; background: #ea580c; font-size: 11px; }
label { display: block; margin-bottom: .75rem; }
input[type="text"], input[type="password"], input[type="url"], input:not([type]), textarea, select { width: 100%; padding: .58rem .7rem; border: 1px solid #cbd5e1; border-radius: 8px; color: #1e293b; background: white; font: inherit; }
input:focus, textarea:focus, select:focus, button:focus-visible { outline: 3px solid #c7d2fe; outline-offset: 1px; border-color: #6366f1; }
button { padding: .5rem .75rem; border: 1px solid #cbd5e1; border-radius: 8px; color: #334155; background: white; cursor: pointer; }
button:disabled { opacity: .55; cursor: wait; }
input[type="range"] { width: 100%; }
.colors { margin: 1rem 0; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
.color-head, .color-row { display: grid; grid-template-columns: minmax(180px, 1fr) repeat(3, 72px); align-items: center; gap: .75rem; padding: .55rem .75rem; }
.color-head { color: #64748b; background: #f8fafc; font-size: 12px; text-align: center; }
.color-head b:first-child { text-align: left; }
.color-row + .color-row { border-top: 1px solid #e2e8f0; }
.color-row input[type="color"] { width: 100%; height: 32px; padding: 0; border: 0; background: none; cursor: pointer; }
.switch { display: flex; gap: .5rem; align-items: center; }
.note { color: #64748b; font-size: 13px; }
.warn { color: #b4451f; font-size: 13px; }
.chip { width: auto; margin: .2rem .3rem 0 0; padding: .2rem .5rem; font-size: 12px; border: 1px solid #cbd5e1; border-radius: 999px; background: white; color: #475569; cursor: pointer; }
.chip:hover { border-color: #6366f1; color: #1e293b; }
.ok { color: #2b7a3d; font-size: 13px; }
table { width: 100%; border-collapse: collapse; }
td { padding: .4rem; border-bottom: 1px solid #ddd; cursor: pointer; }
blockquote { border-left: 3px solid #c8c0ff; margin: .5rem 0; padding-left: .75rem; }
@media (max-width: 640px) { .wrap { padding: 1.25rem .75rem 3rem; } nav button { padding-inline: .35rem; } section { padding: 1rem; } }
</style>
