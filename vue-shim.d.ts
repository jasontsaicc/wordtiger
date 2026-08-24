// tsc 不認得 .vue。這個 shim 讓 import 通過型別檢查。
// ponytail: 只擋住 import 錯誤,不檢查 template 內容。要檢查 template 就換成 vue-tsc。
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}
