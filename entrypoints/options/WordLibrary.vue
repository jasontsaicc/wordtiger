<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { renderMarkdown } from '@/src/content/markdown';
import type { ExplainResult } from '@/src/lib/messages';
import { dayLabel, type WordProgress } from '@/src/lib/review';

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
  /** 下次複習日；尚未打過或卡片損壞時是 null。 */
  nextReviewAt: number | null;
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
  { key: 'due', label: '現在可練' },
  { key: 'fresh', label: '尚未打過' },
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
const sortBy = ref<'recent' | 'word' | 'due'>('recent');
const isPhrase = (value: string) => /\s/.test(value);

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

const counts = computed(() => Object.fromEntries(
  FILTERS.map((f) => [f.key, words.value.filter((w) => inFilter(w, f.key)).length]),
) as Record<Filter, number>);
const contextTotal = computed(() =>
  words.value.reduce((total, word) => total + word.contexts.length, 0),
);
const phraseTotal = computed(() => words.value.filter((word) => isPhrase(word.word)).length);

const filtered = computed(() => {
  const query = keyword.value.trim().toLowerCase();
  return words.value
    .filter((w) => inFilter(w, filter.value) && w.word.toLowerCase().includes(query))
    .sort((a, b) => {
      if (sortBy.value === 'word') return a.word.localeCompare(b.word);
      // 沒有下次日期的排最後，它們本來就不在等一個日子。
      if (sortBy.value === 'due') {
        return (a.nextReviewAt ?? Infinity) - (b.nextReviewAt ?? Infinity)
          || a.word.localeCompare(b.word);
      }
      return (b.contexts[0]?.createdAt ?? 0) - (a.contexts[0]?.createdAt ?? 0)
        || a.word.localeCompare(b.word);
    });
});

/** 一行講完學習狀態。順序跟 wordProgress 的規則一致，這裡只負責文案。 */
function summary(item: WordItem): string {
  const drills = item.reviewCount
    ? [`練過 ${item.reviewCount} 次`, `抓到 ${item.caughtCount} 次`]
    : [];
  const next = item.nextReviewAt ? `下次${dayLabel(item.nextReviewAt)}` : '排程中';
  const state: Record<WordProgress, string> = {
    excluded: '已排除，不列入學習進度',
    mastered: '已馴服',
    needsLookup: '還不能出題 · 先查一次詞',
    fresh: '尚未打過 · 有空時再認識牠',
    due: '現在可練',
    stable: `漸漸穩定 · ${next}`,
    scheduled: next,
  };
  return [...drills, state[item.progress]].join(' · ');
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

    <div class="toolbar">
      <div class="sort">
        <button :class="{ active: sortBy === 'recent' }" @click="sortBy = 'recent'">最近加入</button>
        <button :class="{ active: sortBy === 'due' }" @click="sortBy = 'due'">下次複習</button>
        <button :class="{ active: sortBy === 'word' }" @click="sortBy = 'word'">字母排序</button>
      </div>
      <input v-model="keyword" placeholder="搜尋單字或片語" />
    </div>

    <p v-if="filtered.length === 0" class="empty">這個分類還沒有字。</p>

    <div v-else class="word-list">
      <article v-for="w in filtered" :key="w.word" class="word-card">
        <header class="word-header">
          <button class="row" :aria-expanded="selected === w.word" @click="toggle(w)">
            <h3>{{ w.word }}</h3>
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
              <small>
                AI 詞典 · {{ dictionaries[w.word]!.model ?? '未知模型' }} ·
                {{ new Date(dictionaries[w.word]!.fetchedAt).toLocaleString() }}
              </small>
              <div v-html="renderMarkdown(dictionaries[w.word]!.payload)" />
            </template>
            <template v-else>
              <p class="note">
                還沒有 AI 詞典，這個{{ isPhrase(w.word) ? '片語' : '單字' }}不會出現在今晚打老虎。
              </p>
              <button @click="lookup(w)">查一次詞</button>
              <p v-if="dictionaryErrors[w.word]" class="warn">{{ dictionaryErrors[w.word] }}</p>
            </template>
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
.sort { display: flex; }
.sort button { border-radius: 0; }
.sort button:first-child { border-radius: 5px 0 0 5px; }
.sort button:last-child { border-radius: 0 5px 5px 0; }
.sort .active { color: white; background: #6557c5; border-color: #6557c5; }
.word-list { display: grid; gap: .75rem; }
.word-card { padding: 1rem; border: 1px solid #e2e8f0; border-radius: 12px; background: #f8fafc; }
.word-header { align-items: flex-start; gap: 1rem; }
.filters { display: flex; flex-wrap: wrap; gap: .4rem; margin-bottom: .8rem; }
.filters button { color: #475569; }
.filters .active { color: white; background: #6557c5; border-color: #6557c5; }
.tally { margin-left: .3rem; color: #94a3b8; font-size: 12px; }
.filters .active .tally { color: #ded9ff; }
.row { flex: 1; min-width: 0; padding: 0; border: 0; background: none; text-align: left; }
.row h3 { font-size: 22px; }
.summary { display: block; margin-top: .2rem; color: #64748b; font-size: 13px; }
.warn { color: #b4451f; font-size: 13px; }
.actions { gap: .4rem; margin-left: auto; flex-wrap: wrap; justify-content: flex-end; }
.danger { color: #b4451f; }
.dictionary { margin: 1rem 0; border: 1px solid #dbe4f0; border-radius: 10px; padding: 1rem; background: white; }
.dictionary :deep(.h) { margin-top: 1rem; color: #6557c5; font-weight: 700; }
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
