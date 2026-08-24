<script setup lang="ts">
import { DEFAULT_TEMPLATES, type Templates } from '@/src/lib/prompt';

const props = defineProps<{ modelValue: Templates }>();
const emit = defineEmits<{ 'update:modelValue': [Templates] }>();

const FIELDS: Array<{ key: keyof Templates; label: string; vars: string }> = [
  { key: 'lookup', label: '查詞(按 A)', vars: '{{profile}}、{{word}}、{{sentence}}' },
  { key: 'translate', label: '整句翻譯(按 S)', vars: '{{profile}}、{{sentence}}' },
  { key: 'grammar', label: '文法分析(按 D)', vars: '{{profile}}、{{sentence}}' },
];

function update(key: keyof Templates, value: string) {
  emit('update:modelValue', { ...props.modelValue, [key]: value });
}

function reset(key: keyof Templates) {
  update(key, DEFAULT_TEMPLATES[key]);
}
</script>

<template>
  <section>
    <h2>Prompt 編輯</h2>
    <p class="note">
      輸出格式那層是鎖定的,改不到。這裡改的是要求本身。
      placeholder 打錯字會原樣留在 prompt 裡,發現 AI 答非所問先檢查這個。
    </p>

    <div v-for="f in FIELDS" :key="f.key" class="field">
      <label>
        {{ f.label }}
        <span class="note">可用變數:{{ f.vars }}</span>
      </label>
      <textarea
        rows="7"
        :value="modelValue[f.key]"
        @change="(e: any) => update(f.key, e.target.value)"
      />
      <button
        v-if="modelValue[f.key] !== DEFAULT_TEMPLATES[f.key]"
        @click="reset(f.key)"
      >
        還原成預設
      </button>
    </div>
  </section>
</template>

<style scoped>
.field { margin-bottom: 1.25rem; }
label { display: block; margin-bottom: .25rem; }
textarea { width: 100%; padding: .4rem; font: 13px/1.5 ui-monospace, monospace; }
.note { opacity: .6; font-size: 13px; }
</style>
