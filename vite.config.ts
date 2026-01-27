import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';

const __dirname = new URL('.', import.meta.url).pathname;

export default defineConfig({
  plugins: [svelte()],
  root: 'src/renderer',
  base: './',
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer'),
      '$shared': resolve(__dirname, 'src/shared'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  clearScreen: false,
});
