import { defineConfig } from 'wxt';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  manifest: {
    name: '個人詞庫',
    permissions: ['activeTab', 'scripting', 'storage'],
    host_permissions: [],
    optional_host_permissions: ['<all_urls>'],
    commands: {
      highlight: {
        suggested_key: { default: 'Alt+U' },
        description: '開啟或關閉生詞高亮',
      },
    },
  },
  vite: () => ({ plugins: [vue()] }),
});
