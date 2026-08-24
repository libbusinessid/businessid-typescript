#!/usr/bin/env node
/**
 * Measures the coverage of the emitted rules, and never gates on it.
 *
 * `engine.md` section 12.2 separates the two: the thresholds in
 * `vitest.config.ts` cover hand-written code — the engine, its primitives, its
 * API and its generator — while the code emitted from the bundle is covered by
 * conformance, and its coverage measures the corpus rather than the engine. A
 * rule branch no case reaches says something about the corpus; turning that
 * into a threshold would fail a faultless engine and the only way back to green
 * would be to lower the number.
 *
 * So this run publishes a figure and asserts nothing. Read it as a corpus
 * measurement.
 *
 * What it does not include: the shared conformance run drives the testee as a
 * child process, which V8 does not instrument from here. The 666 cases
 * therefore reach rules this figure does not credit, and the real coverage of
 * the emitted rules is higher than what this prints.
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

console.log("Coverage of src/rules.generated.ts, from the in-process node suite.");
console.log("Published, never gated: see engine.md section 12.2.");
console.log("Excludes the conformance run, which drives the testee in a child process.\n");

execFileSync(
  "npx",
  [
    "vitest",
    "run",
    "--project",
    "node",
    "--coverage",
    "--coverage.include=src/rules.generated.ts",
    // vitest.config.ts excludes the emitted rules from the gated run. Replacing
    // the exclude list here is what lets this run see them at all.
    "--coverage.exclude=!src/rules.generated.ts",
    "--coverage.thresholds.lines=0",
    "--coverage.thresholds.statements=0",
    "--coverage.thresholds.functions=0",
    "--coverage.thresholds.branches=0",
    "--coverage.reporter=text",
    "--coverage.reporter=json-summary",
    "--coverage.reportsDirectory=coverage/generated",
  ],
  { cwd: root, stdio: "inherit" },
);
