<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { renderMarkdown } from '@/src/content/markdown';
import type { ExplainResult } from '@/src/lib/messages';
import type { WordProgress } from '@/src/lib/review';

interface ContextItem {
  id: string;
  sentence: string;
  url: string;
  title: string;
  createdAt: number;
}

interface WordItem {
  word: string;
  status: 'unknown' | 'known';
  createdAt: number;
  /** 打老虎的累計次數與其中抓到的次數。 */
  reviewCount: number;
  caughtCount: number;
  progress: WordProgress;
  /** 由新到舊。 */
  contexts: ContextItem[];
}

interface CachedWord {
  word: string;
  payload: string;
  surface?: string;
  sentence?: string;
  model?: string;
  fetchedAt: number;
}

type Filter = 'all' | 'due' | 'fresh' | 'scheduled' | 'mastered';

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'due', label: '今天排到' },
  { key: 'fresh', label: '還沒練過' },
  { key: 'scheduled', label: '排程中' },
  { key: 'mastered', label: '已馴服' },
];

const words = ref<WordItem[]>([]);
const dictionaries = ref<Record<string, CachedWord | null>>({});
const dictionaryLoading = ref<Record<string, boolean>>({});
const dictionaryErrors = ref<Record<string, string>>({});
const selected = ref<string | null>(null);
const translations = ref<Record<string, string>>({});
const keyword = ref('');
const filter = ref<Filter>('all');
/** 單字或片語，跟學習進度是兩個獨立的軸，可以同時成立。 */
const kind = ref<'all' | 'word' | 'phrase'>('all');
const sortBy = ref<'recent' | 'word'>('recent');
const isPhrase = (value: string) => /\s/.test(value);
const inKind = (item: WordItem) =>
  kind.value === 'all' || (kind.value === 'phrase') === isPhrase(item.word);

onMounted(reload);

async function reload() {
  // Background 失敗時維持陣列型別，避免 computed render error。
  words.value = (await browser.runtime.sendMessage({ type: 'listWords' })) ?? [];
}

/** 「排程中」含漸漸穩定；「還不能出題」與「已排除」只出現在全部。 */
function inFilter(item: WordItem, key: Filter): boolean {
  if (key === 'all') return true;
  if (key === 'scheduled') return item.progress === 'scheduled' || item.progress === 'stable';
  return item.progress === key;
}

// 數字跟著單字／片語一起收斂，按下去看到幾筆就先寫幾筆。
const counts = computed(() => Object.fromEntries(
  FILTERS.map((f) => [f.key, words.value.filter((w) => inFilter(w, f.key) && inKind(w)).length]),
) as Record<Filter, number>);
const contextTotal = computed(() =>
  words.value.reduce((total, word) => total + word.contexts.length, 0),
);
const phraseTotal = computed(() => words.value.filter((word) => isPhrase(word.word)).length);

const filtered = computed(() => {
  const query = keyword.value.trim().toLowerCase();
  return words.value
    .filter((w) => inFilter(w, filter.value) && inKind(w) && w.word.toLowerCase().includes(query))
    .sort((a, b) => {
      if (sortBy.value === 'word') return a.word.localeCompare(b.word);
      return (b.contexts[0]?.createdAt ?? 0) - (a.contexts[0]?.createdAt ?? 0)
        || a.word.localeCompare(b.word);
    });
});

/**
 * 一行講完學習狀態。順序跟 wordProgress 的規則一致，這裡只負責文案。
 * 「遇到」數的是語境筆數，而 addContext 以 (句子, 網址) 去重，
 * 所以同一句在同一頁按幾次 A 都只算一次，數的是不同語境而不是按鍵次數。
 */
function summary(item: WordItem): string {
  const met = item.contexts.length ? [`遇到 ${item.contexts.length} 次`] : [];
  const drills = item.reviewCount
    ? [`練過 ${item.reviewCount} 次`, `抓到 ${item.caughtCount} 次`]
    : [];
  const state: Record<WordProgress, string> = {
    excluded: '已排除，不列入學習進度',
    mastered: '已馴服',
    needsLookup: '還不能出題 · 先查一次詞',
    // 1.8.0 之前練過的字有 reviewLog 卻沒有 fsrsCard，跟從沒練過的一樣落在 fresh。
    // 兩者不能講同一句話，否則會出現「練過 1 次 · 還沒練過」這種自相矛盾的列。
    fresh: item.reviewCount ? '升級後排程重新開始' : '還沒練過，去今晚打老虎遇遇看',
    due: '今天排到',
    stable: '漸漸穩定',
    scheduled: '排程中',
  };
  return [...met, ...drills, state[item.progress]].join(' · ');
}

async function toggle(item: WordItem) {
  if (selected.value === item.word) {
    selected.value = null;
    return;
  }
  selected.value = item.word;
  // 展開只讀本機快取。查詞要花 AI 額度，交給使用者自己按。
  if (dictionaries.value[item.word] !== undefined) return;
  dictionaries.value[item.word] = await browser.runtime.sendMessage({
    type: 'getCachedWord', word: item.word,
  }) ?? null;
}

async function lookup(item: WordItem) {
  const { word } = item;
  dictionaryLoading.value[word] = true;
  dictionaryErrors.value[word] = '';
  try {
    const result = await browser.runtime.sendMessage({
      type: 'lookup', word, surface: word,
      sentence: item.contexts[0]?.sentence ?? '',
    }) as ExplainResult | undefined;
    if (!result?.ok) {
      dictionaryErrors.value[word] = result?.error ?? '背景程式沒有回應';
      return;
    }
    dictionaries.value[word] = await browser.runtime.sendMessage({
      type: 'getCachedWord', word,
    }) ?? null;
    if (!dictionaries.value[word]) {
      dictionaryErrors.value[word] = 'AI 回答沒有寫進快取，請再試一次。';
      return;
    }
    // 有了詞典就能出題，狀態要從「還不能出題」跟著變。
    await reload();
  } catch (err) {
    dictionaryErrors.value[word] = err instanceof Error ? err.message : String(err);
  } finally {
    dictionaryLoading.value[word] = false;
  }
}

/**
 * AI 這次答得不好時重問一次。快取命中會回同一份答案，所以要先打上 tombstone；
 * putCached 之後會用同一個 word 主鍵整列覆蓋回來，同步端也看得到這次更新。
 */
async function relookup(item: WordItem) {
  await browser.runtime.sendMessage({ type: 'deleteCachedWord', word: item.word });
  dictionaries.value[item.word] = null;
  await lookup(item);
}

async function translateContext(context: ContextItem) {
  translations.value[context.id] = '翻譯中…';
  const result = await browser.runtime.sendMessage({
    type: 'explain', kind: 'translate', sentence: context.sentence,
  });
  translations.value[context.id] = result?.ok
    ? result.text
    : `翻譯失敗：${result?.error ?? '背景程式沒有回應'}`;
}

async function remove(word: string) {
  if (!confirm(`確定刪除「${word}」?語境也會一起看不到。`)) return;
  await browser.runtime.sendMessage({ type: 'deleteWord', word });
  if (selected.value === word) selected.value = null;
  await reload();
}

async function setStatus(word: string, status: 'unknown' | 'known') {
  await browser.runtime.sendMessage({ type: 'setWordStatus', word, status });
  await reload();
}

/** options 頁用 Blob 下載，不需要額外的 downloads 權限。 */
async function exportJson() {
  const bundle = await browser.runtime.sendMessage({ type: 'exportData' });
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `wordtiger-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <section>
    <div class="page-title">
      <div>
        <h2>我的攔路虎</h2>
        <p class="note">{{ phraseTotal }} 組片語 · {{ contextTotal }} 條語境</p>
      </div>
      <button @click="exportJson">匯出 JSON</button>
    </div>

    <div class="filters">
      <button v-for="f in FILTERS" :key="f.key" :class="{ active: filter === f.key }"
        :aria-pressed="filter === f.key" @click="filter = f.key">
        {{ f.label }} <span class="tally">{{ counts[f.key] }}</span>
      </button>
    </div>
    <p class="note filter-note">今晚打老虎從「今天排到」和「還沒練過」兩堆各抓，湊滿 5 題。</p>

    <div class="toolbar">
      <div class="sort">
        <button :class="{ active: sortBy === 'recent' }" @click="sortBy = 'recent'">最近加入</button>
        <button :class="{ active: sortBy === 'word' }" @click="sortBy = 'word'">字母排序</button>
      </div>
      <input v-model="keyword" placeholder="搜尋單字或片語" />
      <select v-model="kind" class="kind" aria-label="單字或片語">
        <option value="all">全部</option>
        <option value="word">單字</option>
        <option value="phrase">片語</option>
      </select>
    </div>

    <p v-if="filtered.length === 0" class="empty">這個分類還沒有字。</p>

    <div v-else class="word-list">
      <article v-for="w in filtered" :key="w.word" class="word-card">
        <header class="word-header">
          <button class="row" :aria-expanded="selected === w.word" @click="toggle(w)">
            <h3>{{ w.word }}</h3><span v-if="isPhrase(w.word)" class="kindtag">片語</span>
            <span class="summary">{{ summary(w) }}</span>
          </button>
          <div class="actions">
            <button v-if="!isPhrase(w.word)"
              @click="setStatus(w.word, w.status === 'unknown' ? 'known' : 'unknown')">
              {{ w.status === 'unknown' ? '標成已馴服' : '改回生詞' }}
            </button>
            <button class="danger" @click="remove(w.word)">刪除</button>
          </div>
        </header>

        <template v-if="selected === w.word">
          <div class="dictionary">
            <p v-if="dictionaryLoading[w.word]" class="note">
              英文老師正在整理這個{{ isPhrase(w.word) ? '片語' : '單字' }}…
            </p>
            <template v-else-if="dictionaries[w.word]">
              <div class="dictionary-head">
                <small>
                  AI 詞典 · {{ dictionaries[w.word]!.model ?? '未知模型' }} ·
                  {{ new Date(dictionaries[w.word]!.fetchedAt).toLocaleString() }}
                </small>
                <button @click="relookup(w)">重查</button>
              </div>
              <div v-html="renderMarkdown(dictionaries[w.word]!.payload)" />
            </template>
            <template v-else>
              <p class="note">
                還沒有 AI 詞典，這個{{ isPhrase(w.word) ? '片語' : '單字' }}不會出現在今晚打老虎。
              </p>
              <button @click="lookup(w)">查一次詞</button>
            </template>
            <p v-if="dictionaryErrors[w.word]" class="warn">{{ dictionaryErrors[w.word] }}</p>
          </div>

          <p v-if="w.contexts.length === 0" class="no-context">尚未保存語境。</p>
          <ol v-else class="contexts">
            <li v-for="(c, i) in w.contexts" :key="c.id">
              <span class="index">{{ i + 1 }}</span>
              <div class="context-body">
                <p class="sentence">{{ c.sentence }}</p>
                <p v-if="translations[c.id]" class="translation">{{ translations[c.id] }}</p>
                <footer>
                  <time :datetime="new Date(c.createdAt).toISOString()">
                    {{ new Date(c.createdAt).toLocaleString() }}
                  </time>
                  <a :href="c.url" target="_blank" rel="noreferrer">{{ c.title || c.url }}</a>
                  <button v-if="!translations[c.id]" @click="translateContext(c)">翻譯</button>
                </footer>
              </div>
            </li>
          </ol>
        </template>
      </article>
    </div>
  </section>
</template>

<style scoped>
.page-title, .word-header, .toolbar, .actions, footer { display: flex; align-items: center; }
.page-title { justify-content: space-between; margin-bottom: 1rem; }
.page-title h2, .page-title p, h3 { margin: 0; }
.toolbar { gap: .6rem; flex-wrap: wrap; margin-bottom: 1rem; }
.toolbar input { flex: 1; min-width: 180px; padding: .55rem .7rem; border: 1px solid #cbd5e1; border-radius: 8px; }
.kind { padding: .5rem .6rem; border: 1px solid #cbd5e1; border-radius: 8px; color: #334155; background: white; font: inherit; cursor: pointer; }
.sort { display: flex; }
.sort button { border-radius: 0; }
.sort button:first-child { border-radius: 5px 0 0 5px; }
.sort button:last-child { border-radius: 0 5px 5px 0; }
.sort .active { color: white; background: #6557c5; border-color: #6557c5; }
.word-list { display: grid; gap: .75rem; }
.word-card { padding: 1rem; border: 1px solid #e2e8f0; border-radius: 12px; background: #f8fafc; }
.word-header { align-items: flex-start; gap: 1rem; }
.filters { display: flex; flex-wrap: wrap; gap: .4rem; margin-bottom: .4rem; }
.filters button { color: #475569; }
.filters .active { color: white; background: #6557c5; border-color: #6557c5; }
.tally { margin-left: .3rem; color: #94a3b8; font-size: 12px; }
.filters .active .tally { color: #ded9ff; }
.row { flex: 1; min-width: 0; padding: 0; border: 0; background: none; text-align: left; }
/* h3 改 inline，徽章才跟得上同一行而不被擠到下一行。 */
.row h3 { display: inline; vertical-align: middle; font-size: 22px; }
.kindtag { display: inline-block; vertical-align: middle; margin-left: .5rem; padding: .1rem .45rem; border: 1px solid #dbe4f0; border-radius: 999px; color: #64748b; background: white; font-size: 11px; font-weight: 600; }
.summary { display: block; margin-top: .2rem; color: #64748b; font-size: 13px; }
.warn { color: #b4451f; font-size: 13px; }
.actions { gap: .4rem; margin-left: auto; flex-wrap: wrap; justify-content: flex-end; }
.danger { color: #b4451f; }
.filter-note { margin: 0 0 .9rem; }
.dictionary { margin: 1rem 0; border: 1px solid #dbe4f0; border-radius: 10px; padding: 1rem; background: white; }
.dictionary-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
.dictionary :deep(.h) { margin-top: 1rem; color: #b45309; font-weight: 700; }
.dictionary :deep(p), .dictionary :deep(ul) { margin: .4rem 0; }
.contexts { margin: 1rem 0 0; padding: 0; list-style: none; }
.contexts li { display: flex; gap: .7rem; padding: .8rem 0; border-top: 1px solid #eee; }
.index { flex: 0 0 24px; height: 24px; border-radius: 50%; color: white; background: #29282d; text-align: center; font: 12px/24px system-ui, sans-serif; }
.context-body { min-width: 0; flex: 1; }
.sentence { margin: 0; font-size: 16px; }
.translation { margin: .4rem 0 0; color: #4d4690; }
footer { gap: .65rem; margin-top: .45rem; color: #777; font-size: 12px; }
footer a { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
footer button { margin-left: auto; }
.no-context, .empty { padding: 1rem; color: #777; background: #f7f7f8; }
.note, small { color: #777; font-size: 13px; }
button { padding: .45rem .65rem; border: 1px solid #cbd5e1; border-radius: 7px; color: #334155; background: white; cursor: pointer; }
button:focus-visible, input:focus, select:focus { outline: 3px solid #c7d2fe; outline-offset: 1px; }

@media (max-width: 700px) {
  .word-header { display: block; }
  .actions { margin-top: .7rem; justify-content: flex-start; }
  footer { align-items: flex-start; flex-wrap: wrap; }
  footer a { width: 100%; order: 3; }
}
</style>
