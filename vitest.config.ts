import { defineConfig } from "vitest/config";

/**
 * Two projects run the same engine in the two environments it ships to.
 *
 * `node` runs everything, including the conformance exchange with the testee,
 * which needs a child process. `browser` runs the subset that proves the core
 * works with no Node API in sight: the bundle is inlined as bytes, so the
 * default engine must build itself in a page without a fetch or a file read.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        // The rules themselves, emitted by the generator from the attested
        // bundle and covered end to end by the conformance run. What is
        // measured here is the code that was written by hand.
        "src/rules.generated.ts",
        "src/assets/**",
        // Type-only modules: they declare shapes and compile to nothing, so
        // there is no behaviour to cover.
        "src/domain/input.ts",
        "src/runtime/ruleset.ts",
        "src/runtime/values.ts",
      ],
      thresholds: {
        lines: 95,
        statements: 95,
        functions: 95,
        branches: 90,
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          include: ["test/**/*.test.ts"],
          // Fuzzing generates code thousands of times, which takes far longer
          // than the default per-test budget allows, especially under coverage
          // instrumentation. Raising the budget is the answer; running fewer
          // cases is not.
          testTimeout: 120_000,
          exclude: ["test/browser/**"],
          environment: "node",
          typecheck: {
            enabled: true,
            include: ["test/types/**/*.test-d.ts"],
            tsconfig: "./tsconfig.json",
          },
        },
      },
      {
        extends: true,
        test: {
          name: "browser",
          include: ["test/browser/**/*.test.ts"],
          browser: {
            enabled: true,
            provider: "playwright",
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
