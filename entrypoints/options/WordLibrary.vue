<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { renderMarkdown } from '@/src/content/markdown';

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
  /** 由新到舊 */
  contexts: ContextItem[];
}

interface CachedWord {
  word: string;
  payload: string;
  model?: string;
  fetchedAt: number;
}

const words = ref<WordItem[]>([]);
const dictionaries = ref<Record<string, CachedWord | null>>({});
const selected = ref<string | null>(null);
const translations = ref<Record<string, string>>({});
const keyword = ref('');
const statusFilter = ref<'all' | 'unknown' | 'known'>('unknown');
const sortBy = ref<'recent' | 'word'>('recent');
const isPhrase = (value: string) => /\s/.test(value);

onMounted(reload);

async function reload() {
  // sendMessage 在 background 出錯時會拿到 undefined。直接指派進去的話,
  // filtered 這個 computed 會在 render 中途炸掉,整個元件變空白。
  words.value = (await browser.runtime.sendMessage({ type: 'listWords' })) ?? [];
}

const contextTotal = computed(() =>
  words.value.reduce((total, word) => total + word.contexts.length, 0),
);
const phraseTotal = computed(() => words.value.filter((word) => isPhrase(word.word)).length);
const knownTotal = computed(() => words.value.filter((word) => word.status === 'known').length);
const unknownWordTotal = computed(() => words.value
  .filter((word) => !isPhrase(word.word) && word.status === 'unknown').length);

const filtered = computed(() => {
  const query = keyword.value.trim().toLowerCase();
  return words.value
    .filter((w) =>
      (statusFilter.value === 'all' || w.status === statusFilter.value)
      && w.word.includes(query),
    )
    .sort((a, b) => sortBy.value === 'word'
      ? a.word.localeCompare(b.word)
      : (b.contexts[0]?.createdAt ?? 0) - (a.contexts[0]?.createdAt ?? 0)
        || a.word.localeCompare(b.word));
});

async function toggleDictionary(word: string) {
  if (selected.value === word) {
    selected.value = null;
    return;
  }
  selected.value = word;
  if (!(word in dictionaries.value)) {
    dictionaries.value[word] = await browser.runtime.sendMessage({
      type: 'getCachedWord', word,
    }) ?? null;
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
        <p class="note">
          {{ unknownWordTotal }} 隻生詞 · {{ phraseTotal }} 組片語 ·
          {{ knownTotal }} 隻已馴服 · {{ contextTotal }} 條語境
        </p>
      </div>
      <button @click="exportJson">匯出 JSON</button>
    </div>

    <div class="toolbar">
      <div class="sort">
        <button :class="{ active: sortBy === 'recent' }" @click="sortBy = 'recent'">最近加入</button>
        <button :class="{ active: sortBy === 'word' }" @click="sortBy = 'word'">字母排序</button>
      </div>
      <input v-model="keyword" placeholder="搜尋單字或片語" />
      <select v-model="statusFilter">
        <option value="unknown">生詞</option>
        <option value="known">已馴服</option>
        <option value="all">全部</option>
      </select>
    </div>

    <p v-if="filtered.length === 0" class="empty">沒有符合的收藏。</p>

    <div v-else class="word-list">
      <article v-for="w in filtered" :key="w.word" class="word-card">
        <header class="word-header">
          <div>
            <h3>{{ w.word }}</h3>
            <span class="status" :class="w.status">
              {{ isPhrase(w.word) ? '片語' : (w.status === 'unknown' ? '生詞' : '已馴服') }}
            </span>
            <span class="count">{{ w.contexts.length }} 條語境</span>
          </div>
          <div class="actions">
            <button v-if="!isPhrase(w.word)" @click="toggleDictionary(w.word)">
              {{ selected === w.word ? '收起詞典' : 'AI 詞典' }}
            </button>
            <button v-if="!isPhrase(w.word)" @click="setStatus(w.word, w.status === 'unknown' ? 'known' : 'unknown')">
              {{ w.status === 'unknown' ? '標成已馴服' : '改回生詞' }}
            </button>
            <button class="danger" @click="remove(w.word)">刪除</button>
          </div>
        </header>

        <div v-if="selected === w.word" class="dictionary">
          <template v-if="dictionaries[w.word]">
            <small>
              AI 詞典 · OpenAI / {{ dictionaries[w.word]!.model ?? '未知模型' }} ·
              {{ new Date(dictionaries[w.word]!.fetchedAt).toLocaleString() }}
            </small>
            <div v-html="renderMarkdown(dictionaries[w.word]!.payload)" />
          </template>
          <p v-else class="note">尚無 AI 詞典；可先「立即同步」，若其他裝置也沒查過，再回網頁按 A。</p>
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
.toolbar select { width: auto; padding: .55rem; border: 1px solid #cbd5e1; border-radius: 8px; }
.sort { display: flex; }
.sort button { border-radius: 0; }
.sort button:first-child { border-radius: 5px 0 0 5px; }
.sort button:last-child { border-radius: 0 5px 5px 0; }
.sort .active { color: white; background: #6557c5; border-color: #6557c5; }
.word-list { display: grid; gap: .75rem; }
.word-card { padding: 1rem; border: 1px solid #e2e8f0; border-radius: 12px; background: #f8fafc; }
.word-header { align-items: flex-start; gap: 1rem; }
.word-header h3 { display: inline; margin-right: .6rem; font-size: 24px; }
.status { padding: .12rem .45rem; border-radius: 999px; font-size: 12px; }
.status.unknown { color: #5d4db6; background: #eeeaff; }
.status.known { color: #317045; background: #e5f5e9; }
.count { margin-left: .5rem; color: #777; font-size: 13px; }
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
