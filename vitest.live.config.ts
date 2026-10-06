import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    alias: { "@": path.resolve(__dirname, "src") },
    include: ["tests/live/**/*.test.ts"],
    testTimeout: 240_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
