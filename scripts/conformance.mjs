#!/usr/bin/env node
/**
 * Runs the shared conformance suite.
 *
 * The runner comes from `spec` and from nowhere else, pinned to the commit
 * `rules.lock` records under `source_commit` — the same commit as the corpus,
 * which makes it impossible to judge one corpus with another's comparator.
 *
 * This engine deliberately has no comparator of its own. A comparator written
 * by the engine it judges can compare too weakly — forget a field, read an
 * absent one as empty — and report conformance while being wrong. What this
 * repository writes is the testee, and the tests proving it does not cheat.
 *
 * A Go toolchain is the only prerequisite. It is a build tool: it enters
 * neither the published package nor its dependencies.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const lock = readFileSync(join(root, "rules.lock"), "utf8");
const commit = /^source_commit\s*=\s*"([0-9a-f]{40})"/m.exec(lock)?.[1];
if (commit === undefined) {
  throw new Error("rules.lock records no source_commit");
}

const testee = join(root, "build", "tools", "testee", "main.js");
console.log(`runner pinned to spec@${commit}`);

execFileSync(
  "go",
  [
    "run",
    `github.com/libbusinessid/spec/cmd/conformance-runner@${commit}`,
    "-corpus",
    join(root, "spec", "businessid-conformance.binpb"),
    "--",
    process.execPath,
    testee,
  ],
  { cwd: root, stdio: "inherit" },
);
