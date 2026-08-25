import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The project's name, held in one place: every file this repository writes.
 *
 * The project was renamed to `entid` and its organisation to `entid-org`, over
 * 551 occurrences. A rename of that size is done once and then decays — a
 * comment here, a workflow input description there — and the references that
 * decay first are the ones nothing executes. This test executes them, by
 * reading the bytes rather than the code paths.
 *
 * Two names are deliberately out of its reach:
 *
 *   - the package of the attested schema. `generated/<package>/ir/v1` and the
 *     `$typeName` constants the testee sends are spelled by `rules.proto`,
 *     which this repository copies and does not write. That name changes when
 *     a release changes it, and `rules.lock` pins the bytes that decide;
 *   - the contents of `spec/`, `proto/`, `generated/` and `rules.lock`. The
 *     first holds release artifacts copied verbatim, the next two a copy of the
 *     attested schemas and the code emitted from them, and the last records
 *     what a release measured — including the identity its signing certificate
 *     spelled. All four are checked against the release by digest and
 *     attestation, which is stronger than checking them for a spelling.
 *
 * File *names* are checked everywhere, including under `spec/`: what a bundle
 * is called on disk is this repository's choice, not the release's.
 */

const root = new URL("../../", import.meta.url);

/**
 * The former name, assembled from two halves so that this file does not trip
 * the check it defines. It is the one place in the repository allowed to know
 * it, which is the point of putting the check here.
 */
const FORMER = ["business", "id"].join("");
const FORMER_NAME = new RegExp(FORMER, "i");

/**
 * The proto package of the attested schema, in every spelling it takes:
 * `<package>/ir/v1` in a path, `<package>.testee.v1` in a type name,
 * `file_<package>_ir_v1` in a Protobuf-ES descriptor handle.
 */
const SCHEMA_PACKAGE = new RegExp(`lib${FORMER}[./_](?:ir|conformance|testee)[./_]v1`, "g");

/** What a release decides, verified by digest and attestation rather than here. */
const VENDORED = /^(spec|proto|generated)\/|^rules\.lock$/;

const tracked = execFileSync("git", ["ls-files", "-z"], {
  cwd: fileURLToPath(root),
  encoding: "utf8",
})
  .split("\0")
  .filter((path) => path.length > 0);

/** The text of one tracked file, or the empty string when it holds binary. */
const textOf = (path: string): string => {
  const bytes = readFileSync(new URL(path, root));
  return bytes.includes(0) ? "" : bytes.toString("utf8");
};

/** Strips the schema package, which the release names and this repository copies. */
const own = (text: string): string => text.replace(SCHEMA_PACKAGE, "");

describe("the repository names the project", () => {
  it("reads more than a handful of files", () => {
    // A `git ls-files` that resolved nothing would make every assertion below
    // pass by looking at nothing at all.
    expect(tracked.length).toBeGreaterThan(50);
  });

  it("carries no reference to the former name", () => {
    const guilty = tracked
      .filter((path) => !VENDORED.test(path))
      .filter((path) => FORMER_NAME.test(own(textOf(path))));

    expect(guilty).toEqual([]);
  });

  it("carries no file or directory named after the former name", () => {
    expect(tracked.filter((path) => FORMER_NAME.test(own(path)))).toEqual([]);
  });

  /**
   * The rename moved the organisation to `entid-org`, not to `entid`: the npm
   * scope is `@entid` and the GitHub organisation is `entid-org`, and a blind
   * substitution turns every repository URL into a 404 that reads like a
   * deleted repository rather than like a typo.
   */
  it("spells the GitHub organisation entid-org", () => {
    const wrong = tracked
      .filter((path) => !VENDORED.test(path))
      .flatMap((path) =>
        textOf(path)
          .split("\n")
          .filter((line) => /github\.com\/entid(?!-org)/.test(line))
          .map((line) => `${path}: ${line.trim()}`),
      );

    expect(wrong).toEqual([]);
  });
});
