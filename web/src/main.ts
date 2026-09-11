// main.ts：创建 Vue 应用并安装 Pinia，挂载到 index.html 的 #app。
// 不注册路由；SSE 与画布逻辑分别由 runtime store 与 CanvasStage 建立。

import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';

createApp(App).use(createPinia()).mount('#app');
