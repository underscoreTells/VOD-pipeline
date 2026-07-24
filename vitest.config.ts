import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const legacySvelteMarkdownPattern = /node_modules\/svelte-markdown\/.+\.svelte$/;
const legacyLucidePattern = /node_modules\/lucide-svelte\/.+\.svelte$/;

export default defineConfig({
  plugins: [
    svelte({
      dynamicCompileOptions: ({ filename }) => {
        if (legacySvelteMarkdownPattern.test(filename) || legacyLucidePattern.test(filename)) {
          return { runes: false };
        }

        return undefined;
      },
    }),
  ],
  resolve: {
    alias: {
      "$shared": resolve(__dirname, "src/shared"),
    },
  },
  test: {
    include: ["tests/**/*.{test,spec}.{ts,js}"],
    exclude: ["node_modules", "dist"],
    environment: "node",
    globals: true,
  },
});
