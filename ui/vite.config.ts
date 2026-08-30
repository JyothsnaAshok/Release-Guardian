import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies the TrueForge API so the app is same-origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5273,
    proxy: {
      '/api': { target: process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8790', changeOrigin: true },
    },
  },
});
