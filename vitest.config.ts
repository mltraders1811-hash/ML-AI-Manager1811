import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    // Tests touch a shared Postgres database, so run files serially rather
    // than letting parallel workers clobber each other's rows.
    fileParallelism: false,
    testTimeout: 30_000,
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
});
