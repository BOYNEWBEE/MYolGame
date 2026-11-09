import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// 本地开发：前端与后端同源，/functions 代理到本地 API 服务（与 Qoder Sites 部署路径一致）
export default defineConfig({
  plugins: [react()],
  define: { __MYOL_HASH_ROUTER__: JSON.stringify(process.env.MYOLGAME_CLOUD_ROUTING === 'hash') },
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../functions/shared', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/functions': 'http://127.0.0.1:8787',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
