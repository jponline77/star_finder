/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Where the Express API lives in development: VITE_API_TARGET if set, else the same PORT the
// server uses (`PORT=4000 npm run dev` passes PORT to both processes), else 3001.
const apiTarget = process.env.VITE_API_TARGET || `http://localhost:${process.env.PORT || 3001}`;

const proxied = { target: apiTarget, changeOrigin: false };

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.VITE_PORT) || 5173,
    proxy: {
      '/api': proxied,
      '/media': proxied,
      '/uploads': proxied,
    },
  },
  preview: {
    port: Number(process.env.VITE_PREVIEW_PORT) || 4173,
    proxy: {
      '/api': proxied,
      '/media': proxied,
      '/uploads': proxied,
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 800,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    restoreMocks: true,
    // Page-level tests drive whole forms through jsdom; on a busy machine they can take several
    // seconds, so allow more than vitest's 5 s default before calling them hung.
    testTimeout: 20_000,
  },
});
