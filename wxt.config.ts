import { defineConfig } from 'wxt';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  manifest: {
    name: '攔詞虎',
    short_name: '攔詞虎',
    description: '把英文裡的攔路虎，一隻隻抓起來：標出生詞、AI 查詞與拆句',
    permissions: ['activeTab', 'scripting', 'storage', 'alarms'],
    host_permissions: [],
    optional_host_permissions: ['<all_urls>'],
    web_accessible_resources: [
      { resources: ['freq.json', 'icons/32.png'], matches: ['<all_urls>'] },
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
