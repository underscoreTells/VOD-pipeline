import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';

const __dirname = new URL('.', import.meta.url).pathname;
const legacySvelteMarkdownPattern = /node_modules\/svelte-markdown\/.+\.svelte$/;

export default defineConfig({
  plugins: [
    svelte({
      dynamicCompileOptions: ({ filename }) => {
        if (legacySvelteMarkdownPattern.test(filename)) {
          return { runes: false };
        }

        return undefined;
      },
    }),
  ],
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
