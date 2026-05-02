import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
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
