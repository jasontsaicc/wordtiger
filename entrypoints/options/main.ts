import { createApp } from 'vue';
import App from './App.vue';

const app = createApp(App);
// Vue 的 render 錯誤預設只在 dev build 印出來。production build 什麼都不說,
// 畫面直接空掉。這一行讓它在正式版也留下痕跡。
app.config.errorHandler = (err, _instance, info) => {
  console.error('[pv] vue error', info, err);
};
app.mount('#app');
