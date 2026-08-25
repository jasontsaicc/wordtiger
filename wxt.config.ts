import { defineConfig } from 'wxt';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  manifest: {
    name: '個人詞庫',
    description: '英文閱讀生詞高亮與 AI 查詞',
    permissions: ['activeTab', 'scripting', 'storage', 'alarms'],
    host_permissions: [],
    optional_host_permissions: ['<all_urls>'],
    web_accessible_resources: [
      { resources: ['freq.json'], matches: ['<all_urls>'] },
    ],
    commands: {
      highlight: {
        suggested_key: { default: 'Alt+U' },
        description: '開啟或關閉生詞高亮',
      },
    },
  },
  // Edge 擴充功能頁會把 modulepreload 判成 cross-world mismatch；正式 import 不受影響。
  vite: () => ({ plugins: [vue()], build: { modulePreload: false } }),
});
