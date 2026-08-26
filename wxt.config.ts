import { defineConfig } from 'wxt';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  manifest: {
    name: '攔詞虎',
    short_name: '攔詞虎',
    description: '把英文裡的攔路虎，一隻隻抓起來：標出生詞、AI 查詞與拆句',
    // 公開金鑰固定開發版 ID；更換它會讓瀏覽器視為全新的擴充功能並失去本機設定。
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA+HK3BQItb0KJmab+YriyoDXFJImV95en+XhqC0AnXx4G0/i9eu82oApxnFK0zjHOWA7n/kGkXN77Bsem3zwWirIfoSvoyN6cf9xeNWVDkwDroTSEhNxVAAqThpLGJXQopAMADBqyuENUPuZxvWOAhe7bjCsmyz3Eajz3GcPWVSJD0U6tWiiXHsDJ/zE0khg8vj6ryUbYexSY6HANDMgIUlMOZsOmA1SBur2Z3e6Po6JElzp/3qKLQHDVpfqov4yCYvWAE1Ok9u1tI2lJFmPT18Qosfbfe408aN99XYlXljuwWa0SK9jfQL405cNMi2DIPXDZJDGkXb0n3kuCzPU21wIDAQAB',
    permissions: ['scripting', 'storage', 'alarms'],
    host_permissions: ['<all_urls>'],
    web_accessible_resources: [
      { resources: ['freq.json', 'icons/32.png', 'icons/128.png'], matches: ['<all_urls>'] },
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
