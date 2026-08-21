import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: [
      "dist/**",
      "build/**",
      "coverage/**",
      "reports/**",
      ".stryker-tmp/**",
      "src/generated/**",
      "src/assets/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.js", "scripts/*.mjs"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      complexity: ["error", { max: 30 }],
      eqeqeq: ["error", "always"],
      "no-console": "error",
    },
  },
  {
    // The core ships to browsers and bundlers. Nothing under `src` may reach
    // for a Node built-in or a DOM global: `tsconfig.build.json` sets
    // `types: []` so the compiler agrees, and this rule states the intent
    // where a reader will look for it.
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["node:*"], message: "The core must not depend on Node APIs." },
            {
              group: ["fs", "path", "crypto", "buffer", "process"],
              message: "The core must not depend on Node APIs.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "process", message: "The core must not depend on Node APIs." },
        { name: "Buffer", message: "The core must not depend on Node APIs." },
        { name: "__dirname", message: "The core must not depend on Node APIs." },
        { name: "require", message: "The core is ESM only." },
        { name: "document", message: "The core must not depend on the DOM." },
        { name: "window", message: "The core must not depend on the DOM." },
        { name: "fetch", message: "The core performs no network access." },
      ],
    },
  },
  {
    files: ["scripts/**/*.mjs", "tools/**/*.ts", "test/**/*.ts"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        URL: "readonly",
        TextDecoder: "readonly",
      },
    },
  },
);
