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
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
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
