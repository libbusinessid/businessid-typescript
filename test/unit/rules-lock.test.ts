import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * `rules.lock`, checked against the list `engine.md` calls normative.
 *
 * Section 16 publishes the twelve fields and their order in a fenced
 * `lock-fields` block, and adds `attestation_identity` in thirteenth position on
 * an attested release and on that alone. The list is normative because a field
 * one writer carries and another omits is a release the engines refuse: it
 * happened, with `conformance_jsonl_sha256` existing on one side only and a
 * first release shipping seven digests where four engines verified eight.
 *
 * The expected list is read from `spec/engine.md` rather than restated here.
 * Restating it would make this test agree with itself: the point is that the
 * lock agrees with the specification the tree is synchronized onto.
 */

const root = new URL("../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), "utf8");

/** The fields `engine.md` section 16 publishes, in the order it publishes them. */
const normative = (() => {
  const block = /```lock-fields\n([\s\S]*?)```/.exec(read("spec/engine.md"))?.[1];
  if (block === undefined) {
    throw new Error("spec/engine.md carries no fenced lock-fields block");
  }
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
})();

/** The fields `rules.lock` carries, in the order it carries them. */
const carried = read("rules.lock")
  .split("\n")
  .filter((line) => line.trim().length > 0 && !line.trimStart().startsWith("#"))
  .map((line) => line.split("=")[0]?.trim() ?? "");

const valueOf = (field: string): string | undefined =>
  new RegExp(`^${field}\\s*=\\s*"?([^"\\n]*)"?$`, "m").exec(read("rules.lock"))?.[1];

describe("rules.lock", () => {
  it("reads a normative list that is not empty", () => {
    // A regex that matched an empty block would make the comparison below pass
    // against nothing at all.
    expect(normative).toHaveLength(12);
  });

  it("carries exactly the normative fields, in order", () => {
    expect(carried.slice(0, normative.length)).toEqual(normative);
  });

  it("adds attestation_identity in thirteenth position and nothing after it", () => {
    // An attested release, so the field is present. A local synchronization
    // leaves a comment in its place instead, which the filter above drops —
    // this repository has never held such a lock and would fail here if it did,
    // which is the intended reading of "on an attested release and on it alone".
    expect(carried).toEqual([...normative, "attestation_identity"]);
  });

  it("names a release of the specification repository", () => {
    expect(valueOf("attestation_identity")).toMatch(
      /^entid-org\/spec\/\.github\/workflows\/release\.yml@refs\/tags\/v[\w.]+$/,
    );
  });

  it("names the release its rules version belongs to", () => {
    // The tag and the rules version are two spellings of one release, and a
    // lock naming one release's digests under another's tag is the failure this
    // catches. `spec` refuses such a tag at release time; nothing here did.
    const tag = valueOf("attestation_identity")?.split("@refs/tags/")[1];

    expect(tag).toBe(`v${String(valueOf("rules_version"))}`);
  });
});
