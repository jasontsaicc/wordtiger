<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';

interface WordItem {
  word: string;
  status: 'unknown' | 'known';
  contextCount: number;
}

interface ContextItem {
  sentence: string;
  url: string;
  title: string;
  createdAt: number;
}

const words = ref<WordItem[]>([]);
const contexts = ref<ContextItem[]>([]);
const selected = ref<string | null>(null);
const keyword = ref('');
const statusFilter = ref<'all' | 'unknown' | 'known'>('all');

onMounted(reload);

async function reload() {
  // sendMessage 在 background 出錯時會拿到 undefined。直接指派進去的話,
  // filtered 這個 computed 會在 render 中途炸掉,整個元件變空白。
  words.value = (await browser.runtime.sendMessage({ type: 'listWords' })) ?? [];
}

const filtered = computed(() =>
  words.value.filter((w) => {
    if (statusFilter.value !== 'all' && w.status !== statusFilter.value) return false;
    return w.word.includes(keyword.value.trim().toLowerCase());
  }),
);

async function openWord(word: string) {
  selected.value = word;
  contexts.value = (await browser.runtime.sendMessage({ type: 'getContexts', word })) ?? [];
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

/**
 * 匯出走 Blob 加一個暫時的 <a>。options 頁是擴充功能自己的頁面,
 * 不受網頁沙箱限制,這是最短的做法,不需要 downloads 權限。
 */
async function exportJson() {
  const bundle = await browser.runtime.sendMessage({ type: 'exportData' });
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vocab-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <section>
    <h2>我的生詞 ({{ filtered.length }} / {{ words.length }})</h2>

    <div class="toolbar">
      <input v-model="keyword" placeholder="搜尋單字" />
      <select v-model="statusFilter">
        <option value="all">全部</option>
        <option value="unknown">生詞</option>
        <option value="known">已認得</option>
      </select>
      <button @click="exportJson">匯出 JSON</button>
    </div>

    <p v-if="filtered.length === 0" class="note">沒有符合的字。</p>

    <table v-else>
      <tr v-for="w in filtered" :key="w.word">
        <td class="word" @click="openWord(w.word)">{{ w.word }}</td>
        <td>{{ w.contextCount }} 條語境</td>
        <td>
          <button v-if="w.status === 'unknown'" @click="setStatus(w.word, 'known')">
            標成已認得
          </button>
          <button v-else @click="setStatus(w.word, 'unknown')">改回生詞</button>
        </td>
        <td><button class="danger" @click="remove(w.word)">刪除</button></td>
      </tr>
    </table>

    <div v-if="selected">
      <h3>{{ selected }} 的語境</h3>
      <p v-if="contexts.length === 0" class="note">這個字還沒有語境。</p>
      <blockquote v-for="(c, i) in contexts" :key="i">
        {{ c.sentence }}
        <a :href="c.url" target="_blank">{{ c.title }}</a>
      </blockquote>
    </div>
  </section>
</template>

<style scoped>
.toolbar { display: flex; gap: .5rem; margin-bottom: .75rem; }
.toolbar input { flex: 1; padding: .4rem; }
table { width: 100%; border-collapse: collapse; }
td { padding: .4rem; border-bottom: 1px solid #ddd; }
td.word { cursor: pointer; font-weight: 600; }
.danger { color: #b4451f; }
.note { opacity: .6; font-size: 13px; }
blockquote { border-left: 3px solid #c8c0ff; margin: .5rem 0; padding-left: .75rem; }
</style>
