// vite.config.ts：配置 Vue 插件、开发端口与 /api 后端代理。
// 前端统一请求相对路径 /api，由 Vite 转发到本地 3001 端口。

import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  }
});
