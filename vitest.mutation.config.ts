import { defineConfig } from "vitest/config";

/**
 * The configuration mutation testing runs against.
 *
 * Stryker drives one Vitest configuration, and the browser project needs a real
 * browser per run, which would make a mutation sweep impractical. The node
 * project alone covers every line Stryker mutates.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/browser/**", "test/generator/fuzz.test.ts"],
    environment: "node",
  },
});
