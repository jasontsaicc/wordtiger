import { createApp } from 'vue';
import App from './App.vue';

const app = createApp(App);
// 保留 production render error，避免無診斷資訊的空白頁。
app.config.errorHandler = (err, _instance, info) => {
  console.error('[wordtiger] vue error', info, err);
};
app.mount('#app');
