import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8700',
    },
  },
  build: {
    chunkSizeWarningLimit: 8192,
    outDir: 'dist',
  },
});
