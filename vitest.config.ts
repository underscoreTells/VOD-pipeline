import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.{test,spec}.{ts,js}"],
    exclude: ["node_modules", "dist"],
    environment: "node",
    globals: true,
  },
});
