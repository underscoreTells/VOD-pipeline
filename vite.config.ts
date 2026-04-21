import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

const __dirname = new URL('.', import.meta.url).pathname;
const legacySvelteMarkdownPattern = /node_modules\/svelte-markdown\/.+\.svelte$/;
const legacyLucidePattern = /node_modules\/lucide-svelte\/.+\.svelte$/;
const devServerPort = Number.parseInt(process.env.VITE_DEV_SERVER_PORT ?? '5173', 10);

export default defineConfig({
  plugins: [
    tailwindcss(),
    svelte({
      dynamicCompileOptions: ({ filename }) => {
        if (legacySvelteMarkdownPattern.test(filename) || legacyLucidePattern.test(filename)) {
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
    port: Number.isNaN(devServerPort) ? 5173 : devServerPort,
    strictPort: true,
  },
  clearScreen: false,
});
