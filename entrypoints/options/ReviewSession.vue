<script setup lang="ts">
import { ref } from 'vue';
import { renderMarkdown } from '@/src/content/markdown';
import { stripQuiz } from '@/src/lib/prompt';
import { speak } from '@/src/content/speak';
import type { ReviewItem } from '@/src/lib/db';

const props = defineProps<{
  item: ReviewItem | null;
  done: number;
  total: number;
  caught: number;
  todayDone: number;
}>();
const emit = defineEmits<{
  reviewed: [{ word: string; remembered: boolean }];
  nextRound: [];
}>();

const revealed = ref(false);
const busy = ref(false);
const error = ref('');

async function grade(remembered: boolean) {
  if (!props.item || busy.value) return;
  busy.value = true;
  error.value = '';
  // 回傳的下次日期不顯示，只當成功訊號：null 代表沒寫進去，要重試。
  const nextReviewAt = await browser.runtime.sendMessage({
    type: 'reviewWord', word: props.item.word, remembered,
  }) as number | null;
  busy.value = false;
  if (!nextReviewAt) {
    error.value = '這題沒有存成功，請再試一次。';
    return;
  }
  emit('reviewed', { word: props.item.word, remembered });
}

async function master() {
  if (!props.item || busy.value) return;
  busy.value = true;
  error.value = '';
  // 記練習與改狀態由 background 一次完成，避免只成功一半還顯示成功。
  const saved = await browser.runtime.sendMessage({
    type: 'masterWord', word: props.item.word,
  });
  busy.value = false;
  if (!saved) {
    error.value = '這個字沒有存成功，請再試一次。';
    return;
  }
  emit('reviewed', { word: props.item.word, remembered: true });
}

function wordLabel(item: ReviewItem): string {
  return item.surface && item.surface.toLowerCase() !== item.word.toLowerCase()
    ? `${item.surface} → ${item.word}` : item.word;
}
</script>

<template>
  <section class="review-shell">
    <header class="review-head">
      <div>
        <p class="eyebrow">WORDTIGER REVIEW</p>
        <h2>今晚打老虎</h2>
        <p>先回想，再看答案，最後選擇記得或忘了。</p>
      </div>
    </header>

    <div v-if="total && item" class="progress-wrap">
      <span>本輪 {{ total }} 題</span>
      <div class="paws" aria-hidden="true">
        <span v-for="n in total" :key="n" :class="{ done: n <= done }">●</span>
      </div>
      <span>今天已練 {{ todayDone }} 題</span>
      <progress class="sr-only" :value="done" :max="total">{{ done }}／{{ total }}</progress>
    </div>

    <div v-if="total === 0" class="empty" aria-live="polite">
      <h3>今晚無虎可打</h3>
      <p>目前沒有到期題目，安心去讀英文吧。</p>
    </div>

    <div v-else-if="!item" class="finish" aria-live="polite">
      <div class="celebration" aria-hidden="true"><i v-for="n in 18" :key="n" class="confetti"
        :style="{ '--dx': `${Math.cos(n * 2.4) * (65 + n * 3)}px`, '--dy': `${Math.sin(n * 2.4) * 85 - 20}px`, '--spin': `${n * 53}deg`, background: ['#ffa44f', '#9b76ed', '#42c5c3', '#ffc5dd'][n % 4] }" /></div>
      <img src="/icons/128.png" alt="" />
      <h3>這一輪，又前進了。</h3>
      <p>這一輪 {{ caught }}／{{ done }} 抓到。</p>
      <p class="note">今天已練 {{ todayDone }} 題。溜走的會再排回來，不用追。</p>
      <button class="next-round" @click="emit('nextRound')">再抓一輪</button>
    </div>

    <article v-else class="review-card">
      <div class="card-meta">
        <span>{{ item.isPattern ? '句型' : item.isPhrase ? '片語' : '單字' }}</span>
        <span>第 {{ done + 1 }} 題 ／ 共 {{ total }} 題</span>
      </div>
      <template v-if="item.isPhrase">
        <p class="question">
          {{ item.isPattern
            ? '把句型換成你的工作情境，口頭造一句。'
            : '先用自己的話說：這個片語在原句裡是什麼意思？什麼情況會用？' }}
        </p>
        <h3 class="word">{{ wordLabel(item) }}</h3>
        <blockquote v-if="item.context">{{ item.context.sentence }}</blockquote>
      </template>
      <template v-else>
        <p class="question">
          {{ item.context ? '先讀原句，想想這個字在這裡是什麼意思。' : '先想想：這個字是什麼意思？' }}
        </p>
        <h3 class="word">{{ wordLabel(item) }}</h3>
        <blockquote v-if="item.context">{{ item.context.sentence }}</blockquote>
      </template>

      <button class="listen" type="button"
        @click="speak(item.isPhrase ? item.context?.sentence ?? item.word : item.surface ?? item.word)">
        {{ item.isPhrase && item.context ? '🔊 AI 原句' : '🔊 AI 發音' }}
      </button>
      <p class="voice-note">AI 產生語音；若端點不支援，會改用裝置發音。</p>
      <button v-if="!revealed" class="reveal" @click="revealed = true">
        看答案
      </button>

      <div v-else class="answer" aria-live="polite">
        <p v-if="item.definitionSentence" class="definition-note">
          詞典解釋的是這句：{{ item.definitionSentence }}
        </p>
        <div v-html="renderMarkdown(stripQuiz(item.definition))" />

        <a v-if="item.context?.url" :href="item.context.url" target="_blank" rel="noreferrer">
          {{ item.context.title || '查看來源' }}
        </a>
        <p class="self-check">
          {{ item.isPattern
            ? '剛才有造出自然的句子嗎？'
            : item.isPhrase ? '剛才有說出正確意思和用法嗎？' : '剛才有想起來嗎？' }}
        </p>
        <div class="grade-actions">
          <button :disabled="busy" @click="grade(false)">
            忘了
          </button>
          <button class="caught" :disabled="busy" @click="grade(true)">
            記得
          </button>
          <button v-if="item.canMaster" class="mastered" :disabled="busy" @click="master">
            已經馴服
          </button>
        </div>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
    </article>
  </section>
</template>

<style scoped>
.review-shell { overflow: hidden; padding: 0; }
.review-head { padding: 1.3rem 1.5rem; border-bottom: 1px solid var(--wt-line); background: var(--wt-surface); }
.review-head h2, .review-head p { margin: 0; }
.review-head h2 { font-size: 18px; line-height: 1.3; letter-spacing: -.03em; }
.review-head p:last-child { margin-top: .45rem; color: var(--wt-muted); font-size: 12px; }
.eyebrow { margin-bottom: .35rem !important; color: var(--wt-accent) !important; font-size: 11px; font-weight: 800; letter-spacing: .13em; }
.progress-wrap { display: flex; flex-wrap: wrap; align-items: center; gap: .8rem; padding: .8rem 1.5rem; color: var(--wt-muted); background: var(--wt-raised); font-size: 13px; font-weight: 700; }
.paws { display: flex; flex: 1; gap: .45rem; }
.paws span { color: var(--wt-line); transition: color 140ms ease, transform 140ms ease; }
.paws span.done { color: var(--wt-accent); transform: scale(1.2); }
.review-card { margin: 0; padding: 1.5rem; background: var(--wt-surface); animation: arrive 160ms ease-out; }
.card-meta { display: flex; justify-content: space-between; color: var(--wt-muted); font-size: 12px; }
.card-meta span:first-child { padding: .15rem .55rem; border-radius: 999px; color: var(--wt-accent); background: var(--wt-wash); font-weight: 800; }
.question { margin: 1.25rem 0 .5rem; color: var(--wt-body); font-weight: 700; }
.word { overflow-wrap: anywhere; margin: .35rem 0 1rem; color: var(--wt-ink); font-size: 30px; line-height: 1.15; letter-spacing: -.025em; }
blockquote { margin: .8rem 0 1.2rem; padding: .85rem 1rem; border-left: 3px solid var(--wt-accent); border-radius: 0 10px 10px 0; color: var(--wt-body); background: var(--wt-raised); }
button { transition: transform 100ms ease, background 140ms ease; }
button:active { transform: scale(.98); }
.listen { margin-bottom: .8rem; }
.voice-note { display: block; margin: 0 0 1rem; color: var(--wt-muted); font-size: 12px; }
.reveal { width: 100%; padding: .7rem; color: var(--wt-on-accent); border-color: var(--wt-accent); background: var(--wt-accent); font-weight: 800; }
.answer { animation: wt-arrive 240ms ease-out; margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--wt-line); }
.answer :deep(.h) { margin-top: .8rem; color: var(--wt-accent); font-weight: 800; }
.answer :deep(p), .answer :deep(ul) { margin: .35rem 0; }
.answer a { display: inline-block; margin-top: .7rem; color: var(--wt-accent); }
.definition-note { margin: 0 0 .6rem; padding: .6rem .8rem; border-left: 3px solid var(--wt-muted); border-radius: 0 8px 8px 0; color: var(--wt-body); background: var(--wt-raised); font-size: 13px; }
.self-check { margin: 1.2rem 0 .55rem; color: var(--wt-body); font-weight: 700; }
.grade-actions { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: .7rem; }
.grade-actions button { min-height: 44px; }
.grade-actions .caught { color: var(--wt-on-accent); border-color: var(--wt-accent); background: var(--wt-accent); font-weight: 800; }
.grade-actions .mastered { color: var(--wt-success); border-color: var(--wt-success); background: var(--wt-success-bg); font-weight: 800; }
.empty, .finish { position: relative; padding: 3rem 1.5rem; text-align: center; }
.empty h3, .finish h3 { margin: 0; color: var(--wt-ink); font-size: 22px; letter-spacing: -.02em; }
.empty p, .finish p { margin: .5rem 0 0; color: var(--wt-muted); }
.finish img { width: 88px; height: 88px; margin-bottom: 1rem; border-radius: 20px; animation: caught 560ms ease-out; }
.finish .note { color: var(--wt-muted); font-size: 13px; }
.next-round { min-height: 44px; margin-top: 1.3rem; padding-inline: 1.1rem; color: var(--wt-on-accent); border-color: var(--wt-accent); background: var(--wt-accent); font-weight: 800; }
.error { color: var(--wt-danger); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }
.celebration { position: absolute; top: 90px; left: 50%; pointer-events: none; }
.confetti { position: absolute; width: 7px; height: 10px; border-radius: 2px; animation: wt-confetti 850ms ease-out both; }
@keyframes arrive { from { opacity: 0; transform: translateY(5px); } }
@keyframes caught { 45% { transform: translateY(-8px) rotate(-5deg) scale(1.08); } }
@media (prefers-reduced-motion: reduce) { .review-card, .finish img { animation: none; } button, .paws span { transition: none; } }
@media (prefers-contrast: more) { .review-card { border: 2px solid var(--wt-body); } }
@media (max-width: 540px) { .review-head { padding: 1.1rem; } .review-card { margin: 0; padding: 1.1rem; } .grade-actions { grid-template-columns: 1fr; } }
</style>
