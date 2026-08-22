#!/usr/bin/env node
/**
 * Builds the generator and runs it.
 *
 * The generator is TypeScript, so it is compiled first. That compilation needs
 * only the generator, the Protobuf types and the domain vocabulary — never the
 * file it is about to write, so a checkout with no generated code bootstraps
 * cleanly.
 *
 * Pass `--check` to verify what is on disk rather than write it.
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: "inherit" });

run("npx", ["tsc", "-p", "tsconfig.generator.json"]);
run(process.execPath, [
  join(root, "build", "tools", "generator", "cli.js"),
  ...process.argv.slice(2),
]);
