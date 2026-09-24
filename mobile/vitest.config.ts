import { defineConfig } from "vitest/config";
import { resolve } from "path";

// The order maths and the database layer are both tested here. Anything
// that imports react-native needs a device, so the screens are not - but
// the numbers on a bill are, and those are what have to be right.
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"] },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      // The database layer is tested against Node's own SQLite through a
      // shim, so the schema and every query run for real in CI.
      "expo-sqlite": resolve(__dirname, "tests/expoSqliteShim.ts"),
    },
  },
  // Vite searches parent directories for a PostCSS config and finds the web
  // app's, whose Tailwind plugin is not installed here. An inline empty
  // config stops the search; none of these tests touch CSS anyway.
  css: { postcss: { plugins: [] } },
});
