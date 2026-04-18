import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

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
  test: {
    include: ["tests/**/*.{test,spec}.{ts,js}"],
    exclude: ["node_modules", "dist"],
    environment: "node",
    globals: true,
  },
});
