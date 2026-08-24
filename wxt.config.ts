import { defineConfig } from 'wxt';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  manifest: {
    name: '個人詞庫',
    description: '英文閱讀生詞高亮與 AI 查詞',
    permissions: ['activeTab', 'scripting', 'storage'],
    // 不給 default_popup。有 popup 的話點擊會開 popup,action.onClicked 就不會觸發。
    action: {},
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
  vite: () => ({ plugins: [vue()] }),
});
