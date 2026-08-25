#!/usr/bin/env node
/**
 * The whole verification, as one command.
 *
 * `engine.md` section 12.5: lock digests, regeneration, build, tests,
 * conformance against the runner from `spec`, lint, format, coverage and
 * thresholds, packaging, the dependency audit — one entry point, and the
 * contract is
 *
 *   - success: one line, carrying the numbers that matter and nothing else;
 *   - failure: the output of the failing step and only that, named;
 *   - non-zero exit as soon as a step fails, never swallowed.
 *
 * The reason is not tidiness. A resync round run as thirty commands puts thirty
 * full outputs through the context of whoever drives it, twenty-nine of which
 * say nothing but "this passes". A command that stays quiet when all is well
 * makes the complete verification cheaper than a partial one.
 *
 * CI calls this too, so "green" never has two definitions.
 *
 * Every step declares what its output must contain. A step that runs, exits
 * zero and did nothing — a glob matching no files, a suite that collected no
 * tests — fails here rather than passing over. That is not hypothetical: this
 * repository shipped a `test:fuzz` script pointing at a path that did not
 * exist, and a scheduled workflow failed on it for weeks without anyone
 * learning anything about the engine.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
/**
 * Optional step filters. `pnpm verify` runs everything and is the definition of
 * green; `pnpm verify "tests (node)" packaging` runs those steps alone.
 *
 * Scoped runs exist for one honest reason and no other: proving the shipped
 * engine works on the oldest Node this package supports. The browser project
 * cannot be part of that, because its toolchain cannot run there — `vite`
 * calls `crypto.hash`, added in Node 20.12, and this package supports 20.11 for
 * consumers who have no toolchain at all. A scoped run says which steps it ran
 * and never prints the single green line, so it cannot be mistaken for one.
 */
const only = process.argv.slice(2);

/**
 * Strips ANSI styling.
 *
 * Tools colour their output when they please, and a colour code between a label
 * and its number is enough to make a check for that number fail. Matching — and
 * the failure output a reader sees — both work on plain text.
 */
// eslint-disable-next-line no-control-regex
const plain = (text) => text.replace(/\u001B\[[0-9;]*[A-Za-z]/g, "");

/** Runs one step, capturing everything. Throws with the output on failure. */
function run(command, args) {
  try {
    return plain(
      execFileSync(command, args, {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", CI: "1" },
      }),
    );
  } catch (error) {
    const output = plain(`${error.stdout ?? ""}${error.stderr ?? ""}`).trim();
    throw new Error(output.length > 0 ? output : String(error.message));
  }
}

const script = (name) => ["run", "--silent", name];

/**
 * `require` is what makes a silent no-op fail. Each entry is a RegExp the
 * step's own output must match; if it does not, the step did not do what its
 * name claims however it exited.
 */
const steps = [
  {
    name: "digests and generated code",
    // Verifies all eight digests `rules.lock` attests, then that the emitted
    // module is exactly what the generator writes from the attested bundle.
    run: () => run("npm", script("check:generated")),
    require: [/check:generated ok \(rules [^,]+, format \d+, \d+ capabilities\)/],
  },
  {
    name: "protobuf types match the schemas",
    // buf reads `proto/`, which is a copy of the three schemas `rules.lock`
    // attests — so the copy is compared to the attested original before buf
    // runs. A copy a rules update left behind would regenerate the types from
    // the previous release's definitions, and the diff below would report
    // nothing at all: `generated/` matches `proto/`, and `proto/` is the thing
    // that drifted.
    run: () => {
      const copies = [
        ["rules.proto", "proto/entid/ir/v1/rules.proto"],
        ["conformance.proto", "proto/entid/conformance/v1/conformance.proto"],
        ["testee.proto", "proto/entid/testee/v1/testee.proto"],
      ];
      const lines = copies.map(([schema, copy]) => {
        const attested = readFileSync(join(root, "spec", schema));
        const vendored = readFileSync(join(root, copy));
        if (!attested.equals(vendored)) {
          throw new Error(
            `${copy} is not spec/${schema}\n  copy the attested schema over it, then regenerate`,
          );
        }
        return `${createHash("sha256").update(attested).digest("hex").slice(0, 16)} spec/${schema} == ${copy}`;
      });
      // Generated beside the tree and compared to it, rather than over it and
      // compared with `git diff`. Two reasons, and the first is what broke:
      //
      //   - a comparison against the index answers "has this been staged", not
      //     "is this what buf emits". `rules-sync` regenerates and then runs
      //     this entry point before committing anything, so a release that
      //     changes the schemas — this one renamed their package — failed here
      //     with the work correctly done, and the synchronization pull request
      //     opened red and unarmed for it;
      //   - `git diff` never reports a file git does not track, so a stale
      //     module buf no longer emits went unnoticed. Comparing two listings
      //     names it.
      const emitted = mkdtempSync(join(tmpdir(), "entid-buf-"));
      try {
        run("npx", ["buf", "generate", "--output", emitted]);
        const listing = (base) =>
          readdirSync(base, { recursive: true, withFileTypes: true })
            .filter((entry) => entry.isFile())
            // `parentPath` since Node 20.12; `path` is its name before that,
            // and this file also runs on the 20.11 floor the package supports.
            .map((entry) => relative(base, join(entry.parentPath ?? entry.path, entry.name)))
            .sort();

        // `--output` is prepended to the `out` of the generation template,
        // which is `generated`: the fresh tree lands one level down.
        const freshRoot = join(emitted, "generated");
        const fresh = listing(freshRoot);
        const committed = listing(join(root, "generated"));
        const missing = fresh.filter((path) => !committed.includes(path));
        const stale = committed.filter((path) => !fresh.includes(path));
        const differing = fresh
          .filter((path) => committed.includes(path))
          .filter(
            (path) =>
              !readFileSync(join(freshRoot, path)).equals(
                readFileSync(join(root, "generated", path)),
              ),
          );

        const wrong = [
          ...missing.map((path) => `  missing   generated/${path}`),
          ...stale.map((path) => `  stale     generated/${path}`),
          ...differing.map((path) => `  differs   generated/${path}`),
        ];
        if (wrong.length > 0) {
          throw new Error(
            `generated/ is not what buf emits:\n${wrong.join("\n")}\n  run pnpm exec buf generate`,
          );
        }
        lines.push(`generated/ is ${String(fresh.length)} files, all as buf emits them`);
      } finally {
        rmSync(emitted, { recursive: true, force: true });
      }
      return lines.join("\n");
    },
    require: [
      /^[0-9a-f]{16} spec\/rules\.proto == /m,
      /^[0-9a-f]{16} spec\/conformance\.proto == /m,
      /^[0-9a-f]{16} spec\/testee\.proto == /m,
      /^generated\/ is [1-9]\d* files, all as buf emits them$/m,
    ],
  },
  {
    name: "format",
    run: () => run("npm", script("format:check")),
    require: [/All matched files use Prettier code style/],
  },
  { name: "lint", run: () => run("npm", script("lint")), require: [/^\s*$|No issues found/] },
  { name: "types", run: () => run("npm", script("typecheck")) || "no type errors", require: [/./] },
  { name: "build", run: () => run("npm", script("build")) || "built", require: [/./] },
  {
    name: "tests (node)",
    run: () => run("npm", script("test:node")),
    require: [/Tests\s+(\d+) passed/, /Test Files\s+\d+ passed/],
    counts: { tests: /Tests\s+(\d+) passed \(\d+\)/ },
  },
  {
    name: "tests (browser)",
    run: () => run("npm", script("test:browser")),
    require: [/Tests\s+(\d+) passed/],
    counts: { browserTests: /Tests\s+(\d+) passed \(\d+\)/ },
  },
  {
    name: "conformance",
    run: () => run("npm", script("test:conformance")),
    require: [/^conformant$/m, /\d+ cases, \d+ matched, 0 differed/],
    counts: { cases: /(\d+) cases, \d+ matched, 0 differed/ },
  },
  {
    name: "coverage thresholds",
    run: () => run("npm", script("test:coverage")),
    require: [/All files\s*\|/],
    counts: {
      lines: /All files\s*\|\s*[\d.]+\s*\|\s*[\d.]+\s*\|\s*[\d.]+\s*\|\s*([\d.]+)/,
      branches: /All files\s*\|\s*[\d.]+\s*\|\s*([\d.]+)/,
    },
  },
  {
    name: "coverage of the emitted rules (published, never gated)",
    run: () => run("npm", script("coverage:generated")),
    // The table row, not the banner above it: the banner names the file whether
    // or not anything was measured.
    require: [/^All files\s*\|\s*[\d.]+/m, /generated\.ts\s*\|\s*[\d.]+/],
    counts: {
      emitted: /^All files\s*\|\s*[\d.]+\s*\|\s*[\d.]+\s*\|\s*[\d.]+\s*\|\s*([\d.]+)/m,
    },
  },
  {
    name: "packaging and consumer install",
    run: () => run("npm", script("test:pack")),
    require: [/consumer project builds and runs against the tarball/],
  },
  {
    name: "dependency audit",
    // Here rather than in a job of its own, because a job of its own is a
    // second definition of green: auto-merge follows what branch protection
    // requires, and anything green outside this entry point is something it
    // would merge over. The severity floor stays the flag's, and `pnpm audit`
    // exits non-zero on its own when the floor is crossed.
    //
    // The dependency count is what proves the step looked: an audit that
    // resolved nothing exits zero and reports nothing wrong, which is exactly
    // the shape of pass this file exists to refuse.
    run: () => {
      const report = JSON.parse(run("npm", script("audit")));
      const found = Object.entries(report.metadata.vulnerabilities)
        .map(([severity, count]) => `${severity} ${String(count)}`)
        .join(", ");
      return `${String(report.metadata.totalDependencies)} dependencies audited: ${found}`;
    },
    require: [/^[1-9]\d* dependencies audited: /],
  },
];

const numbers = {};
const wanted =
  only.length === 0
    ? steps
    : steps.filter((step) => only.some((filter) => step.name.includes(filter)));
if (wanted.length === 0) {
  process.stderr.write(`no step matches ${only.map((one) => JSON.stringify(one)).join(", ")}\n`);
  process.exit(2);
}

for (const step of wanted) {
  let output;
  try {
    output = step.run() ?? "";
  } catch (error) {
    process.stderr.write(`${step.name}\n\n${error.message}\n`);
    process.exit(1);
  }
  for (const pattern of step.require ?? []) {
    if (!pattern.test(output)) {
      process.stderr.write(
        `${step.name}\n\nthe step exited zero without doing its work: nothing in its output matched ${String(pattern)}\n\n${output.trim()}\n`,
      );
      process.exit(1);
    }
  }
  for (const [key, pattern] of Object.entries(step.counts ?? {})) {
    const found = pattern.exec(output);
    if (found?.[1] !== undefined) {
      numbers[key] = found[1];
    }
  }
}

if (wanted.length !== steps.length) {
  process.stdout.write(`${wanted.map((step) => step.name).join(", ")}: ok\n`);
  process.exit(0);
}

// The shipped size, which is the third figure section 12.5 names.
const packed = JSON.parse(run("npm", ["pack", "--dry-run", "--json"]))[0];
const lock = readFileSync(join(root, "rules.lock"), "utf8");
const rules = /^rules_version\s*=\s*"([^"]+)"/m.exec(lock)?.[1] ?? "?";

process.stdout.write(
  `verified rules ${rules} · ${numbers.cases}/${numbers.cases} conformance · ` +
    `${numbers.tests} node + ${numbers.browserTests} browser tests · ` +
    `${numbers.lines}% lines ${numbers.branches}% branches, emitted ${numbers.emitted}% · ` +
    `${String(packed.entryCount)} files ${packed.size.toLocaleString("en-US")} B packed\n`,
);
