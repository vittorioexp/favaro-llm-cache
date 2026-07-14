import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@favaro/memory": resolve(__dirname, "../memory/src/index.ts"),
      "@favaro/shared": resolve(__dirname, "../shared/src/index.ts"),
      "@favaro/core": resolve(__dirname, "../core/src/index.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
  },
});
