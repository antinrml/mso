import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": root,
      "@/features": path.join(root, "frontend", "slices"),
    },
  },
  test: {
    // `zz-*` is the agreed scratch prefix: agent/debug harnesses that must never
    // run in CI, never be committed, and never break a push. Also excluded from
    // tsconfig and gitignored — three places, because a leftover has broken this
    // repo three separate ways (a CI typecheck, a would-be commit, and a file that
    // minted a real session cookie to disk).
    exclude: ["**/node_modules/**", "**/.next/**", "**/zz-*"],
    include: [
      "app/**/*.test.{ts,tsx}",
      "frontend/slices/**/*.test.{ts,tsx}",
      "lib/**/*.test.{ts,tsx}",
      "bin/**/*.test.{ts,tsx}",
      "scripts/e2e/**/*.test.{ts,tsx}",
      "instrumentation.test.ts",
      // Root-level modules Next requires by name (middleware is `proxy.ts` in 16),
      // so their tests are colocated at the root and named one by one. NAMED, not
      // globbed — a root test file that is not listed here is silently never run,
      // which is worse than having no test at all, because the suite still says green.
      "proxy.test.ts",
      "proxy-websocket.test.ts",
    ],
    environment: "node",
    // `bun run coverage`, and it IS in `verify`, so these are gates.
    //
    // The numbers are the CURRENT floor minus a hair, not a target. They used to
    // read 50/40/50/50 with a comment calling them "real gates" while real coverage
    // was 19% and nothing ran them — an aspiration written as a fact, which is the
    // worse of the two failure modes: it reads as covered. Raise these when you add
    // tests; never lower them to make a push go through.
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["lib/**/*.{ts,tsx}", "frontend/slices/**/*.{ts,tsx}"],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/*.d.ts",
        "**/node_modules/**",
        "**/.next/**",
      ],
      thresholds: {
        statements: 19,
        branches: 18,
        functions: 14,
        lines: 19,
      },
    },
  },
});
