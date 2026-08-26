// 讓 TypeScript 接受 .vue import。
// ponytail: 不檢查 template；需要 template 型別檢查時改用 vue-tsc。
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}
