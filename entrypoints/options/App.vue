<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import {
  loadSettings, saveSettings, originPattern, OPENAI_BASE_URL, OPENAI_MODELS,
  type HighlightColors, type Settings,
} from '@/src/lib/settings';
import AppearanceControls from '@/src/ui/AppearanceControls.vue';
import WordLibrary from './WordLibrary.vue';
import PromptEditor from './PromptEditor.vue';
import SyncPanel from './SyncPanel.vue';
import ReviewSession from './ReviewSession.vue';
import LearningDashboard from './LearningDashboard.vue';
import { localDay, type ReviewEvent } from '@/src/lib/activity';
import type { ReviewItem } from '@/src/lib/db';
import type { ExplainResult } from '@/src/lib/messages';

const settings = ref<Settings | null>(null);
const loadError = ref('');
const testingAi = ref(false);
const connectionMessage = ref('');
const helpUrl = browser.runtime.getURL('/help.html');
const privacyUrl = browser.runtime.getURL('/privacy.html');
const version = browser.runtime.getManifest().version;
type Tab = 'review' | 'activity' | 'contexts' | 'settings';
const tabs: Tab[] = ['review', 'activity', 'contexts', 'settings'];
const initialTab = location.hash.slice(1) as Tab;
const tab = ref<Tab>(tabs.includes(initialTab) ? initialTab : 'settings');
const titles = { review: '每日複習', activity: '學習紀錄', contexts: '我的詞庫', settings: '設定' };
const overview = ref<Array<{ word: string; status: string; progress: string }>>([]);
const learning = computed(() => overview.value.filter(w => w.status === 'unknown' && w.progress !== 'excluded').length);
const known = computed(() => overview.value.filter(w => w.progress === 'mastered').length);
async function loadOverview() { overview.value = (await browser.runtime.sendMessage({ type: 'listWords' })) ?? []; }
const reviewItems = ref<ReviewItem[]>([]);
const reviewTotal = ref(0);
const reviewDone = ref(0);
const reviewCaught = ref(0);
/** 今天累計練了幾隻，跨輪次也累加。低壓介面靠這個顯示「還在前進」。 */
const reviewToday = ref(0);
const highlightTiers = [
  { key: 'saved', label: '我收藏的生詞' },
  { key: 'learning', label: '我的程度之外' },
  { key: 'advanced', label: '更高等級詞彙' },
  { key: 'rare', label: '極低頻詞彙' },
] as const;
type ColorSetting = 'highlightColors' | 'highlightTextColors' | 'highlightUnderlineColors';

function syncHash() {
  const next = location.hash.slice(1) as Tab;
  if (tabs.includes(next)) tab.value = next;
}
onUnmounted(() => window.removeEventListener('hashchange', syncHash));
onMounted(async () => {
  window.addEventListener('hashchange', syncHash);
  // 顯示載入錯誤，避免 settings 為 null 時呈現空白頁。
  try {
    settings.value = await loadSettings();
    await Promise.all([loadReviewItems(), loadTodayCount(), loadOverview()]);
    if (!tabs.includes(initialTab) && (overview.value.length || settings.value.apiKey)) tab.value = 'review';
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

async function loadTodayCount() {
  const log = (await browser.runtime.sendMessage({ type: 'listReviewLog' })) ?? [];
  const today = localDay(Date.now());
  reviewToday.value = (log as ReviewEvent[]).filter((e) => localDay(e.at) === today).length;
}

function selectTab(next: Tab) {
  tab.value = next;
  history.replaceState(null, '', `#${next}`);
  if (next === 'review') void loadOverview().catch(() => {});
}

function reviewed({ word, remembered }: { word: string; remembered: boolean }) {
  reviewItems.value = reviewItems.value.filter((item) => item.word !== word);
  reviewDone.value++;
  reviewToday.value++;
  if (remembered) reviewCaught.value++;
  void loadOverview().catch(() => {});
}

async function persist() {
  connectionMessage.value = '';
  if (settings.value) await saveSettings(settings.value);
}

async function testConnection() {
  if (testingAi.value) return;
  testingAi.value = true;
  connectionMessage.value = '';
  try {
    await persist();
    const result = await browser.runtime.sendMessage({ type: 'testAiConnection' }) as ExplainResult | undefined;
    connectionMessage.value = result?.ok ? result.text : result?.error ?? '背景程式沒有回應，請重試。';
  } catch {
    connectionMessage.value = '無法儲存設定或連線，請重新開啟設定頁再試。';
  } finally {
    testingAi.value = false;
  }
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

</script>

<template>
  <main v-if="loadError" class="wrap">
    <header class="page-head">
      <img class="logo" src="/icons/48.png" alt="" />
      <div><h1>攔詞虎</h1><p>v{{ version }} · 把英文裡的攔路虎，一隻隻抓起來</p></div>
    </header>
    <p class="warn">設定載入失敗:{{ loadError }}</p>
    <p class="note">開 DevTools console 看完整堆疊。也檢查 edge://extensions 的 service worker 有沒有紅字。</p>
  </main>

  <div v-else-if="settings" class="app-shell">
    <aside class="sidebar">
      <header class="page-head">
        <img class="logo" src="/icons/128.png" alt="攔詞虎 Logo" />
        <div><h1>攔詞虎</h1><p>WORDTIGER</p></div>
      </header>
      <p class="nav-label">YOUR LEARNING SPACE</p>
      <nav aria-label="主要導覽">
        <button :class="{ active: tab === 'review' }" :aria-current="tab === 'review' ? 'page' : undefined" @click="selectTab('review')"><span aria-hidden="true">ϟ</span>今晚打老虎 <b v-if="reviewItems.length" class="nav-count">{{ reviewItems.length }}</b></button>
        <button :class="{ active: tab === 'contexts' }" :aria-current="tab === 'contexts' ? 'page' : undefined" @click="selectTab('contexts')"><span aria-hidden="true">▤</span>我的攔路虎</button>
        <button :class="{ active: tab === 'activity' }" :aria-current="tab === 'activity' ? 'page' : undefined" @click="selectTab('activity')"><span aria-hidden="true">✧</span>老虎足跡</button>
        <button :class="{ active: tab === 'settings' }" :aria-current="tab === 'settings' ? 'page' : undefined" @click="selectTab('settings')"><span aria-hidden="true">⚙</span>設定</button>
      </nav>
      <div class="side-note"><strong>每天一點，就很可以。</strong><p>把文章裡遇見的生詞，慢慢變成熟悉的朋友。</p></div>
      <p class="version">v{{ version }} · JasonDevOps</p>
    </aside>
    <main class="workspace">
      <div class="workspace-top"><p>學習空間 / <strong>{{ titles[tab] }}</strong></p><AppearanceControls /></div>
      <template v-if="tab === 'review'">
        <div class="intro"><h2>今天，也前進一點。</h2><p>從真實閱讀出發，讓每個生詞留下來。</p></div>
        <div class="brand-hero">
          <div><p class="eyebrow">A LITTLE EVERY DAY</p><h2><span>把攔路虎，</span><span>變成你的底氣。</span></h2><p>一輪最多 5 題，從你讀過的句子開始。<br>不用一次記住所有，今天多認識一點就好。</p></div>
          <div class="hero-art"><i aria-hidden="true"></i><img src="/icons/128.png" alt="" /><span aria-hidden="true">✧</span></div>
        </div>
        <div class="overview-stats">
          <article><p>今天已練</p><strong :key="reviewToday">{{ reviewToday }} <small>題</small></strong><span aria-hidden="true">↗</span></article>
          <article><p>正在學習</p><strong>{{ learning }} <small>個詞</small></strong><span aria-hidden="true">▤</span></article>
          <article><p>已經馴服</p><strong>{{ known }} <small>個詞</small></strong><span aria-hidden="true">✧</span></article>
        </div>
        <div class="review-layout">
          <ReviewSession :key="reviewItems[0]?.word ?? `done-${reviewDone}`"
            :item="reviewItems[0] ?? null" :done="reviewDone" :total="reviewTotal"
            :caught="reviewCaught" :today-done="reviewToday"
            @reviewed="reviewed" @next-round="loadReviewItems" />
          <section class="companion"><h2>每一次回來，都算數。</h2><p class="note">不趕時間，照自己的節奏就好。</p><div class="companion-divider"></div><h3>我的攔路虎</h3><p v-if="!overview.length" class="note">到英文文章查詞，連同原句收藏第一個生詞吧。</p><ul v-else><li v-for="word in overview.slice(0, 4)" :key="word.word">{{ word.word }}<span>{{ word.progress === 'mastered' ? '已馴服' : '語境收藏' }}</span></li></ul><button @click="selectTab('contexts')">打開我的詞庫 →</button><button @click="selectTab('activity')">看看老虎足跡 ↗</button></section>
        </div>
      </template>
      <LearningDashboard v-else-if="tab === 'activity'" />

    <template v-else-if="tab === 'settings'">
    <section class="getting-started">
      <h2>三步開始，把第一隻攔路虎抓起來</h2>
      <ol>
        <li>在下方填入自己的 AI 金鑰與模型，按「測試 AI 連線」。</li>
        <li>開啟英文文章，點小虎或按 <kbd>Alt+U</kbd>，讓生詞亮起來。</li>
        <li>滑鼠移到單字按 <kbd>A</kbd> 查詞，再按 <kbd>Space</kbd> 收藏；之後到「今晚打老虎」複習。</li>
      </ol>
      <p class="note">不設 AI 也能高亮與收藏；複習需要先有查詞結果。跨裝置同步是選用功能。</p>
      <p class="help-links"><a :href="helpUrl" target="_blank" rel="noopener">操作說明與常見問題</a> · <a :href="privacyUrl" target="_blank" rel="noopener">隱私政策</a> · <a href="https://github.com/jasontsaicc/wordtiger/issues" target="_blank" rel="noopener">問題回報</a></p>
    </section>
    <section>
      <h2>AI 閱讀教練</h2>
      <p class="note">查詞、快速看懂和拆句共用這組設定。</p>
      <p class="note">AI 請求由你選擇的服務依其方案計費，攔詞虎不附贈 API 額度。請只填入你信任的服務網址，金鑰會送到該端點。</p>
      <fieldset :disabled="testingAi">
      <label>服務
        <input v-model.trim="settings.baseUrl" type="url"
          :placeholder="OPENAI_BASE_URL" @change="persist" />
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
        Model 欄位可直接輸入該服務的模型名稱。
        換模型或改 prompt 會自動重查，不必手動清快取。
      </p>
      <p class="note">
        OpenAI 常用選項：
        <button v-for="item in OPENAI_MODELS" :key="item.value" type="button" class="chip"
          @click="settings.model = item.value; persist()">{{ item.label }}</button>
      </p>

      <p v-if="!originPattern(settings.baseUrl)" class="warn">
        先填一個完整網址，例如 https://api.openai.com/v1。
      </p>
      </fieldset>
      <button type="button" :disabled="testingAi" @click="testConnection">{{ testingAi ? '測試中…' : '測試 AI 連線' }}</button>
      <p class="note">會送出一次短文字請求，可能產生 API 費用；不傳送網頁內容或你的背景。此測試不檢查語音服務。</p>
      <p role="status" aria-live="polite">{{ connectionMessage }}</p>
    </section>

    <section>
      <h2>讓老虎認識你</h2>
      <textarea v-model="settings.profile" rows="4" @change="persist"
        placeholder="我是 DevOps 工程師，熟悉 Python／Shell／AWS。解釋單字時，若軟體工程或維運領域有特定用法，優先提供該詞義。" />
      <p class="note">告訴攔詞虎你的工作與英文程度，回答會更貼近你正在讀的內容。</p>
    </section>

    <section>
      <h2>閱讀標示</h2>
      <p class="note">決定哪些字會跳出來攔你。</p>
      <!-- min 對齊 step，否則預設的 10,000 會落在格線外，一拉就跳掉。 -->
      <input type="range" min="2000" max="30000" step="2000"
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
      <label class="switch">
        <input v-model="settings.guessFirst" type="checkbox" @change="persist" />
        查詞先猜再揭曉：查詞卡先出三選一，答對或跳過才看完整答案
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
      <p class="note">一行一個。加入公司內網後，網頁內容不會傳送至 AI。</p>
    </section>

    <details class="advanced-sync">
      <summary>進階：跨裝置同步（選用）</summary>
      <p class="note">需自行建立 Supabase 專案。只在這台裝置使用時，不需要設定。</p>
      <SyncPanel />
    </details>
    <PromptEditor v-model="settings.templates" @update:modelValue="persist" />
    </template>

    <WordLibrary v-else-if="tab === 'contexts'" />

    </main>
  </div>
  <main v-else class="wrap" role="status">小虎準備中…</main>
</template>

<style scoped>
.wrap { max-width: 760px; margin: auto; padding: 2rem; }
.app-shell { display: grid; grid-template-columns: 220px minmax(0, 1fr); max-width: 1600px; margin: auto; min-height: 100vh; }
.sidebar { position: sticky; top: 0; height: 100vh; padding: 32px 22px; border-right: 1px solid var(--wt-line); display: flex; flex-direction: column; }
.page-head { display: flex; gap: 12px; align-items: center; margin-bottom: 42px; }
.page-head h1, .page-head p { margin: 0; }
.page-head h1 { font-size: 21px; letter-spacing: -.03em; }
.page-head p { color: var(--wt-muted); font-size: 10px; letter-spacing: 2px; }
.logo { width: 44px; height: 44px; filter: drop-shadow(0 4px 8px #13173918); }
.nav-label { color: var(--wt-muted); font-size: 10px; letter-spacing: 1.8px; }
nav { display: grid; gap: 8px; }
nav button { display: flex; align-items: center; gap: 10px; text-align: left; padding: 14px 11px; border: 0; background: transparent; font-size: 13px; color: var(--wt-muted); }
nav button.active { background: var(--wt-wash); color: var(--wt-accent); font-weight: 750; }
nav button > span:first-child { font-size: 20px; width: 20px; text-align: center; }
.nav-count { margin-left: auto; background: var(--wt-accent); color: var(--wt-on-accent); padding: 0 6px; border-radius: 6px; font-size: 11px; }
.side-note { margin-top: auto; border: 1px solid var(--wt-line); border-radius: 16px; padding: 16px; font-size: 12px; color: var(--wt-muted); }
.side-note strong { color: var(--wt-ink); }.side-note p { margin-bottom: 0; }
.version { margin: 24px 0 0; color: var(--wt-muted); font-size: 11px; }
.workspace { min-width: 0; padding: 28px 40px 50px; }
.workspace-top { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-bottom: 30px; }
.workspace-top > p { margin: 0; font-size: 12px; color: var(--wt-muted); }.workspace-top strong { color: var(--wt-ink); }
.intro { margin-bottom: 24px; }.intro h2 { font-size: 30px; margin: 0; letter-spacing: -.04em; }.intro p { color: var(--wt-muted); margin: 6px 0 0; font-size: 13px; }
.brand-hero { display: flex; align-items: center; justify-content: space-between; gap: 18px; position: relative; overflow: hidden; padding: 28px 32px; border: 1px solid var(--wt-hero-line); border-radius: 26px; background: var(--wt-hero); color: var(--wt-hero-ink); margin-bottom: 24px; box-shadow: var(--wt-shadow); }
.brand-hero h2 span { display: inline-block; }
.brand-hero h2 { font-size: clamp(23px, 2.2vw, 30px); margin: 12px 0; letter-spacing: -.04em; color: inherit; }.brand-hero p { color: var(--wt-hero-muted); margin: 0; font-size: 13px; }.brand-hero .eyebrow { font-size: 10px; letter-spacing: 2px; font-weight: 750; }
.hero-art { position: relative; display: grid; place-items: center; width: 165px; height: 150px; flex-shrink: 0; }.hero-art img { width: 112px; height: 112px; filter: drop-shadow(0 14px 16px #53362330); animation: wt-arrive 650ms ease-out; transition: transform 350ms; transform: rotate(-7deg); }.hero-art:hover img { transform: translateY(-6px) rotate(4deg); }.hero-art i { position: absolute; inset: 0; border: 1px dashed var(--wt-hero-muted); opacity: .25; border-radius: 50%; animation: wt-orbit 22s linear 2; }.hero-art span { position: absolute; right: 4px; top: 4px; color: var(--wt-hero-muted); font-size: 26px; }
.overview-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }.overview-stats article { position: relative; background: var(--wt-surface); border: 1px solid var(--wt-line); border-radius: 18px; padding: 18px 22px; transition: transform 220ms; }.overview-stats article:hover { transform: translateY(-3px); }.overview-stats p { font-size: 12px; color: var(--wt-muted); margin: 0 0 7px; }.overview-stats strong { display: inline-block; color: var(--wt-ink); font-size: 28px; animation: wt-pop 300ms ease-out; }.overview-stats small { font-size: 12px; font-weight: 400; color: var(--wt-muted); }.overview-stats article > span { position: absolute; right: 18px; top: 28px; background: var(--wt-wash); color: var(--wt-accent); padding: 5px 12px; border-radius: 12px; }
.review-layout { display: grid; grid-template-columns: minmax(0, 1.8fr) minmax(240px, 1fr); gap: 22px; align-items: start; }
section { margin-bottom: 1.25rem; padding: 1.5rem; border: 1px solid var(--wt-line); border-radius: 22px; background: var(--wt-surface); box-shadow: var(--wt-shadow); }
section h2 { margin-top: 0; font-size: 18px; }.companion h2 { font-size: 16px; }.companion h3 { font-size: 12px; }.companion-divider { height: 1px; background: var(--wt-line); margin: 24px 0; }.companion ul { list-style: none; padding: 0; }.companion li { margin: 16px 0; color: var(--wt-ink); overflow-wrap: anywhere; }.companion li span { display: block; color: var(--wt-muted); font-size: 11px; }.companion button { display: block; width: 100%; margin-top: 12px; font-size: 12px; }
label { display: block; margin-bottom: .75rem; }
input[type="text"], input[type="password"], input[type="url"], input:not([type]), textarea, select { width: 100%; padding: .58rem .7rem; border: 1px solid var(--wt-line); border-radius: 8px; color: var(--wt-ink); background: var(--wt-surface); font: inherit; }
input:focus, textarea:focus, select:focus, button:focus-visible { outline: 3px solid var(--wt-accent); outline-offset: 1px; border-color: var(--wt-accent); }
button { padding: .5rem .75rem; border: 1px solid var(--wt-line); border-radius: 8px; color: var(--wt-body); background: var(--wt-surface); cursor: pointer; }
button:disabled { opacity: .55; cursor: wait; }
input[type="range"] { width: 100%; }
.colors { margin: 1rem 0; border: 1px solid var(--wt-line); border-radius: 8px; overflow: hidden; }
.color-head, .color-row { display: grid; grid-template-columns: minmax(180px, 1fr) repeat(3, 72px); align-items: center; gap: .75rem; padding: .55rem .75rem; }
.color-head { color: var(--wt-muted); background: var(--wt-raised); font-size: 12px; text-align: center; }
.color-head b:first-child { text-align: left; }
.color-row + .color-row { border-top: 1px solid var(--wt-line); }
.color-row input[type="color"] { width: 100%; height: 32px; padding: 0; border: 0; background: none; cursor: pointer; }
.switch { display: flex; gap: .5rem; align-items: center; }
.note { color: var(--wt-muted); font-size: 13px; }
.warn { color: var(--wt-danger); font-size: 13px; }
fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
.getting-started { border-color: var(--wt-line); background: var(--wt-wash); }
.getting-started li + li { margin-top: .5rem; }
.help-links a { color: var(--wt-accent); text-underline-offset: 3px; }
kbd { padding: .1rem .3rem; border: 1px solid var(--wt-line); border-radius: 4px; background: var(--wt-surface); }
.advanced-sync { margin-bottom: 1rem; }
.advanced-sync summary { padding: 1rem; cursor: pointer; font-weight: 600; }
.chip { width: auto; margin: .2rem .3rem 0 0; padding: .2rem .5rem; font-size: 12px; border: 1px solid var(--wt-line); border-radius: 999px; background: var(--wt-surface); color: var(--wt-body); cursor: pointer; }
.chip:hover { border-color: var(--wt-accent); color: var(--wt-ink); }
@media (max-width: 1150px) { .review-layout { grid-template-columns: 1fr; } .workspace { padding-inline: 28px; } }
@media (max-width: 800px) {
  .app-shell { display: block; }.sidebar { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--wt-line); padding: 18px; }.page-head { margin-bottom: 18px; }.nav-label, .side-note, .version { display: none; } nav { display: flex; gap: 4px; } nav button { flex: 1; min-width: 0; justify-content: center; padding: 11px 5px; font-size: 12px; } nav button > span:first-child, .nav-count { display: none; }
  .workspace { padding: 22px 16px 40px; }.workspace-top { flex-wrap: wrap; gap: 12px; }.brand-hero { padding: 22px 20px; gap: 8px; }.hero-art { width: 85px; height: 100px; }.hero-art img { width: 76px; height: 76px; }.hero-art i { inset: 7px 0; }.brand-hero h2 span { display: inline-block; }
.brand-hero h2 { font-size: 23px; }.brand-hero p { font-size: 12px; }.overview-stats { gap: 8px; }.overview-stats article { padding: 14px 10px; }.overview-stats article > span { display: none; }.overview-stats strong { font-size: 24px; }.overview-stats small { font-size: 10px; } section { padding: 1rem; }
  .color-head, .color-row { grid-template-columns: minmax(90px, 1fr) repeat(3, 36px); gap: .35rem; padding-inline: .4rem; font-size: 12px; }
}
</style>
