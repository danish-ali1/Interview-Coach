import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the API is proxied, so the browser sees ONE origin. That is also how production
// runs (nginx proxies /api), which matters because the refresh cookie is SameSite=Strict.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.VITE_API_TARGET ?? 'http://localhost:5000', changeOrigin: false } },
  },
});
