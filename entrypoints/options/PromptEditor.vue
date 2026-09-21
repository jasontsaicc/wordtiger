<script setup lang="ts">
import { DEFAULT_TEMPLATES, type Templates } from '@/src/lib/prompt';

const props = defineProps<{ modelValue: Templates }>();
const emit = defineEmits<{ 'update:modelValue': [Templates] }>();

const FIELDS: Array<{ key: keyof Templates; label: string; vars: string }> = [
  { key: 'lookup', label: '查詞(按 A)', vars: '{{profile}}、{{surface}}、{{word}}、{{sentence}}' },
  { key: 'translate', label: '快速看懂(按 S)', vars: '{{profile}}、{{title}}、{{previous}}、{{focus}}、{{sentence}}' },
  { key: 'grammar', label: '拆懂這句(按 D)', vars: '{{profile}}、{{title}}、{{previous}}、{{focus}}、{{sentence}}' },
];

function update(key: keyof Templates, value: string) {
  emit('update:modelValue', { ...props.modelValue, [key]: value });
}

function reset(key: keyof Templates) {
  update(key, DEFAULT_TEMPLATES[key]);
}
</script>

<template>
  <details>
    <summary>
      <span><b>回答方式</b><small>進階設定，一般使用不需要修改</small></span>
    </summary>

    <div class="content">
      <p class="note">
        輸出格式由系統保護；這裡只調整要求本身。placeholder 打錯字會原樣保留。
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
    </div>
  </details>
</template>

<style scoped>
details { margin-bottom: 1rem; border: 1px solid var(--wt-line); border-radius: 14px; background: var(--wt-surface); box-shadow: 0 1px 2px transparent; }
summary { padding: 1rem 1.25rem; cursor: pointer; }
summary span { display: inline-flex; flex-direction: column; margin-left: .35rem; }
summary small { color: var(--wt-muted); font-size: 12px; font-weight: 400; }
.content { padding: 0 1.25rem 1.25rem; }
.field { margin-bottom: 1.25rem; }
label { display: block; margin-bottom: .25rem; }
textarea { width: 100%; padding: .4rem; font: 13px/1.5 ui-monospace, monospace; }
.note { opacity: .6; font-size: 13px; }
</style>
