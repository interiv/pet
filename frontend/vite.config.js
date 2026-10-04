import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 本地开发时后端地址：默认 3000（与 backend/.env 的 PORT 一致）
// 若后端换了端口，用环境变量覆盖：$env:VITE_API_PROXY='http://127.0.0.1:3001'; npm run dev
const API_PROXY_TARGET = process.env.VITE_API_PROXY || 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: API_PROXY_TARGET,
        changeOrigin: true
      },
      // 聊天室 WebSocket：开发时同样走代理，无需依赖写死的端口
      '/socket.io': {
        target: API_PROXY_TARGET,
        changeOrigin: true,
        ws: true
      }
    }
  },
  test: {
    // 前端冒烟测试（jest-dom 断言 + jsdom 环境）
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    css: false,
  },
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Vite 的动态导入预加载辅助函数（__vite__mapDeps）是一个极小的公共模块，
          // 但它必须和「所有页面都要用的小工具」放在一起。
          // 之前它被内联进了 vendor-antv（@ant-design/charts）这个 1.4MB 的 chunk，
          // 结果登录页这种完全不需要图表的页面也被迫静态依赖它，
          // 白白多下 1.4MB。这里显式兜底到 vendor-utils。
          if (id.includes('vite/preload-helper') || id.includes('vite/modulepreload-polyfill')) {
            return 'vendor-utils';
          }
          if (id.includes('node_modules')) {
            if (id.includes('@ant-design/charts') || id.includes('@antv/')) return 'vendor-antv';
            if (id.includes('recharts')) return 'vendor-recharts';
            if (id.includes('antd') || id.includes('@ant-design/icons') || id.includes('@ant-design/cssinjs')) return 'vendor-antd';
            if (id.includes('react-dom') || id.includes('scheduler')) return 'vendor-react-dom';
            if (id.includes('react-router')) return 'vendor-react-router';
            if (id.includes('/react/')) return 'vendor-react';
            if (id.includes('socket.io')) return 'vendor-socket';
            if (id.includes('axios') || id.includes('dayjs') || id.includes('zustand')) return 'vendor-utils';
          }
        }
      }
    }
  }
})
