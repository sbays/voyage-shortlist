import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Many test files start their own PGlite database and migrate it. On a
    // busy build machine running every file in parallel, that setup has taken
    // over the 10 s default and failed a deploy, so setup gets a minute.
    hookTimeout: 60_000,
  },
});
