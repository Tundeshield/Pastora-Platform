import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// PORT and BASE_PATH are optional so the app builds the same way locally,
// on Netlify and on Replit. Replit injects both; elsewhere the defaults apply.
const port = Number(process.env.PORT ?? 5173);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${process.env.PORT}"`);
}
const basePath = process.env.BASE_PATH || '/';

// During local development the browser calls /api on the Vite server, which
// forwards to the API server (pnpm --filter @workspace/api-server dev).
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:8080';

export default defineConfig({
  base: basePath,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: { strict: true },
    proxy: { '/api': { target: apiTarget, changeOrigin: true } },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: { '/api': { target: apiTarget, changeOrigin: true } },
  },
});
