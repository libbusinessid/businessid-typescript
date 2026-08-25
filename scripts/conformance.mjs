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

/**
 * The module path of the runner, read from the release rather than written here.
 *
 * A Go module declares its own path in `go.mod`, and that path is the
 * repository's name *at the pinned commit*. This project was renamed, so a
 * commit cut before the rename declares the former path and `go run` refuses
 * the current one outright: "module declares its path as ... but was required
 * as ...". GitHub's redirect does not help, because the conflict is between two
 * strings and not between two locations.
 *
 * `attestation_identity` is the only field naming the repository a release came
 * from, which makes it the only thing here that knows which of the two names
 * the pinned commit carries. A lock without it was produced locally, from a
 * checkout of the current repository, so the current name is the right answer.
 */
const SPEC_MODULE = "github.com/entid-org/spec";
const identity = /^attestation_identity\s*=\s*"([^/"]+\/[^/"]+)\//m.exec(lock)?.[1];
const specModule = identity === undefined ? SPEC_MODULE : `github.com/${identity}`;

const testee = join(root, "build", "tools", "testee", "main.js");
console.log(`runner pinned to ${specModule}@${commit}`);

execFileSync(
  "go",
  [
    "run",
    `${specModule}/cmd/conformance-runner@${commit}`,
    "-corpus",
    join(root, "spec", "entid-conformance.binpb"),
    "--",
    process.execPath,
    testee,
  ],
  { cwd: root, stdio: "inherit" },
);
