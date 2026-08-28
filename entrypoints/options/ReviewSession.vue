<script setup lang="ts">
import { ref } from 'vue';
import { renderMarkdown } from '@/src/content/markdown';
import { speak } from '@/src/content/speak';
import type { ReviewItem } from '@/src/lib/db';

const props = defineProps<{
  item: ReviewItem | null;
  done: number;
  total: number;
  caught: number;
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
  const saved = await browser.runtime.sendMessage({
    type: 'reviewWord', word: props.item.word, remembered,
  });
  busy.value = false;
  if (!saved) {
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
        <p>把今天遇到的攔路虎，一隻隻抓回來。</p>
      </div>
      <img src="/icons/128.png" alt="" />
    </header>

    <div v-if="total" class="progress-wrap">
      <div class="paws" aria-hidden="true">
        <span v-for="n in total" :key="n" :class="{ done: n <= done }">●</span>
      </div>
      <span>{{ done }}／{{ total }}</span>
      <progress class="sr-only" :value="done" :max="total">{{ done }}／{{ total }}</progress>
    </div>

    <div v-if="total === 0" class="empty" aria-live="polite">
      <h3>今晚無虎可打</h3>
      <p>目前沒有到期題目，安心去讀英文吧。</p>
    </div>

    <div v-else-if="!item" class="finish" aria-live="polite">
      <img src="/icons/128.png" alt="" />
      <h3>{{ caught === total ? '本輪全數抓到。' : '本輪收工。' }}</h3>
      <p>本輪戰績：抓到 {{ caught }}／{{ total }} 隻；溜走的明天再來。</p>
      <button class="next-round" @click="emit('nextRound')">再打 5 隻</button>
    </div>

    <article v-else class="review-card">
      <div class="card-meta">
        <span>{{ item.isPattern ? '句型' : item.isPhrase ? '片語' : '單字' }}</span>
        <span>第 {{ done + 1 }}／{{ total }} 隻</span>
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
          {{ item.context ? '這隻在這裡是什麼意思？' : '你記得這個字的核心意思嗎？' }}
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
        {{ item.isPhrase ? '看老師回饋' : '讓牠現形' }}
      </button>

      <div v-else class="answer" aria-live="polite">
        <p v-if="item.isPhrase" class="answer-label">老師回饋</p>
        <div v-html="renderMarkdown(item.definition)" />

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
            {{ item.isPattern ? '還造不出來' : item.isPhrase ? '意思還沒抓到' : '又讓牠溜了' }}
          </button>
          <button class="caught" :disabled="busy" @click="grade(true)">
            {{ item.isPattern ? '能自然造句' : item.isPhrase ? '意思和用法都對' : '抓到了' }}
          </button>
          <button v-if="item.reviewStep === 5" class="mastered" :disabled="busy" @click="master">
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
.review-head { display: flex; align-items: center; justify-content: space-between; gap: 1.5rem; padding: 1.4rem 1.5rem; color: white; background: linear-gradient(120deg, #0f172a, #164e63); }
.review-head h2, .review-head p { margin: 0; }
.review-head h2 { font-size: 28px; line-height: 1.1; letter-spacing: -.03em; }
.review-head p:last-child { margin-top: .45rem; color: #cffafe; }
.review-head img { width: 76px; height: 76px; border-radius: 18px; filter: drop-shadow(0 10px 18px #02061755); }
.eyebrow { margin-bottom: .35rem !important; color: #fbbf24 !important; font-size: 11px; font-weight: 800; letter-spacing: .13em; }
.progress-wrap { display: flex; align-items: center; gap: .8rem; padding: .8rem 1.5rem; color: #64748b; background: #f8fafc; font-size: 13px; font-weight: 700; }
.paws { display: flex; flex: 1; gap: .45rem; }
.paws span { color: #cbd5e1; transition: color 140ms ease, transform 140ms ease; }
.paws span.done { color: #f59e0b; transform: scale(1.2); }
.review-card { margin: 1.5rem; padding: 1.4rem; border: 1px solid #dbe4f0; border-radius: 16px; background: white; box-shadow: 0 14px 36px #0f172a12; animation: arrive 160ms ease-out; }
.card-meta { display: flex; justify-content: space-between; color: #64748b; font-size: 12px; }
.card-meta span:first-child { padding: .15rem .55rem; border-radius: 999px; color: #0e7490; background: #cffafe; font-weight: 800; }
.question { margin: 1.25rem 0 .5rem; color: #334155; font-weight: 700; }
.word { margin: .35rem 0 1rem; color: #0f172a; font-size: 30px; line-height: 1.15; letter-spacing: -.025em; }
blockquote { margin: .8rem 0 1.2rem; padding: .85rem 1rem; border-left: 3px solid #22d3ee; border-radius: 0 10px 10px 0; color: #334155; background: #f8fafc; }
button { transition: transform 100ms ease, background 140ms ease; }
button:active { transform: scale(.98); }
.listen { margin-bottom: .8rem; }
.voice-note { display: inline; margin-left: .6rem; color: #64748b; font-size: 12px; }
.reveal { width: 100%; padding: .7rem; color: white; border-color: #0e7490; background: #0e7490; font-weight: 800; }
.answer { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #e2e8f0; }
.answer :deep(.h) { margin-top: .8rem; color: #4f46e5; font-weight: 800; }
.answer :deep(p), .answer :deep(ul) { margin: .35rem 0; }
.answer a { display: inline-block; margin-top: .7rem; color: #0e7490; }
.answer-label { margin: 0; color: #64748b; font-size: 12px; font-weight: 800; text-transform: uppercase; }
.self-check { margin: 1.2rem 0 .55rem; color: #334155; font-weight: 700; }
.grade-actions { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: .7rem; }
.grade-actions button { min-height: 44px; }
.grade-actions .caught { color: white; border-color: #ea580c; background: #ea580c; font-weight: 800; }
.grade-actions .mastered { color: white; border-color: #15803d; background: #15803d; font-weight: 800; }
.empty, .finish { padding: 3rem 1.5rem; text-align: center; }
.empty h3, .finish h3 { margin: 0; color: #0f172a; font-size: 22px; letter-spacing: -.02em; }
.empty p, .finish p { margin: .5rem 0 0; color: #64748b; }
.finish img { width: 88px; height: 88px; margin-bottom: 1rem; border-radius: 20px; animation: caught 560ms ease-out; }
.next-round { margin-top: 1rem; color: white; border-color: #0e7490; background: #0e7490; font-weight: 800; }
.error { color: #b91c1c; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }
@keyframes arrive { from { opacity: 0; transform: translateY(5px); } }
@keyframes caught { 45% { transform: translateY(-8px) rotate(-5deg) scale(1.08); } }
@media (prefers-reduced-motion: reduce) { .review-card, .finish img { animation: none; } button, .paws span { transition: none; } }
@media (prefers-contrast: more) { .review-card { border: 2px solid #334155; } }
@media (max-width: 540px) { .review-head { padding: 1.1rem; } .review-head img { width: 58px; height: 58px; } .review-card { margin: 1rem; padding: 1.1rem; } .grade-actions { grid-template-columns: 1fr; } }
</style>
