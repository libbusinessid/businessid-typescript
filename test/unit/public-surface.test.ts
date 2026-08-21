import { describe, expect, it } from "vitest";
import * as surface from "../../src/index.js";

/**
 * The exported surface, pinned.
 *
 * Adding an export is a decision; leaking one is an accident. This list is what
 * makes the difference visible in a diff, and it is why no Protobuf type can
 * quietly become part of the public API.
 */
describe("the package exports", () => {
  it("exports exactly what it means to", () => {
    expect(Object.keys(surface).sort()).toEqual([
      "BusinessIdEngine",
      "KNOWN_IDENTIFIER_KINDS",
      "REASON_CODES",
      "STEP_STATUSES",
      "VALIDATION_LEVELS",
      "VALIDATION_PROFILES",
      "isChecksumValid",
      "isFormatValid",
      "isFullyValidated",
      "isInvalid",
    ]);
  });

  it("exposes no Protobuf runtime type", () => {
    const names = Object.keys(surface).join(" ");

    expect(names).not.toMatch(/Schema|RuleBundle|proto|\$typeName/i);
  });

  it("offers no way to load a bundle at run time", () => {
    // The rules are code, emitted by the generator when this package was built.
    // Nothing here decodes anything, so there is no bundle error to catch and
    // no factory to call.
    const names = Object.keys(surface).join(" ");

    expect(names).not.toMatch(/fromRules|BundleError|loadBundle/);
  });

  it("exposes no registry type, not even an experimental one", () => {
    // `engine.md` section 10 defers the registry and forbids shipping a type
    // for it: a public type is a commitment SemVer freezes. Its place is
    // reserved by three properties this package already has — synchronous
    // validation, no registry level in the report, and no HTTP dependency.
    const names = Object.keys(surface).join(" ");

    expect(names).not.toMatch(/Registry|registry/);
  });

  it("names the four public operations and nothing ambiguous", () => {
    const methods = Object.getOwnPropertyNames(surface.BusinessIdEngine.prototype)
      .filter((name) => name !== "constructor")
      .sort();

    expect(methods).toEqual([
      "canonicalize",
      "capabilities",
      "kinds",
      "rulesInfo",
      "validate",
      "validateChecksum",
      "validateFormat",
    ]);
    // There is deliberately no `isValid` on the engine or the report: a valid
    // format with an unsupported checksum is neither validated nor invalid.
    expect(methods).not.toContain("isValid");
  });
});
