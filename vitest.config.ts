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
        // Generated from the spec artifacts and verified by `check:generated`.
        "src/generated/**",
        "src/assets/**",
        // Type-only modules: they declare shapes and compile to nothing, so
        // there is no behaviour to cover. Every module holding runtime code
        // stays in, including the defensive paths of the interpreter.
        "src/runtime/ir.ts",
        "src/domain/input.ts",
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
