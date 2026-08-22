import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { IdentifierInput, ValidationOptions } from "../../src/domain/input.js";
import type { CanonicalizationResult, ValidationReport } from "../../src/domain/result.js";
import { execute } from "../../src/runtime/pipeline.js";
import type { RuleSet } from "../../src/runtime/ruleset.js";
import { generate } from "../../tools/generator/generate.js";

/**
 * Generates rules from a bundle and returns an engine over them.
 *
 * This is how an IR operation is tested now that the engine interprets nothing:
 * the bundle goes through the real generator, the emitted TypeScript is written
 * out and imported, and the result is driven through the same pipeline the
 * package ships. A test therefore exercises the generator, the emitted code and
 * the runtime together, which is the only combination that ships.
 */
const OUT = fileURLToPath(new URL("../.generated/", import.meta.url));

// Git tracks no empty directory, so a fresh checkout has none of this. Creating
// it here rather than committing a placeholder keeps the scratch area a
// property of the helper that uses it.
mkdirSync(OUT, { recursive: true });
const ENGINE_VERSION = "0.0.0-test";

const cache = new Map<string, Promise<RuleSet>>();

/** Generates and loads the rules a bundle produces. */
export async function ruleSetFor(bytes: Uint8Array): Promise<RuleSet> {
  const { source } = generate(bytes, { importPrefix: "../../src/" });
  const digest = createHash("sha256").update(source).digest("hex").slice(0, 16);
  const existing = cache.get(digest);
  if (existing !== undefined) {
    return existing;
  }
  const path = `${OUT}rules-${digest}.ts`;
  if (!existsSync(path)) {
    writeFileSync(path, source);
  }
  const loading = import(path) as Promise<RuleSet>;
  cache.set(digest, loading);
  return loading;
}

/** The four public operations, over rules generated from a bundle. */
export interface TestEngine {
  canonicalize: (input: IdentifierInput, options?: ValidationOptions) => CanonicalizationResult;
  validate: (input: IdentifierInput, options?: ValidationOptions) => ValidationReport;
  validateFormat: (input: IdentifierInput, options?: ValidationOptions) => ValidationReport;
  validateChecksum: (input: IdentifierInput, options?: ValidationOptions) => ValidationReport;
  rules: RuleSet;
}

/** Builds an engine over rules generated from a bundle. */
export async function engineFor(bytes: Uint8Array): Promise<TestEngine> {
  const rules = await ruleSetFor(bytes);
  return {
    rules,
    canonicalize: (input, options) =>
      execute(rules, ENGINE_VERSION, "canonicalize", input, options) as CanonicalizationResult,
    validate: (input, options) =>
      execute(rules, ENGINE_VERSION, "validate", input, options) as ValidationReport,
    validateFormat: (input, options) =>
      execute(rules, ENGINE_VERSION, "validateFormat", input, options) as ValidationReport,
    validateChecksum: (input, options) =>
      execute(rules, ENGINE_VERSION, "validateChecksum", input, options) as ValidationReport,
  };
}
