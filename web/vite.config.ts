import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Static export for IPFS / plain file hosting: relative base, single page, no server rewrites.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: {
          viem: ['viem'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
