#!/usr/bin/env node
/**
 * Builds the package, packs it and installs the tarball into a blank project.
 *
 * This is the only check that exercises what a consumer actually receives:
 * the `exports` map, the emitted `.d.ts`, and whether every file the package
 * needs is really in the tarball. A missing asset shows up here and nowhere
 * else, because the test suite resolves modules from the source tree.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

console.log("building");
run("npx", ["tsc", "-p", "tsconfig.build.json"], root);

console.log("packing");
const packed = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", root], root));
const tarball = join(root, packed[0].filename);

// The engine is a generator's output, not an interpreter: `engine.md` section
// 1.2 keeps the bundle and the Protobuf runtime out of what ships. The public
// surface tests state that from inside the source tree, where a bundle could
// still be packed alongside it. Only the tarball settles it.
const packedPaths = packed[0].files.map((file) => file.path);
const bundles = packedPaths.filter((path) => path.endsWith(".binpb"));
if (bundles.length > 0) {
  throw new Error(`the tarball carries a rule bundle: ${bundles.join(", ")}`);
}
// A source map that names a file the tarball does not carry resolves to
// nothing: a debugger shows "source not available" and the bytes were paid for
// on install regardless. `files` ships `dist` and never `src`, so every map
// emitted next to the JavaScript pointed at a source no consumer receives —
// 55 % of the unpacked package at rules 2026.08.31, once the membership lists
// arrived. Either the sources ship or the maps do not; this asserts whichever
// choice is in force is coherent.
{
  const packedSet = new Set(packedPaths);
  const dangling = [];
  for (const path of packedPaths.filter((one) => one.endsWith(".map"))) {
    const map = JSON.parse(readFileSync(join(root, path.replace(/^package\//, "")), "utf8"));
    const dir = path.slice(0, path.lastIndexOf("/"));
    for (const source of map.sources ?? []) {
      // `sourcesContent` carries the text inline, so such a map is self-contained.
      if (Array.isArray(map.sourcesContent) && map.sourcesContent.length > 0) {
        continue;
      }
      const resolved = new URL(source, `file:///${dir}/`).pathname.replace(/^\//, "");
      if (!packedSet.has(resolved)) {
        dangling.push(`${path} -> ${source}`);
      }
    }
  }
  if (dangling.length > 0) {
    throw new Error(
      `the tarball carries ${String(dangling.length)} source map reference(s) to files it does not ship:\n  ${dangling.slice(0, 5).join("\n  ")}${dangling.length > 5 ? `\n  ... and ${String(dangling.length - 5)} more` : ""}`,
    );
  }
}

for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
  const declared = Object.keys(manifest[field] ?? {});
  if (declared.length > 0) {
    throw new Error(`the package declares ${field}: ${declared.join(", ")}`);
  }
}

const consumer = mkdtempSync(join(tmpdir(), "businessid-consumer-"));
try {
  writeFileSync(
    join(consumer, "package.json"),
    `${JSON.stringify({ name: "consumer", private: true, version: "1.0.0", type: "module" }, null, 2)}\n`,
  );
  console.log(`installing the tarball into ${consumer}`);
  run("npm", ["install", "--no-audit", "--no-fund", tarball], consumer);

  // What a consumer really receives. A declared dependency is caught above; a
  // Protobuf runtime that arrived any other way is caught here, because a blank
  // project installing this package must end up with this package alone.
  const installed = readdirSync(join(consumer, "node_modules"))
    .filter((entry) => !entry.startsWith("."))
    .flatMap((entry) =>
      entry.startsWith("@")
        ? readdirSync(join(consumer, "node_modules", entry)).map((sub) => `${entry}/${sub}`)
        : [entry],
    );
  if (installed.join(" ") !== manifest.name) {
    throw new Error(`installing the package pulled in more than itself: ${installed.join(", ")}`);
  }

  // Exercise the package the way a consumer would: a bare ESM import of the
  // published name, with no bundler and no configuration.
  writeFileSync(
    join(consumer, "use.mjs"),
    [
      `import { BusinessIdEngine, isFullyValidated } from "${manifest.name}";`,
      "const engine = BusinessIdEngine.default;",
      'const report = engine.validate({ kind: "vat", value: "BE 0123.456.749" });',
      "const info = engine.rulesInfo();",
      "console.log(JSON.stringify({",
      "  canonicalValue: report.canonicalValue,",
      "  format: report.format.status,",
      "  checksum: report.checksum.status,",
      "  fully: isFullyValidated(report),",
      "  rulesVersion: info.rulesVersion,",
      "  capabilities: engine.capabilities().length,",
      "}));",
      "",
    ].join("\n"),
  );

  const output = run(process.execPath, ["use.mjs"], consumer).trim();
  const observed = JSON.parse(output);

  const expected = {
    canonicalValue: "BE0123456749",
    format: "valid",
    checksum: "valid",
    fully: true,
    rulesVersion: "2026.08.31",
    capabilities: 18,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (observed[key] !== value) {
      throw new Error(
        `consumer observed ${key}=${String(observed[key])}, expected ${String(value)}`,
      );
    }
  }

  // The types must resolve for a consumer compiling against the package.
  writeFileSync(
    join(consumer, "use.ts"),
    [
      `import { BusinessIdEngine, type ValidationReport } from "${manifest.name}";`,
      "const report: ValidationReport = BusinessIdEngine.default.validate({",
      '  kind: "vat",',
      '  value: "BE0123456749",',
      "});",
      "export const status: string = report.format.status;",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(consumer, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "nodenext",
          strict: true,
          noEmit: true,
          skipLibCheck: false,
        },
        include: ["use.ts"],
      },
      null,
      2,
    )}\n`,
  );
  run(
    "npm",
    [
      "install",
      "--no-audit",
      "--no-fund",
      "--save-dev",
      `typescript@${manifest.devDependencies.typescript}`,
    ],
    consumer,
  );
  run(join(consumer, "node_modules", ".bin", "tsc"), ["-p", "tsconfig.json"], consumer);

  console.log("consumer project builds and runs against the tarball");
} finally {
  rmSync(consumer, { recursive: true, force: true });
  rmSync(tarball, { force: true });
}
