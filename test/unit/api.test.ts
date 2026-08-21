import { describe, expect, it, vi } from "vitest";
import {
  BundleError,
  BusinessIdEngine,
  EngineError,
  isChecksumValid,
  isFormatValid,
  isFullyValidated,
  isInvalid,
  KNOWN_IDENTIFIER_KINDS,
  REASON_CODES,
  type RegistryProvider,
  type ValidationReport,
} from "../../src/index.js";
import {
  PredicateOpKind,
  StringOpKind,
  ValueType,
} from "../../src/generated/libbusinessid/ir/v1/rules_pb.js";
import {
  assertionSequence,
  node,
  type NodeSpec,
  requireNode,
  singleKindBundle,
  valueNode,
} from "../helpers/bundle.js";

describe("BusinessIdEngine.default", () => {
  it("decodes the shipped bundle at most once", () => {
    expect(BusinessIdEngine.default).toBe(BusinessIdEngine.default);
  });

  it("reports what the bundle announces", () => {
    expect(BusinessIdEngine.default.rulesInfo().rulesVersion).toBe("2026.08.14");
    expect(BusinessIdEngine.default.capabilities()).toEqual([
      1, 2, 3, 4, 5, 10, 11, 20, 21, 30, 31, 32, 33, 34, 35, 40, 41, 42,
    ]);
  });

  it("lists the kinds it routes, aliases included", () => {
    const kinds = BusinessIdEngine.default.kinds();

    expect(kinds).toContain("vat");
    expect(kinds).toEqual([...KNOWN_IDENTIFIER_KINDS].sort());
  });
});

describe("BusinessIdEngine.fromRules", () => {
  it("throws a typed error naming the reason and the check", () => {
    try {
      BusinessIdEngine.fromRules(new Uint8Array([0x08, 0x63]));
      expect.unreachable("the bundle was accepted");
    } catch (error) {
      expect(error).toBeInstanceOf(BundleError);
      expect(error).toMatchObject({ reason: "incompatible_ruleset", check: 3 });
      expect((error as BundleError).message).toContain("format version");
    }
  });

  it("treats the bytes as untrusted whatever their source", () => {
    expect(() => BusinessIdEngine.fromRules(new Uint8Array())).toThrow(BundleError);
  });
});

describe("ordinary input never throws", () => {
  const engine = BusinessIdEngine.default;
  const loneSurrogate = String.fromCharCode(0xd83d);

  it.each([
    ["an empty value", ""],
    ["a blank value", " "],
    ["a lone surrogate", loneSurrogate],
    ["an astral character", "\u{1D400}"],
    ["a very long value", "9".repeat(5000)],
  ])("returns a report for %s", (_name, value) => {
    expect(() => engine.validate({ kind: "vat", value })).not.toThrow();
    expect(() => engine.canonicalize({ kind: "vat", value })).not.toThrow();
  });

  it("never mutates the object the caller passed", () => {
    const input = { kind: "vat", value: "BE 0123.456.749", countryCode: "BE" };
    const before = { ...input };

    engine.validate(input);

    expect(input).toEqual(before);
  });

  it("is deterministic", () => {
    const input = { kind: "vat", value: "BE 0123.456.749" };

    expect(engine.validate(input)).toEqual(engine.validate(input));
  });
});

describe("report helpers", () => {
  const report = (format: string, checksum: string): ValidationReport =>
    ({
      kind: "vat",
      inputValue: "x",
      canonicalValue: "x",
      profile: "compatible",
      rulesVersion: "2026.08.14",
      formatVersion: 1,
      engineVersion: "0.1.0",
      format: { level: "format", status: format, reasonCode: "ok" },
      checksum: { level: "checksum", status: checksum, reasonCode: "ok" },
    }) as ValidationReport;

  it("names each condition precisely rather than offering one ambiguous flag", () => {
    // A valid format with an unsupported checksum is neither fully validated
    // nor invalid, which is exactly why there is no plain `isValid`.
    const partial = report("valid", "unsupported");

    expect(isFormatValid(partial)).toBe(true);
    expect(isChecksumValid(partial)).toBe(false);
    expect(isFullyValidated(partial)).toBe(false);
    expect(isInvalid(partial)).toBe(false);
  });

  it("reports a full validation and an invalidity", () => {
    expect(isFullyValidated(report("valid", "valid"))).toBe(true);
    expect(isInvalid(report("valid", "invalid"))).toBe(true);
    expect(isInvalid(report("invalid", "not_run"))).toBe(true);
  });
});

describe("the registry interface", () => {
  const engine = BusinessIdEngine.default;
  const input = { kind: "vat", canonicalValue: "BE0123456749", countryCode: "BE" };

  it("reports registry_not_configured when no provider is given", async () => {
    const result = await engine.registryLookup(input, undefined);

    expect(result).toMatchObject({
      status: "unsupported",
      reasonCode: "registry_not_configured",
      canonicalValue: "BE0123456749",
    });
  });

  it("reports registry_not_configured when the provider declines the pair", async () => {
    const lookup = vi.fn();
    const provider: RegistryProvider = { supports: () => false, lookup };

    const result = await engine.registryLookup(input, provider);

    expect(result.reasonCode).toBe("registry_not_configured");
    expect(lookup).not.toHaveBeenCalled();
  });

  it("delegates to a provider that supports the pair", async () => {
    const answer = {
      status: "found" as const,
      providerId: "test",
      checkedAt: "2026-08-21T00:00:00Z",
      canonicalValue: "BE0123456749",
      reasonCode: "ok" as const,
    };
    const provider: RegistryProvider = {
      supports: () => true,
      lookup: () => Promise.resolve(answer),
    };

    await expect(engine.registryLookup(input, provider)).resolves.toEqual(answer);
  });
});

describe("the evaluation budget", () => {
  it("stops a bundle whose graph explodes on re-evaluation", () => {
    // Nodes are re-evaluated at every reference, so a chain where each node
    // reads the previous one twice costs 2^n evaluations. The budget is what
    // keeps a bundle from making an engine work, or allocate, without bound.
    const nodes: NodeSpec[] = [valueNode()];
    for (let level = 0; level < 20; level += 1) {
      const previous = nodes.length - 1;
      nodes.push(
        node(ValueType.STRING, { case: "stringOperation", value: { kind: StringOpKind.CONCAT } }, [
          previous,
          previous,
        ]),
      );
    }
    // The rule must actually read the top of the chain, or it stays dead code.
    const top = nodes.length - 1;
    nodes.push(
      node(
        ValueType.BOOLEAN,
        { case: "predicateOperation", value: { kind: PredicateOpKind.IS_ABSENT } },
        [top],
      ),
      node(
        ValueType.BOOLEAN,
        { case: "predicateOperation", value: { kind: PredicateOpKind.NOT } },
        [top + 1],
      ),
      requireNode(top + 2),
      assertionSequence([top + 3]),
    );
    const engine = BusinessIdEngine.fromRules(singleKindBundle({ format: nodes }));

    expect(() => engine.validate({ kind: "test", value: "1" })).toThrow(EngineError);
  });
});

describe("the reason code registry", () => {
  it("carries the twenty one codes of ir.md section 4", () => {
    expect(REASON_CODES).toHaveLength(21);
    expect(REASON_CODES).toContain("invalid_encoding");
  });
});
