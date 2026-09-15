import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'client/src'),
      '@shared': path.resolve(__dirname, '../backend/shared')
    }
  },
  publicDir: path.resolve(__dirname, 'public'),
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true
      },
      '/socket.io': {
        target: 'http://127.0.0.1:5000',
        ws: true,
        changeOrigin: true
      }
    }
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // Explicit id-based matching (not the object-array shorthand) so a
        // shared dependency like react-dom always resolves to vendor-react
        // instead of silently getting pulled into whichever vendor chunk
        // happens to import it too (e.g. recharts pulling react-dom into
        // vendor-charts, which then mislabels every React error's stack
        // trace as coming from "charts").
        manualChunks(id) {
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'vendor-react';
          if (/node_modules\/@tanstack\/react-query\//.test(id)) return 'vendor-query';
          if (/node_modules\/lucide-react\//.test(id)) return 'vendor-icons';
          if (/node_modules\/recharts\//.test(id)) return 'vendor-charts';
          if (/node_modules\/(framer-motion|canvas-confetti)\//.test(id)) return 'vendor-utils';
        },
      },
    },
  },
});


