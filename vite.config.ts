import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/app.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  worker: {
    format: 'es',
    rollupOptions: { output: { entryFileNames: 'assets/[name].js' } },
  },
  server: { host: true, port: 5173 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as any);
