<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { groupActivity, localDay, monthCells, type ActivityWord } from '@/src/lib/activity';

interface WordItem extends ActivityWord {
  status: 'unknown' | 'known';
}

const words = ref<WordItem[]>([]);
const error = ref('');
const today = localDay(Date.now());
const month = ref(today.slice(0, 7));
const selectedDate = ref(today);

const days = computed(() => groupActivity(words.value));
const byDate = computed(() => new Map(days.value.map((day) => [day.date, day])));
const cells = computed(() => monthCells(month.value));
const monthDays = computed(() => days.value.filter((day) => day.date.startsWith(month.value)));
const selected = computed(() => byDate.value.get(selectedDate.value));
const monthNewWords = computed(() =>
  monthDays.value.reduce((total, day) => total + day.newWords.length, 0));
const monthPages = computed(() => new Set(
  monthDays.value.flatMap((day) => day.pages.map((page) => page.url)),
).size);
const learning = computed(() => words.value.filter((word) => word.status === 'unknown').length);
const known = computed(() => words.value.filter((word) => word.status === 'known').length);

onMounted(async () => {
  try {
    words.value = (await browser.runtime.sendMessage({ type: 'listWords' })) ?? [];
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
});

function activity(date: string) {
  return byDate.value.get(date);
}

function changeMonth() {
  selectedDate.value = monthDays.value[0]?.date ?? `${month.value}-01`;
}
</script>

<template>
  <section class="dashboard">
    <header class="heading">
      <div>
        <p class="eyebrow">LEARNING ACTIVITY</p>
        <h2>學習足跡</h2>
        <p>只記錄你收藏過內容的日期與來源，不追蹤一般瀏覽紀錄。</p>
      </div>
      <input v-model="month" type="month" aria-label="選擇月份" @change="changeMonth" />
    </header>

    <p v-if="error" class="error">載入失敗：{{ error }}</p>

    <div class="stats">
      <article><b>{{ monthNewWords }}</b><span>本月新收藏</span></article>
      <article><b>{{ monthPages }}</b><span>本月來源文章</span></article>
      <article><b>{{ learning }}</b><span>仍在學習</span></article>
      <article><b>{{ known }}</b><span>已馴服</span></article>
    </div>

    <div class="calendar">
      <div v-for="label in ['日', '一', '二', '三', '四', '五', '六']" :key="label" class="weekday">
        {{ label }}
      </div>
      <template v-for="(cell, index) in cells" :key="cell?.date ?? `blank-${index}`">
        <span v-if="!cell" class="blank" />
        <button v-else :class="{ selected: selectedDate === cell.date, active: activity(cell.date) }"
          :aria-label="cell.date" @click="selectedDate = cell.date">
          <b>{{ cell.day }}</b>
          <small v-if="activity(cell.date)">
            {{ activity(cell.date)!.newWords.length }} 詞 · {{ activity(cell.date)!.pages.length }} 文
          </small>
        </button>
      </template>
    </div>

    <article class="detail">
      <h3>{{ selectedDate }}</h3>
      <template v-if="selected">
        <div v-if="selected.newWords.length">
          <h4>新收藏</h4>
          <div class="chips"><span v-for="word in selected.newWords" :key="word">{{ word }}</span></div>
        </div>
        <div v-if="selected.pages.length">
          <h4>來源文章</h4>
          <ul>
            <li v-for="page in selected.pages" :key="page.url">
              <a :href="page.url" target="_blank" rel="noreferrer">{{ page.title || page.url }}</a>
              <small>{{ page.words.join('、') }}</small>
            </li>
          </ul>
        </div>
      </template>
      <p v-else class="empty">這天沒有收藏活動。</p>
    </article>
  </section>
</template>

<style scoped>
.dashboard { padding: 1.4rem; }
.heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; }
.heading h2, .heading p { margin: 0; }
.heading > div > p:last-child { color: #64748b; font-size: 13px; }
.heading input { width: auto; }
.eyebrow { color: #0e7490; font-size: 11px; font-weight: 800; letter-spacing: .13em; }
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: .7rem; margin: 1.2rem 0; }
.stats article { padding: .9rem; border-radius: 12px; background: #f8fafc; text-align: center; }
.stats b, .stats span { display: block; }
.stats b { color: #0f172a; font-size: 24px; }
.stats span { color: #64748b; font-size: 12px; }
.calendar { display: grid; grid-template-columns: repeat(7, 1fr); gap: .35rem; }
.weekday { padding: .25rem; color: #64748b; font-size: 12px; font-weight: 700; text-align: center; }
.calendar button, .blank { min-height: 72px; }
.calendar button { display: flex; flex-direction: column; align-items: flex-start; padding: .5rem; border: 1px solid #e2e8f0; background: white; }
.calendar button.active { border-color: #67e8f9; background: #ecfeff; }
.calendar button.selected { outline: 3px solid #f59e0b; outline-offset: 1px; }
.calendar button small { margin-top: auto; color: #0e7490; font-size: 11px; }
.detail { margin-top: 1rem; padding: 1rem; border: 1px solid #e2e8f0; border-radius: 12px; background: #f8fafc; }
.detail h3, .detail h4 { margin: 0; }
.detail h4 { margin-top: .8rem; color: #475569; font-size: 13px; }
.chips { display: flex; flex-wrap: wrap; gap: .4rem; margin-top: .4rem; }
.chips span { padding: .2rem .55rem; border-radius: 999px; color: #3730a3; background: #e0e7ff; }
.detail ul { margin: .4rem 0 0; padding-left: 1.2rem; }
.detail li + li { margin-top: .5rem; }
.detail li small { display: block; color: #64748b; }
.detail a { color: #0e7490; }
.empty { color: #64748b; }
.error { color: #b91c1c; }
@media (max-width: 700px) {
  .stats { grid-template-columns: 1fr 1fr; }
  .calendar button, .blank { min-height: 58px; }
  .calendar button small { font-size: 9px; }
}
</style>
