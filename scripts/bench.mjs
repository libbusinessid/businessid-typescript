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
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BusinessIdEngine } from "../dist/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

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

// Cold load. There is no bundle to decode — the rules are code — so what is
// left is evaluating one module, and it has to be measured in a process that
// has not already done it.
{
  const script =
    "const t = process.hrtime.bigint();" +
    `await import(${JSON.stringify(join(root, "dist", "index.js"))});` +
    "process.stdout.write(String(Number(process.hrtime.bigint() - t) / 1e6));";
  const samples = [];
  for (let index = 0; index < 5; index += 1) {
    samples.push(Number(execFileSync(process.execPath, ["--input-type=module", "-e", script])));
  }
  console.log(
    `${"cold load (module evaluation)".padEnd(34)} ${Math.min(...samples)
      .toFixed(2)
      .padStart(9)} ms     (best of 5 processes)`,
  );
}

measure("validate, simple format", 20_000, () => {
  engine.validate({ kind: "siren", value: "552100554" });
});

measure("validate, weighted checksum", 20_000, () => {
  engine.validate({ kind: "vat", value: "BE 0123.456.749" });
});

measure("validate, invalid early", 20_000, () => {
  engine.validate({ kind: "vat", value: "BE!!!" });
});

// Invalid late, and the reason section 14 asks for invalid input at all: an
// identifier well formed enough to reach a register membership test and be
// refused by it pays for the whole lookup, where a valid one stops at the first
// element that matches. A scan of the 2 566 German court codes was invisible in
// every case above, all of which either pass or fail before reaching one.
measure("validate, register miss (2566 codes)", 20_000, () => {
  engine.validate({ kind: "euid", value: "DEZZZZZ.HRB12345" });
});

measure("validate, register hit (2566 codes)", 20_000, () => {
  engine.validate({ kind: "euid", value: "DEK1101R.HRB116737" });
});

measure("validate, register miss (148 codes)", 20_000, () => {
  engine.validate({ kind: "euid", value: "FR9999.012345674" });
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
