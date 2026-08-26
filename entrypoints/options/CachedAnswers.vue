<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { renderMarkdown } from '@/src/content/markdown';

interface CachedWord {
  word: string;
  payload: string;
  model?: string;
  fetchedAt: number;
}

const rows = ref<CachedWord[]>([]);
const keyword = ref('');
const selected = ref<CachedWord | null>(null);

const filtered = computed(() => {
  const q = keyword.value.trim().toLowerCase();
  return q ? rows.value.filter((row) => row.word.includes(q)) : rows.value;
});

onMounted(reload);

async function reload() {
  rows.value = (await browser.runtime.sendMessage({ type: 'listCachedWords' })) ?? [];
}

async function remove(row: CachedWord) {
  if (!confirm(`清除「${row.word}」的快取回答？下次查詞會重新呼叫 AI。`)) return;
  await browser.runtime.sendMessage({ type: 'deleteCachedWord', word: row.word });
  if (selected.value?.word === row.word) selected.value = null;
  await reload();
}
</script>

<template>
  <section>
    <h2>AI 回答庫</h2>
    <p class="note">老虎已經查過的單字與片語，下次不用再花一次 AI 費用；登入後會與同一帳號的裝置同步。</p>
    <input v-model="keyword" class="search" placeholder="搜尋快取單字或片語" />

    <div class="layout">
      <div class="list">
        <button v-for="row in filtered" :key="row.word" @click="selected = row">
          <b>{{ row.word }}</b>
          <small>{{ row.model ?? '未知模型' }} · {{ new Date(row.fetchedAt).toLocaleString() }}</small>
        </button>
        <p v-if="filtered.length === 0" class="note">還沒有留下回答。回到文章按 A，這裡就會慢慢累積。</p>
      </div>

      <article v-if="selected">
        <header>
          <div><h3>{{ selected.word }}</h3><small>AI / {{ selected.model ?? '未知模型' }}</small></div>
          <button class="danger" @click="remove(selected)">清除快取</button>
        </header>
        <div class="answer" v-html="renderMarkdown(selected.payload)" />
      </article>
    </div>
  </section>
</template>

<style scoped>
.search { box-sizing: border-box; width: 100%; padding: .55rem; margin-bottom: 1rem; }
.layout { display: grid; grid-template-columns: 220px 1fr; gap: 1rem; align-items: start; }
.list { max-height: 70vh; overflow: auto; }
.list button { display: block; width: 100%; padding: .65rem; text-align: left; background: white; border: 0; border-bottom: 1px solid #ddd; cursor: pointer; }
small { display: block; opacity: .6; }
article { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; min-width: 0; }
header { display: flex; align-items: start; justify-content: space-between; gap: 1rem; border-bottom: 1px solid #eee; padding-bottom: .75rem; }
h3 { margin: 0; }
.answer { margin-top: 1rem; }
.answer :deep(.h) { margin-top: 1rem; color: #6557c5; font-weight: 700; }
.answer :deep(p), .answer :deep(ul) { margin: .4rem 0; }
.danger { color: #b4451f; }
.note { opacity: .6; font-size: 13px; }
</style>
