<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { SyncState } from '@/src/lib/sync';

const state = ref<SyncState | null>(null);
const url = ref('');
const anonKey = ref('');
const email = ref('');
const password = ref('');
const busy = ref(false);
const message = ref('');

onMounted(refresh);

async function refresh() {
  state.value = await browser.runtime.sendMessage({ type: 'getSyncState' });
  url.value ||= state.value?.url || '';
  anonKey.value ||= state.value?.anonKey || '';
  email.value ||= state.value?.email || '';
}

async function login() {
  message.value = '';
  try {
    new URL(url.value);
  } catch {
    message.value = 'Supabase URL 格式不正確。';
    return;
  }
  busy.value = true;
  const result = await browser.runtime.sendMessage({
    type: 'syncLogin', url: url.value, anonKey: anonKey.value,
    email: email.value, password: password.value,
  });
  password.value = '';
  busy.value = false;
  if (!result?.ok) {
    message.value = result?.error ?? '背景程式沒有回應';
    return;
  }
  state.value = result.state;
  message.value = '登入成功，可以開始同步。';
}

async function sync() {
  busy.value = true;
  message.value = '同步中…';
  const result = await browser.runtime.sendMessage({ type: 'syncNow' });
  busy.value = false;
  if (!result?.ok) {
    message.value = result?.error ?? '背景程式沒有回應';
    await refresh();
    return;
  }
  state.value = result.state;
  message.value = `完成：拉回 ${result.result.pulled} 筆，推送 ${result.result.pushed} 筆。`;
}

async function logout() {
  busy.value = true;
  const result = await browser.runtime.sendMessage({ type: 'syncLogout' });
  busy.value = false;
  state.value = result?.state ?? null;
  message.value = '已登出；本機資料不受影響。';
}
</script>

<template>
  <section class="sync-card">
    <div class="heading">
      <div>
        <h2>裝置同步</h2>
        <p>讓生詞、片語、AI 詞典和複習進度跟著你走。</p>
      </div>
      <span class="dot" :class="state?.loggedIn ? 'online' : 'offline'">
        {{ state?.loggedIn ? '已登入' : '未登入' }}
      </span>
    </div>

    <template v-if="!state?.loggedIn">
      <div class="grid">
        <label>Project URL
          <input v-model.trim="url" type="url" placeholder="https://project.supabase.co" />
        </label>
        <label>Anon key
          <input v-model.trim="anonKey" type="password" autocomplete="off" />
        </label>
        <label>Email
          <input v-model.trim="email" type="email" autocomplete="username" />
        </label>
        <label>密碼
          <input v-model="password" type="password" autocomplete="current-password" @keyup.enter="login" />
        </label>
      </div>
      <button class="primary" :disabled="busy" @click="login">登入</button>
      <p class="note">先在 Supabase SQL Editor 執行專案的 <code>supabase/schema.sql</code>。</p>
    </template>

    <template v-else>
      <p class="account"><b>{{ state.email }}</b><span>{{ state.url }}</span></p>
      <div class="actions">
        <button class="primary" :disabled="busy" @click="sync">立即同步</button>
        <button :disabled="busy" @click="logout">登出</button>
      </div>
      <p class="note">
        上次成功：{{ state.lastSuccessAt ? new Date(state.lastSuccessAt).toLocaleString() : '尚未同步' }}
      </p>
      <p v-if="state.lastError" class="error">最近錯誤：{{ state.lastError }}</p>
    </template>
    <p v-if="message" class="message">{{ message }}</p>
  </section>
</template>

<style scoped>
.sync-card { border-color: var(--wt-accent); background: linear-gradient(135deg, var(--wt-wash), var(--wt-surface) 55%); }
.heading, .actions, .account { display: flex; align-items: center; }
.heading { justify-content: space-between; gap: 1rem; margin-bottom: 1rem; }
h2, .heading p { margin: 0; }
.heading p { color: var(--wt-muted); font-size: 13px; }
.dot { padding: .2rem .65rem; border-radius: 999px; font-size: 12px; font-weight: 700; }
.online { color: var(--wt-success); background: var(--wt-success-bg); }
.offline { color: var(--wt-muted); background: var(--wt-line); }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: .8rem; }
.grid label { margin: 0; }
.grid input { box-sizing: border-box; width: 100%; margin-top: .25rem; padding: .58rem .7rem; border: 1px solid var(--wt-line); border-radius: 8px; color: var(--wt-ink); background: var(--wt-surface); font: inherit; }
.grid input:focus, button:focus-visible { outline: 3px solid var(--wt-accent); outline-offset: 1px; border-color: var(--wt-accent); }
.actions { gap: .6rem; }
.account { align-items: flex-start; flex-direction: column; margin: 0 0 1rem; }
.account span { color: var(--wt-muted); font-size: 13px; }
button { padding: .52rem .8rem; border: 1px solid var(--wt-line); border-radius: 8px; color: var(--wt-body); background: var(--wt-surface); cursor: pointer; }
button:disabled { opacity: .55; cursor: wait; }
.primary { color: var(--wt-on-accent); border-color: var(--wt-accent); background: var(--wt-accent); }
.note, .message, .error { margin: .75rem 0 0; font-size: 13px; }
.note { color: var(--wt-muted); }
.message { color: var(--wt-accent); }
.error { color: var(--wt-danger); }
@media (max-width: 640px) { .grid { grid-template-columns: 1fr; } }
</style>
