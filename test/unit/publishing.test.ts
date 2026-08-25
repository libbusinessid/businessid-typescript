import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * What a release needs to be true before the release runs.
 *
 * Publishing happens once every few months, from a workflow nobody reads in
 * between, and every mistake it can make surfaces at the very last step: npm
 * refuses the provenance attestation, or the tarball lands under the wrong
 * version, or it lands private. These assertions move that feedback here.
 *
 * The registry is never contacted. Every property below is readable from the
 * repository, which is the only reason a test can hold them.
 */

const root = new URL("../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), "utf8");

const manifest = JSON.parse(read("package.json")) as {
  name: string;
  version: string;
  private?: boolean;
  repository?: { type: string; url: string };
  publishConfig?: { access?: string; provenance?: boolean };
};
const release = read(".github/workflows/release.yml");

const REPOSITORY = "https://github.com/entid-org/entid-typescript";
/** The npm name reserved for this engine, which `engine-typescript.md` names. */
const PACKAGE = "@entid/entid";

describe("the published package", () => {
  it("is published under the reserved name", () => {
    // The project was renamed, and a package name is the one identifier a
    // consumer types. `@entid` is reserved for it; `@entid/entid`
    // named an organisation that no longer exists.
    expect(manifest.name).toBe(PACKAGE);
  });

  it("names the repository it is built from", () => {
    // npm compares this against the repository the workflow runs in, case
    // sensitively, and refuses to attest provenance when they disagree.
    expect(manifest.repository).toEqual({ type: "git", url: `git+${REPOSITORY}.git` });
  });

  it("publishes the scope publicly", () => {
    // A scoped package is restricted by default, and `@entid` is a free
    // organisation, which cannot hold a private package: the first publish
    // would be refused outright.
    expect(manifest.publishConfig?.access).toBe("public");
  });

  it("leaves provenance to the workflow rather than the manifest", () => {
    // Setting it here would make provenance a property of every publish,
    // including one run by hand, where there is no OIDC token to attest with
    // and npm fails. The workflow is the only place that can honour it.
    expect(manifest.publishConfig?.provenance).toBeUndefined();
  });

  it("is not marked private", () => {
    expect(manifest.private).toBeUndefined();
  });
});

describe("the release workflow", () => {
  it("runs when a release is published", () => {
    expect(release).toMatch(/release:\s*\n\s*types: \[published]/);
  });

  it("refuses a tag that disagrees with the version", () => {
    // Nothing else stops a release tagged v0.2.0 from publishing 0.1.0 again,
    // and npm accepts it: the tarball is a valid 0.1.0.
    expect(release).toContain("github.event.release.tag_name");
  });

  it("asks for the OIDC token trusted publishing needs", () => {
    expect(release).toMatch(/id-token: write/);
  });

  it("upgrades npm past the version trusted publishing needs", () => {
    // Trusted publishing needs npm 11.5.1 or later. The npm bundled with the
    // Node this workflow runs is older, and the failure it produces is a 404
    // that reads as if the package did not exist.
    expect(release).toMatch(/npm install -g npm@/);
  });

  it("publishes with provenance", () => {
    expect(release).toMatch(/npm publish[^\n]*--provenance/);
  });

  it("stores no npm token", () => {
    // The point of trusted publishing: the registry trusts the workflow
    // identity, so there is no long-lived credential in this repository to
    // leak, rotate or forget.
    expect(release).not.toMatch(/secrets\./);
    expect(release).not.toMatch(/NODE_AUTH_TOKEN|NPM_TOKEN/);
  });
});
