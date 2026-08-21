import { describe, expect, it } from "vitest";
import { BusinessIdEngine } from "../../src/index.js";
import {
  CanonicalizationOpKind,
  PredicateOpKind,
  ProgramKind,
  ReasonCode,
  ValueType,
} from "../../src/generated/libbusinessid/ir/v1/rules_pb.js";
import {
  alwaysValidFormat,
  assertionSequence,
  bundle,
  canonicalizationSequence,
  encode,
  node,
  type NodeSpec,
  program,
  requireNode,
  singleKindBundle,
  valueNode,
} from "../helpers/bundle.js";

/**
 * Dispatch and the validation pipeline of `ir.md` sections 5 and 6.
 *
 * Two rules govern almost every case here. A step never runs on a value the
 * previous step did not accept, and an absence of knowledge is reported as
 * `unsupported`, never as an invalidity.
 */
const digitsFormat = (): NodeSpec[] => [
  valueNode(),
  node(
    ValueType.BOOLEAN,
    { case: "predicateOperation", value: { kind: PredicateOpKind.ASCII_DIGITS } },
    [0],
  ),
  requireNode(1, ReasonCode.INVALID_CHARACTERS, "test.characters"),
  assertionSequence([2]),
];

describe("the input bound", () => {
  const engine = BusinessIdEngine.fromRules(singleKindBundle({ format: digitsFormat() }));

  it("refuses a value above 1024 UTF-8 bytes without processing it", () => {
    const report = engine.validate({ kind: "test", value: "1".repeat(1025) });

    expect(report.format).toMatchObject({ status: "unsupported", reasonCode: "input_too_long" });
    expect(report.checksum).toMatchObject({
      status: "not_run",
      reasonCode: "not_run_format_unsupported",
    });
    // The value is reported verbatim, uncanonicalized.
    expect(report.canonicalValue).toBe(report.inputValue);
  });

  it("measures UTF-8 bytes, not UTF-16 units or code points", () => {
    // 512 astral code points are 1024 UTF-16 units but 2048 UTF-8 bytes.
    const astral = "\u{1D400}".repeat(512);

    expect(engine.validate({ kind: "test", value: astral }).format.reasonCode).toBe(
      "input_too_long",
    );
    // 1024 ASCII characters sit exactly on the bound and are processed.
    expect(engine.validate({ kind: "test", value: "1".repeat(1024) }).format.status).toBe("valid");
  });
});

describe("invalid encoding", () => {
  const engine = BusinessIdEngine.fromRules(singleKindBundle({ format: digitsFormat() }));

  it("refuses a lone surrogate, reporting the value verbatim", () => {
    // A lone surrogate has no UTF-8 encoding, so it carries no code point
    // sequence to evaluate.
    const report = engine.canonicalize({ kind: "test", value: "12\uD83D" });

    expect(report).toMatchObject({ status: "unsupported", reasonCode: "invalid_encoding" });
    expect(report.canonicalValue).toBe("12\uD83D");
  });
});

describe("kind resolution", () => {
  const engine = BusinessIdEngine.fromRules(singleKindBundle({ format: digitsFormat() }));

  it("normalizes the token by trim and lower casing", () => {
    expect(engine.validate({ kind: "  TEST \t", value: "1" }).kind).toBe("test");
  });

  it("reports unsupported_kind for a token no dispatcher claims", () => {
    const report = engine.validate({ kind: "unheard-of", value: "1" });

    expect(report.format).toMatchObject({ status: "unsupported", reasonCode: "unsupported_kind" });
    // No program ran, so the value is reported as it arrived.
    expect(report.canonicalValue).toBe("1");
    expect(report.kind).toBe("unheard-of");
  });
});

describe("country resolution", () => {
  function twoCountryEngine(): BusinessIdEngine {
    return BusinessIdEngine.fromRules(
      encode(
        bundle({
          programs: [
            program(1, ProgramKind.CANONICALIZATION, [canonicalizationSequence()]),
            program(2, ProgramKind.CANONICALIZATION, [canonicalizationSequence()]),
            program(3, ProgramKind.FORMAT, alwaysValidFormat()),
          ],
          definitions: [
            {
              id: 1,
              kind: "vat",
              countryCode: "BE",
              canonicalizationProgram: 2,
              formatProgram: 3,
              absentChecksumReason: ReasonCode.CHECKSUM_NOT_PUBLISHED,
              defaultProfile: "compatible",
              sources: [],
            },
            {
              id: 2,
              kind: "vat",
              countryCode: "FR",
              canonicalizationProgram: 2,
              formatProgram: 3,
              absentChecksumReason: ReasonCode.CHECKSUM_NOT_PUBLISHED,
              defaultProfile: "compatible",
              sources: [],
            },
          ],
          dispatchers: [
            {
              kind: "vat",
              kindAliases: ["vat_id"],
              preCanonicalizationProgram: 1,
              countryAliases: [{ alias: "UK", countryCode: "BE" }],
              targets: [
                {
                  countryCode: "BE",
                  acceptedPrefixes: ["BE"],
                  canonicalPrefix: "BE",
                  identifierDefinitionId: 1,
                  allowUnprefixedWithoutCountry: false,
                },
                {
                  countryCode: "FR",
                  acceptedPrefixes: ["FR"],
                  canonicalPrefix: "FR",
                  identifierDefinitionId: 2,
                  allowUnprefixedWithoutCountry: false,
                },
              ],
            },
          ],
        }),
      ),
    );
  }

  const engine = twoCountryEngine();

  it("resolves a kind alias to its canonical kind", () => {
    expect(engine.validate({ kind: "vat_id", value: "BE1" }).kind).toBe("vat");
  });

  it("applies a country alias", () => {
    expect(engine.validate({ kind: "vat", value: "1", countryCode: "uk" }).countryCode).toBe("BE");
  });

  it("reports unsupported_country for a malformed token", () => {
    expect(engine.validate({ kind: "vat", value: "1", countryCode: "XYZ" }).format).toMatchObject({
      status: "unsupported",
      reasonCode: "unsupported_country",
    });
  });

  it("reports unsupported_country for a country with no target", () => {
    expect(engine.validate({ kind: "vat", value: "1", countryCode: "DE" }).format).toMatchObject({
      status: "unsupported",
      reasonCode: "unsupported_country",
    });
  });

  it("treats an empty country token as an absent context", () => {
    const report = engine.validate({ kind: "vat", value: "BE1", countryCode: "  " });

    expect(report.format.status).toBe("valid");
    expect(report.countryCode).toBe("BE");
  });

  it("reports country_mismatch, the one dispatch failure that proves an invalidity", () => {
    const report = engine.validate({ kind: "vat", value: "FR1", countryCode: "BE" });

    expect(report.format).toMatchObject({ status: "invalid", reasonCode: "country_mismatch" });
    expect(report.checksum).toMatchObject({
      status: "not_run",
      reasonCode: "not_run_format_invalid",
    });
  });

  it("reports missing_country_code when nothing selects a target", () => {
    expect(engine.validate({ kind: "vat", value: "1" }).format).toMatchObject({
      status: "unsupported",
      reasonCode: "missing_country_code",
    });
  });

  it("selects the longest matching prefix", () => {
    expect(engine.validate({ kind: "vat", value: "FR123" }).countryCode).toBe("FR");
  });
});

describe("the pre-canonicalization phase", () => {
  it("runs before the country decision, so a stalled result still carries it", () => {
    // ir.md section 5 runs the pre-canonicalizer as soon as the dispatcher is
    // resolved. A result that stops on an unusable country therefore reports
    // the pre-canonical value rather than the raw one.
    const pre: NodeSpec[] = [
      node(ValueType.CANONICALIZATION_STEP, {
        case: "canonicalizationOperation",
        value: { kind: CanonicalizationOpKind.REMOVE_CHARS, text: ".-" },
      }),
      canonicalizationSequence([0]),
    ];
    const engine = BusinessIdEngine.fromRules(
      singleKindBundle({
        countryCode: "FR",
        preCanonicalization: pre,
        format: alwaysValidFormat(),
        allowUnprefixedWithoutCountry: false,
      }),
    );

    const report = engine.canonicalize({ kind: "test", value: "1.2-3", countryCode: "ZZ" });

    expect(report.reasonCode).toBe("unsupported_country");
    expect(report.canonicalValue).toBe("123");
  });
});

describe("a GLOBAL target", () => {
  const engine = BusinessIdEngine.fromRules(
    singleKindBundle({ countryCode: undefined, format: alwaysValidFormat() }),
  );

  it("keeps a well formed country context without routing on it", () => {
    const report = engine.validate({ kind: "test", value: "1", countryCode: "fr" });

    expect(report.format.status).toBe("valid");
    expect(report.countryCode).toBe("FR");
  });

  it("reports no country when the caller gave none", () => {
    expect(engine.validate({ kind: "test", value: "1" }).countryCode).toBeUndefined();
  });
});

describe("the format and checksum steps", () => {
  it("stops the checksum after an invalid format", () => {
    const engine = BusinessIdEngine.fromRules(singleKindBundle({ format: digitsFormat() }));
    const report = engine.validate({ kind: "test", value: "12X" });

    expect(report.format).toMatchObject({
      status: "invalid",
      reasonCode: "invalid_characters",
      messageKey: "test.characters",
    });
    expect(report.checksum).toMatchObject({
      status: "not_run",
      reasonCode: "not_run_format_invalid",
    });
  });

  it("reports the declared absence reason when no checksum program exists", () => {
    const engine = BusinessIdEngine.fromRules(
      singleKindBundle({
        format: digitsFormat(),
        absentChecksumReason: ReasonCode.CHECKSUM_NOT_PUBLISHED,
      }),
    );

    expect(engine.validate({ kind: "test", value: "12" }).checksum).toMatchObject({
      status: "unsupported",
      reasonCode: "checksum_not_published",
    });
  });

  it("validateFormat reports not_requested and never runs the checksum", () => {
    const engine = BusinessIdEngine.fromRules(singleKindBundle({ format: digitsFormat() }));

    expect(engine.validateFormat({ kind: "test", value: "12" }).checksum).toMatchObject({
      status: "not_run",
      reasonCode: "not_requested",
    });
  });

  it("validateChecksum returns exactly the report validate returns", () => {
    const engine = BusinessIdEngine.fromRules(singleKindBundle({ format: digitsFormat() }));
    const input = { kind: "test", value: "12X" };

    expect(engine.validateChecksum(input)).toEqual(engine.validate(input));
  });

  it("validateFormat reports a dispatch failure exactly as validate does", () => {
    const engine = BusinessIdEngine.fromRules(singleKindBundle({ format: digitsFormat() }));
    const input = { kind: "nope", value: "12" };

    expect(engine.validateFormat(input)).toEqual(engine.validate(input));
  });
});

describe("the effective profile", () => {
  it("lets the definition default apply only when the caller states none", () => {
    // ir.md section 5.2: absence is meaningful, and is not the same request as
    // an explicit `compatible`.
    const engine = BusinessIdEngine.fromRules(
      singleKindBundle({ defaultProfile: "strict_current", format: alwaysValidFormat() }),
    );

    expect(engine.canonicalize({ kind: "test", value: "1" }).profile).toBe("strict_current");
    expect(
      engine.canonicalize({ kind: "test", value: "1" }, { profile: "compatible" }).profile,
    ).toBe("compatible");
  });

  it("reports the dispatch profile when no definition was selected", () => {
    const engine = BusinessIdEngine.fromRules(
      singleKindBundle({ defaultProfile: "strict_current", format: alwaysValidFormat() }),
    );

    expect(engine.canonicalize({ kind: "nope", value: "1" }).profile).toBe("compatible");
  });
});

describe("canonicalize", () => {
  it("reports valid and ok when a definition was selected", () => {
    const engine = BusinessIdEngine.fromRules(singleKindBundle({ format: digitsFormat() }));

    // The format rule is never run: canonicalize stops after dispatch.
    expect(engine.canonicalize({ kind: "test", value: "12X" })).toMatchObject({
      status: "valid",
      reasonCode: "ok",
      canonicalValue: "12X",
    });
  });

  it("reports invalid only for country_mismatch", () => {
    const engine = BusinessIdEngine.fromRules(
      singleKindBundle({
        countryCode: "FR",
        acceptedPrefixes: ["FR"],
        format: alwaysValidFormat(),
        allowUnprefixedWithoutCountry: false,
      }),
    );

    expect(engine.canonicalize({ kind: "test", value: "1", countryCode: "BE" }).status).toBe(
      "unsupported",
    );
  });
});
