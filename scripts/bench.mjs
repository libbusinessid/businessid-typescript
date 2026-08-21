#!/usr/bin/env node
/**
 * Benchmarks the operations the specification names.
 *
 * These numbers are not normative and no threshold gates on them. They exist
 * so that a change which quietly makes validation an order of magnitude slower
 * is visible in a pull request rather than in a consumer's profiler.
 *
 * Run `pnpm build` first: this measures what ships, not what the test runner
 * transforms.
 */
import { performance } from "node:perf_hooks";
import { BusinessIdEngine } from "../dist/index.js";
import { RULES_BUNDLE_BYTES } from "../dist/assets/rules.generated.js";

function measure(name, iterations, body) {
  // One untimed pass so the measurement is not dominated by first-call costs.
  body();
  const start = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    body();
  }
  const elapsed = performance.now() - start;
  const each = (elapsed * 1000) / iterations;
  console.log(
    `${name.padEnd(34)} ${each.toFixed(2).padStart(9)} us/op  (${String(iterations)} ops)`,
  );
}

const engine = BusinessIdEngine.default;

measure("cold load of the bundle", 20, () => {
  BusinessIdEngine.fromRules(RULES_BUNDLE_BYTES);
});

measure("validate, simple format", 20_000, () => {
  engine.validate({ kind: "siren", value: "552100554" });
});

measure("validate, weighted checksum", 20_000, () => {
  engine.validate({ kind: "vat", value: "BE 0123.456.749" });
});

measure("validate, invalid early", 20_000, () => {
  engine.validate({ kind: "vat", value: "BE!!!" });
});

measure("validate, unknown kind", 20_000, () => {
  engine.validate({ kind: "not-a-kind", value: "1234" });
});

measure("canonicalize only", 20_000, () => {
  engine.canonicalize({ kind: "vat", value: "  be 0123 456 749  " });
});

measure("validate, input at the bound", 5_000, () => {
  engine.validate({ kind: "vat", value: "9".repeat(1024) });
});
