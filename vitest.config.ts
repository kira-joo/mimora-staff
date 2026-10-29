import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Phase 3 scope only: engines are pure functions, no React, no jsdom, no
 * Mongoose model registration. `node` environment and no setup files needed
 * for that — a heavier config (jsdom, DB bootstrap) is a later phase's
 * concern, added when there is something here that needs it.
 */
export default defineConfig({
  resolve: {
    // Vite doesn't read tsconfig's `paths` — mirrors `"src/*": ["./src/*"]`
    // from tsconfig.json, the bare-import convention Phase 4's route files
    // use (matching restaurant-platform-staff's own tsconfig).
    alias: { src: path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "node",
    globals: true,
    /*
     * The store's time zone is required configuration with no default
     * (`core/config/store-timezone.ts`), and the quote and order placement now
     * read it for the cutoff and the promised dates. A test that wants another
     * zone — or none — sets or deletes `process.env.STORE_TIMEZONE` itself.
     */
    env: { STORE_TIMEZONE: "Africa/Cairo" },
    include: ["src/**/*.test.{ts,tsx}"],
    /*
     * The `*.integration.test.ts` files connect to one real, shared MongoDB
     * replica set (`docker compose up -d`) rather than a private in-memory
     * instance per file — this repo's own CLAUDE.md verification philosophy
     * ("run real servers against a real database") over the restaurant
     * precedent's `MongoMemoryReplSet`. That means two files running in
     * parallel would `deleteMany({})` the same collections out from under
     * each other. Sequential file execution is the fix: a real shared
     * resource is not itself parallel-safe, whatever the test runner is.
     */
    fileParallelism: false,
    server: {
      deps: {
        /*
         * `@kira-joo/backend-toolkit-next` imports `next/server`, which Next
         * exposes only through its package exports map. Node's raw ESM
         * resolution does not consult that map for a bare subpath and fails
         * with "Did you mean next/server.js". Inlining the package routes
         * its imports through Vite's resolver, which does.
         *
         * Test-harness-only: the Next build resolves this correctly on its
         * own. Same fix `restaurant-platform-staff`'s vitest.config.ts uses.
         */
        inline: [/@kira-joo\/backend-toolkit-next/],
      },
    },
  },
});
