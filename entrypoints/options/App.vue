<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { loadSettings, saveSettings, originPattern, type Settings } from '@/src/lib/settings';

const settings = ref<Settings | null>(null);
const words = ref<Array<{ word: string; status: string; contextCount: number }>>([]);
const contexts = ref<Array<{ sentence: string; url: string; title: string }>>([]);
const selected = ref<string | null>(null);
const granted = ref(false);

onMounted(async () => {
  settings.value = await loadSettings();
  words.value = await browser.runtime.sendMessage({ type: 'listWords' });
  await refreshGrant();
});

async function persist() {
  if (settings.value) await saveSettings(settings.value);
  await refreshGrant();
}

async function refreshGrant() {
  const origin = originPattern(settings.value?.baseUrl ?? '');
  granted.value = origin
    ? await browser.permissions.contains({ origins: [origin] })
    : false;
}

/**
 * 授權必須由使用者手勢直接觸發,所以 request 要是這個 handler 的第一件事。
 * 中間先 await 別的東西,Chrome 會判定手勢已經過期而拒絕。
 */
async function grantHost() {
  const origin = originPattern(settings.value?.baseUrl ?? '');
  if (!origin) return;
  granted.value = await browser.permissions.request({ origins: [origin] });
}

async function openWord(word: string) {
  selected.value = word;
  contexts.value = await browser.runtime.sendMessage({ type: 'getContexts', word });
}
</script>

<template>
  <main v-if="settings" class="wrap">
    <h1>個人詞庫</h1>

    <section>
      <h2>AI 設定</h2>
      <label>Base URL
        <input v-model="settings.baseUrl" placeholder="https://api.openai.com/v1" @change="persist" />
      </label>
      <label>API Key
        <input v-model="settings.apiKey" type="password" @change="persist" />
      </label>
      <label>Model
        <input v-model="settings.model" placeholder="gpt-4o-mini" @change="persist" />
      </label>
      <p class="note">任何 OpenAI 相容端點都可以,包含本機的 Ollama。</p>

      <p v-if="!originPattern(settings.baseUrl)" class="warn">
        先填一個完整網址,例如 https://api.openai.com/v1。
      </p>
      <p v-else-if="granted" class="ok">
        已授權連線到 {{ originPattern(settings.baseUrl) }}
      </p>
      <p v-else class="warn">
        還沒授權連線到 {{ originPattern(settings.baseUrl) }},查詞會失敗。
        <button @click="grantHost">授權這個網域</button>
      </p>
    </section>

    <section>
      <h2>你的背景</h2>
      <textarea v-model="settings.profile" rows="4" @change="persist"
        placeholder="我是 DevOps 工程師,熟 Python / Shell / AWS。解釋單字時,如果這個字在軟體工程或維運領域有特定用法,優先給那個意思。" />
      <p class="note">這段會被放進查詞、翻譯、文法分析的 prompt。</p>
    </section>

    <section>
      <h2>高亮門檻</h2>
      <input type="range" min="1000" max="30000" step="500"
        v-model.number="settings.threshold" @change="persist" />
      <p>高亮詞頻排名 <b>{{ settings.threshold }}</b> 名以外的字。往右拉,亮的字變少。</p>
    </section>

    <section>
      <h2>不啟用的網域</h2>
      <textarea rows="3" :value="settings.blockedHosts.join('\n')"
        @change="(e: any) => { settings!.blockedHosts = e.target.value.split('\n').map((s: string) => s.trim()).filter(Boolean); persist(); }" />
      <p class="note">一行一個。公司內網放這裡,網頁內容就不會被送到 AI。</p>
    </section>

    <section>
      <h2>我的生詞 ({{ words.length }})</h2>
      <table>
        <tr v-for="w in words" :key="w.word" @click="openWord(w.word)">
          <td>{{ w.word }}</td>
          <td>{{ w.contextCount }} 條語境</td>
        </tr>
      </table>

      <div v-if="selected">
        <h3>{{ selected }} 的語境</h3>
        <blockquote v-for="(c, i) in contexts" :key="i">
          {{ c.sentence }}
          <a :href="c.url" target="_blank">{{ c.title }}</a>
        </blockquote>
      </div>
    </section>
  </main>
</template>

<style scoped>
.wrap { max-width: 720px; margin: 2rem auto; font: 15px/1.7 system-ui, sans-serif; }
section { margin-bottom: 2.5rem; }
label { display: block; margin-bottom: .75rem; }
input[type="text"], input[type="password"], input:not([type]), textarea { width: 100%; padding: .4rem; }
input[type="range"] { width: 100%; }
.note { opacity: .6; font-size: 13px; }
.warn { color: #b4451f; font-size: 13px; }
.ok { color: #2b7a3d; font-size: 13px; }
table { width: 100%; border-collapse: collapse; }
td { padding: .4rem; border-bottom: 1px solid #ddd; cursor: pointer; }
blockquote { border-left: 3px solid #c8c0ff; margin: .5rem 0; padding-left: .75rem; }
</style>
