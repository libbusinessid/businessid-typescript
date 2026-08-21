import { describe, expect, it } from "vitest";
import { BundleError } from "../../src/domain/errors.js";
import {
  CallOpKind,
  CanonicalizationOpKind,
  ChecksumOpKind,
  CharMapping,
  IntegerOpKind,
  PredicateOpKind,
  ProgramKind,
  ReasonCode,
  SourceTier,
  StringOpKind,
  ValueType,
  WeightAlignment,
} from "../../src/generated/libbusinessid/ir/v1/rules_pb.js";
import { loadBundle } from "../../src/runtime/load.js";
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
  subjectNode,
  valueNode,
} from "../helpers/bundle.js";
import { bytes as wireBytes, fieldMessage, fieldString, fieldVarint } from "../helpers/wire.js";

/**
 * The load time checks the shared corpus does not reach.
 *
 * `engine.md` section 11.3 requires engine specific tests of the decoder and
 * the bundle validator on top of the shared run. Each case here names the check
 * of `ir.md` section 10 it exercises, and asserts that check by number: a
 * bundle refused for the right reason but by the wrong check would mean the
 * order — which carries meaning — has drifted.
 */
function refusal(payload: Uint8Array): { reason: string; check: number; message: string } {
  try {
    loadBundle(payload);
  } catch (error) {
    if (error instanceof BundleError) {
      return { reason: error.reason, check: error.check, message: error.message };
    }
    throw error;
  }
  throw new Error("the bundle was accepted");
}

const expectRefusal = (payload: Uint8Array, check: number, reason = "invalid_ruleset"): void => {
  expect(refusal(payload)).toMatchObject({ check, reason });
};

describe("check 1: binary size", () => {
  it("refuses a bundle above 16 MiB without decoding it", () => {
    expectRefusal(new Uint8Array(16 * 1024 * 1024 + 1), 1);
  });
});

describe("check 3 and 4: versions and capabilities", () => {
  it("reports an unsupported format version as a version gap", () => {
    const payload = wireBytes([fieldVarint(1, 2), fieldString(2, "2026.08.14")]);

    expectRefusal(payload, 3, "incompatible_ruleset");
  });

  it("reports an unknown capability as a version gap", () => {
    const payload = wireBytes([
      fieldVarint(1, 1),
      fieldString(2, "2026.08.14"),
      fieldVarint(3, 999),
    ]);

    expectRefusal(payload, 4, "incompatible_ruleset");
  });

  it("refuses a capability list that is not strictly ascending", () => {
    const payload = wireBytes([
      fieldVarint(1, 1),
      fieldString(2, "2026.08.14"),
      fieldVarint(3, 5),
      fieldVarint(3, 1),
    ]);

    expectRefusal(payload, 4);
  });

  it("prefers the version gap when a bundle is both newer and misordered", () => {
    // Telling an operator to upgrade is the accurate answer; calling it forged
    // would send them looking for an attack that did not happen.
    const payload = wireBytes([
      fieldVarint(1, 1),
      fieldString(2, "2026.08.14"),
      fieldVarint(3, 5),
      fieldVarint(3, 999),
      fieldVarint(3, 1),
    ]);

    expectRefusal(payload, 4, "incompatible_ruleset");
  });
});

describe("check 5: unknown fields", () => {
  it("refuses an unknown field nested at any depth", () => {
    const payload = wireBytes([
      fieldVarint(1, 1),
      fieldString(2, "2026.08.14"),
      fieldMessage(7, [fieldVarint(1, 1), fieldVarint(99, 1)]),
    ]);

    expectRefusal(payload, 5);
  });

  it("still reports a version gap first on a newer bundle", () => {
    // A bundle built against a later version carries fields this runtime has
    // never heard of. Reporting those as unknown would call a legitimate
    // version gap a forgery.
    const payload = wireBytes([
      fieldVarint(1, 7),
      fieldString(2, "2026.08.14"),
      fieldVarint(99, 1),
    ]);

    expectRefusal(payload, 3, "incompatible_ruleset");
  });
});

describe("check 6 and 7: the header fields", () => {
  it("refuses a rules version longer than 64 bytes", () => {
    const payload = wireBytes([fieldVarint(1, 1), fieldString(2, "9".repeat(65))]);

    expectRefusal(payload, 6);
  });

  it("refuses a digest of the wrong length", () => {
    const payload = wireBytes([
      fieldVarint(1, 1),
      fieldString(2, "2026.08.14"),
      [...fieldString(4, "short")],
    ]);

    expectRefusal(payload, 7);
  });
});

describe("check 8: programs", () => {
  const withPrograms = (programs: ReturnType<typeof program>[]): Uint8Array =>
    encode(bundle({ programs, definitions: [], dispatchers: [] }));

  it("refuses program id zero", () => {
    expectRefusal(
      withPrograms([program(0, ProgramKind.CANONICALIZATION, [canonicalizationSequence()])]),
      8,
    );
  });

  it("refuses a duplicate program id", () => {
    expectRefusal(
      withPrograms([
        program(1, ProgramKind.CANONICALIZATION, [canonicalizationSequence()]),
        program(1, ProgramKind.CANONICALIZATION, [canonicalizationSequence()]),
      ]),
      8,
    );
  });

  it("refuses an unspecified program kind", () => {
    expectRefusal(
      withPrograms([program(1, ProgramKind.UNSPECIFIED, [canonicalizationSequence()])]),
      8,
    );
  });

  it("refuses programs that are not sorted by ascending id", () => {
    expectRefusal(
      withPrograms([
        program(2, ProgramKind.CANONICALIZATION, [canonicalizationSequence()]),
        program(1, ProgramKind.CANONICALIZATION, [canonicalizationSequence()]),
      ]),
      8,
    );
  });
});

describe("check 10 to 12: operations", () => {
  it("refuses an unknown operation kind as malformed, not as a version gap", () => {
    // A bundle legitimately using a newer operation declares the capability
    // that introduced it, so it would have stopped at check 4. Reaching here
    // means the operation was used without being declared.
    const payload = singleKindBundle({
      format: [
        valueNode(),
        node(
          ValueType.BOOLEAN,
          { case: "predicateOperation", value: { kind: 999 as PredicateOpKind } },
          [0],
        ),
        requireNode(1),
        assertionSequence([2]),
      ],
    });

    expectRefusal(payload, 10);
  });

  it("refuses a node whose declared output type contradicts its operation", () => {
    const payload = singleKindBundle({
      format: [
        node(ValueType.INTEGER, {
          case: "stringOperation",
          value: { kind: StringOpKind.VALUE },
        }),
        assertionSequence([]),
      ],
    });

    expectRefusal(payload, 10);
  });

  it("refuses the wrong number of operands", () => {
    const payload = singleKindBundle({
      format: [
        valueNode(),
        valueNode(),
        node(
          ValueType.BOOLEAN,
          { case: "predicateOperation", value: { kind: PredicateOpKind.IS_EMPTY } },
          [0, 1],
        ),
        requireNode(2),
        assertionSequence([3]),
      ],
    });

    expectRefusal(payload, 11);
  });

  it("refuses a repeated tail outside its bounds", () => {
    const payload = singleKindBundle({
      format: [
        node(ValueType.BOOLEAN, {
          case: "predicateOperation",
          value: { kind: PredicateOpKind.ALL },
        }),
        requireNode(0),
        assertionSequence([1]),
      ],
    });

    expectRefusal(payload, 11);
  });

  it("refuses a required parameter the operation omits", () => {
    const payload = singleKindBundle({
      format: [
        valueNode(),
        node(
          ValueType.BOOLEAN,
          { case: "predicateOperation", value: { kind: PredicateOpKind.LENGTH_EQ } },
          [0],
        ),
        requireNode(1),
        assertionSequence([2]),
      ],
    });

    expectRefusal(payload, 12);
  });
});

describe("check 13: bounds", () => {
  const checksumWith = (nodes: NodeSpec[]): Uint8Array =>
    singleKindBundle({ format: alwaysValidFormat(), checksum: nodes });

  it("refuses a slice bound above 4096", () => {
    expectRefusal(
      singleKindBundle({
        format: [
          valueNode(),
          node(
            ValueType.STRING,
            { case: "stringOperation", value: { kind: StringOpKind.SLICE_FROM, start: 5000 } },
            [0],
          ),
          node(
            ValueType.BOOLEAN,
            { case: "predicateOperation", value: { kind: PredicateOpKind.IS_ABSENT } },
            [1],
          ),
          requireNode(2),
          assertionSequence([3]),
        ],
      }),
      13,
    );
  });

  it("refuses a constant longer than 4096 UTF-8 bytes", () => {
    expectRefusal(
      singleKindBundle({
        format: [
          node(ValueType.STRING, {
            case: "stringOperation",
            value: { kind: StringOpKind.CONSTANT, text: "A".repeat(4097) },
          }),
          node(
            ValueType.BOOLEAN,
            { case: "predicateOperation", value: { kind: PredicateOpKind.IS_ABSENT } },
            [0],
          ),
          requireNode(1),
          assertionSequence([2]),
        ],
      }),
      13,
    );
  });

  it("refuses more than 256 weights", () => {
    expectRefusal(
      checksumWith([
        subjectNode(),
        node(
          ValueType.INTEGER,
          {
            case: "integerOperation",
            value: {
              kind: IntegerOpKind.WEIGHTED_SUM,
              weights: new Array<bigint>(257).fill(1n),
              alignment: WeightAlignment.LEFT,
              mapping: CharMapping.DIGIT_VALUE,
            },
          },
          [0],
        ),
        node(
          ValueType.CHECKSUM_OUTCOME,
          {
            case: "checksumOperation",
            value: { kind: ChecksumOpKind.COMPARE_CONSTANT, constant: 0n },
          },
          [1],
        ),
      ]),
      13,
    );
  });

  it("refuses a weight beyond a million", () => {
    expectRefusal(
      checksumWith([
        subjectNode(),
        node(
          ValueType.INTEGER,
          {
            case: "integerOperation",
            value: {
              kind: IntegerOpKind.WEIGHTED_SUM,
              weights: [1_000_001n],
              alignment: WeightAlignment.LEFT,
              mapping: CharMapping.DIGIT_VALUE,
            },
          },
          [0],
        ),
        node(
          ValueType.CHECKSUM_OUTCOME,
          {
            case: "checksumOperation",
            value: { kind: ChecksumOpKind.COMPARE_CONSTANT, constant: 0n },
          },
          [1],
        ),
      ]),
      13,
    );
  });

  it("refuses an unspecified alignment or mapping", () => {
    const build = (value: Record<string, unknown>): Uint8Array =>
      checksumWith([
        subjectNode(),
        node(
          ValueType.INTEGER,
          {
            case: "integerOperation",
            value: { kind: IntegerOpKind.WEIGHTED_SUM, weights: [1n], ...value },
          },
          [0],
        ),
        node(
          ValueType.CHECKSUM_OUTCOME,
          {
            case: "checksumOperation",
            value: { kind: ChecksumOpKind.COMPARE_CONSTANT, constant: 0n },
          },
          [1],
        ),
      ]);

    expectRefusal(
      build({ alignment: WeightAlignment.UNSPECIFIED, mapping: CharMapping.DIGIT_VALUE }),
      13,
    );
    expectRefusal(build({ alignment: WeightAlignment.LEFT, mapping: CharMapping.UNSPECIFIED }), 13);
    expectRefusal(build({ alignment: 99, mapping: CharMapping.DIGIT_VALUE }), 13);
    expectRefusal(build({ alignment: WeightAlignment.LEFT, mapping: 99 }), 13);
  });
});

describe("check 14: anchors and captures", () => {
  it("refuses a program with no node", () => {
    expectRefusal(
      encode(
        bundle({
          programs: [program(1, ProgramKind.CANONICALIZATION, [], 0)],
          definitions: [],
          dispatchers: [],
        }),
      ),
      14,
    );
  });

  it("refuses a subject declared by a canonicalization program", () => {
    expectRefusal(
      encode(
        bundle({
          programs: [
            program(1, ProgramKind.CANONICALIZATION, [valueNode(), canonicalizationSequence()], 1, {
              subjectNode: 0,
            }),
          ],
          definitions: [],
          dispatchers: [],
        }),
      ),
      14,
    );
  });

  it("refuses a capture that does not name a string node", () => {
    expectRefusal(
      encode(
        bundle({
          programs: [
            program(1, ProgramKind.FORMAT, alwaysValidFormat(), 4, {
              captures: [{ name: "registration", node: 1 }],
            }),
          ],
          definitions: [],
          dispatchers: [],
        }),
      ),
      14,
    );
  });

  it("refuses captures on a program that is not a format program", () => {
    expectRefusal(
      encode(
        bundle({
          programs: [
            program(1, ProgramKind.CANONICALIZATION, [canonicalizationSequence()], 0, {
              captures: [{ name: "x", node: 0 }],
            }),
          ],
          definitions: [],
          dispatchers: [],
        }),
      ),
      14,
    );
  });
});

describe("check 15: program shape", () => {
  it("refuses an operation family foreign to the program kind", () => {
    // Everything else about this program is well formed: only the integer
    // node, which belongs to checksum programs alone, is out of place.
    expectRefusal(
      singleKindBundle({
        format: [
          valueNode(),
          node(
            ValueType.INTEGER,
            { case: "integerOperation", value: { kind: IntegerOpKind.MOD_DIGITS, modulus: 7n } },
            [0],
          ),
          node(
            ValueType.BOOLEAN,
            { case: "predicateOperation", value: { kind: PredicateOpKind.IS_ABSENT } },
            [0],
          ),
          requireNode(2),
          assertionSequence([3]),
        ],
      }),
      15,
    );
  });

  it("refuses subject() inside a canonicalization program", () => {
    expectRefusal(
      singleKindBundle({
        canonicalization: [subjectNode(), canonicalizationSequence()],
        format: alwaysValidFormat(),
      }),
      15,
    );
  });

  it("refuses a pre-canonicalization step that could interpret a prefix", () => {
    // A pre-canonicalizer routes; it can never add, replace or interpret a
    // prefix, or the dispatch it feeds would depend on the value it rewrote.
    expectRefusal(
      singleKindBundle({
        preCanonicalization: [
          node(ValueType.CANONICALIZATION_STEP, {
            case: "canonicalizationOperation",
            value: { kind: CanonicalizationOpKind.PREPEND, text: "FR" },
          }),
          canonicalizationSequence([0]),
        ],
        format: alwaysValidFormat(),
      }),
      15,
    );
  });

  it("refuses prepending a country in a canonicalizer of a GLOBAL definition", () => {
    // A GLOBAL target has no country and no prefix, so there is nothing to add.
    expectRefusal(
      singleKindBundle({
        countryCode: undefined,
        canonicalization: [
          node(ValueType.CANONICALIZATION_STEP, {
            case: "canonicalizationOperation",
            value: { kind: CanonicalizationOpKind.PREPEND_COUNTRY_IF_MISSING },
          }),
          canonicalizationSequence([0]),
        ],
        format: alwaysValidFormat(),
      }),
      15,
    );
  });

  it("refuses a format program that does not root at an assertion sequence", () => {
    expectRefusal(
      singleKindBundle({
        format: [
          valueNode(),
          node(
            ValueType.BOOLEAN,
            { case: "predicateOperation", value: { kind: PredicateOpKind.IS_ABSENT } },
            [0],
          ),
          requireNode(1),
        ],
      }),
      15,
    );
  });

  it("refuses a checksum program rooting at a WHEN branch", () => {
    expectRefusal(
      singleKindBundle({
        format: alwaysValidFormat(),
        checksum: [
          subjectNode(),
          node(
            ValueType.BOOLEAN,
            { case: "predicateOperation", value: { kind: PredicateOpKind.IS_ABSENT } },
            [0],
          ),
          node(ValueType.CHECKSUM_OUTCOME, {
            case: "checksumOperation",
            value: {
              kind: ChecksumOpKind.UNSUPPORTED,
              reasonCode: ReasonCode.UNSUPPORTED_CHECKSUM,
            },
          }),
          node(
            ValueType.CHECKSUM_OUTCOME,
            { case: "checksumOperation", value: { kind: ChecksumOpKind.WHEN } },
            [1, 2],
          ),
        ],
      }),
      15,
    );
  });

  it("refuses a call towards a program of another kind", () => {
    expectRefusal(
      singleKindBundle({
        format: [
          valueNode(),
          node(
            ValueType.CHECKSUM_OUTCOME,
            { case: "callOperation", value: { kind: CallOpKind.CHECKSUM, programId: 3 } },
            [0],
          ),
          node(
            ValueType.BOOLEAN,
            { case: "predicateOperation", value: { kind: PredicateOpKind.IS_ABSENT } },
            [0],
          ),
          requireNode(2),
          assertionSequence([3]),
        ],
      }),
      15,
    );
  });
});

describe("check 16 and 17: definitions", () => {
  const withDefinition = (
    definition: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ): Uint8Array =>
    encode(
      bundle({
        programs: [
          program(1, ProgramKind.CANONICALIZATION, [canonicalizationSequence()]),
          program(2, ProgramKind.FORMAT, alwaysValidFormat()),
          program(3, ProgramKind.CHECKSUM, [
            node(ValueType.CHECKSUM_OUTCOME, {
              case: "checksumOperation",
              value: {
                kind: ChecksumOpKind.UNSUPPORTED,
                reasonCode: ReasonCode.UNSUPPORTED_CHECKSUM,
              },
            }),
          ]),
        ],
        definitions: [
          {
            id: 1,
            kind: "test",
            countryCode: "FR",
            canonicalizationProgram: 1,
            formatProgram: 2,
            absentChecksumReason: ReasonCode.UNSUPPORTED_CHECKSUM,
            defaultProfile: "compatible",
            sources: [],
            ...definition,
          },
        ],
        dispatchers: [
          {
            kind: "test",
            kindAliases: [],
            preCanonicalizationProgram: 1,
            countryAliases: [],
            targets: [
              {
                countryCode: "FR",
                acceptedPrefixes: [],
                identifierDefinitionId: 1,
                allowUnprefixedWithoutCountry: true,
              },
            ],
            ...extra,
          },
        ],
      }),
    );

  it("refuses definition id zero", () => {
    expectRefusal(withDefinition({ id: 0 }), 16);
  });

  it("refuses a malformed kind or country", () => {
    expectRefusal(withDefinition({ kind: "Test" }), 16);
    expectRefusal(withDefinition({ countryCode: "fr" }), 16);
    // The empty string and the literal GLOBAL are invalid: absence carries the
    // meaning on its own.
    expectRefusal(withDefinition({ countryCode: "" }), 16);
    expectRefusal(withDefinition({ countryCode: "GLOBAL" }), 16);
  });

  it("refuses an unknown profile", () => {
    expectRefusal(withDefinition({ defaultProfile: "lenient" }), 16);
  });

  it("refuses a reference to a missing or mistyped program", () => {
    expectRefusal(withDefinition({ formatProgram: 99 }), 16);
    expectRefusal(withDefinition({ formatProgram: 1 }), 16);
  });

  it("refuses sources without an id or out of order", () => {
    expectRefusal(withDefinition({ sources: [{ id: "" }] }), 16);
    expectRefusal(withDefinition({ sources: [{ id: "b" }, { id: "a" }] }), 16);
  });

  it("refuses a source tier outside the enumeration", () => {
    expectRefusal(withDefinition({ sources: [{ id: "a", tier: 99 as SourceTier }] }), 16);
  });

  it("accepts an unspecified tier, which states no tier at all", () => {
    // `tier` is not optional in the schema, so an omitted field and an explicit
    // UNSPECIFIED are the same bytes. Refusing it would make capability 41
    // mandatory the moment 40 is.
    expect(() =>
      loadBundle(withDefinition({ sources: [{ id: "a", tier: SourceTier.UNSPECIFIED }] })),
    ).not.toThrow();
  });

  it("refuses a definition declaring both a checksum program and an absence reason", () => {
    expectRefusal(
      withDefinition({ checksumProgram: 3, absentChecksumReason: ReasonCode.UNSUPPORTED_CHECKSUM }),
      17,
    );
  });

  it("refuses a definition declaring neither", () => {
    expectRefusal(withDefinition({ absentChecksumReason: undefined }), 17);
  });

  it("refuses an absence reason that cannot report a missing checksum", () => {
    expectRefusal(withDefinition({ absentChecksumReason: ReasonCode.INVALID_CHECKSUM }), 17);
  });

  it("refuses definitions that are not in the normative order", () => {
    const twoPrograms = [
      program(1, ProgramKind.CANONICALIZATION, [canonicalizationSequence()]),
      program(2, ProgramKind.FORMAT, alwaysValidFormat()),
    ];
    const definition = (id: number, countryCode: string | undefined): Record<string, unknown> => ({
      id,
      kind: "test",
      ...(countryCode === undefined ? {} : { countryCode }),
      canonicalizationProgram: 1,
      formatProgram: 2,
      absentChecksumReason: ReasonCode.UNSUPPORTED_CHECKSUM,
      defaultProfile: "compatible",
      sources: [],
    });

    expectRefusal(
      encode(
        bundle({
          programs: twoPrograms,
          definitions: [definition(1, "FR"), definition(2, "BE")],
          dispatchers: [],
        }),
      ),
      16,
    );
    // GLOBAL sorts before every country.
    expectRefusal(
      encode(
        bundle({
          programs: twoPrograms,
          definitions: [definition(1, "BE"), definition(2, undefined)],
          dispatchers: [],
        }),
      ),
      16,
    );
  });
});

describe("check 18 to 22: dispatchers", () => {
  const twoPrograms = [
    program(1, ProgramKind.CANONICALIZATION, [canonicalizationSequence()]),
    program(2, ProgramKind.FORMAT, alwaysValidFormat()),
  ];
  const definition = (
    id: number,
    countryCode: string | undefined,
    kind = "test",
  ): Record<string, unknown> => ({
    id,
    kind,
    ...(countryCode === undefined ? {} : { countryCode }),
    canonicalizationProgram: 1,
    formatProgram: 2,
    absentChecksumReason: ReasonCode.UNSUPPORTED_CHECKSUM,
    defaultProfile: "compatible",
    sources: [],
  });
  const target = (options: Record<string, unknown>): Record<string, unknown> => ({
    acceptedPrefixes: [],
    identifierDefinitionId: 1,
    allowUnprefixedWithoutCountry: false,
    ...options,
  });
  const dispatcher = (options: Record<string, unknown>): Record<string, unknown> => ({
    kind: "test",
    kindAliases: [],
    preCanonicalizationProgram: 1,
    countryAliases: [],
    targets: [target({ countryCode: "FR" })],
    ...options,
  });
  const withDispatchers = (
    dispatchers: Record<string, unknown>[],
    definitions = [definition(1, "FR")],
  ): Uint8Array => encode(bundle({ programs: twoPrograms, definitions, dispatchers }));

  it("refuses a malformed kind or an unsorted kind alias", () => {
    expectRefusal(withDispatchers([dispatcher({ kind: "Test" })]), 18);
    expectRefusal(withDispatchers([dispatcher({ kindAliases: ["b", "a"] })]), 18);
  });

  it("refuses a kind alias colliding with another kind", () => {
    // Kinds and aliases share one space, so a collision is an ambiguity no
    // ordering could resolve.
    expectRefusal(withDispatchers([dispatcher({ kindAliases: ["test"] })]), 18);
  });

  it("refuses dispatchers that are not sorted", () => {
    expectRefusal(
      withDispatchers(
        [
          dispatcher({ kind: "zeta", targets: [target({ countryCode: "FR" })] }),
          dispatcher({
            kind: "alpha",
            targets: [target({ countryCode: "FR", identifierDefinitionId: 2 })],
          }),
        ],
        [definition(1, "FR", "alpha"), definition(2, "FR", "zeta")],
      ),
      18,
    );
  });

  it("refuses an unusable pre-canonicalization program", () => {
    expectRefusal(withDispatchers([dispatcher({ preCanonicalizationProgram: 2 })]), 18);
  });

  it("refuses a country alias that is malformed, self mapping or shadowing", () => {
    expectRefusal(
      withDispatchers([dispatcher({ countryAliases: [{ alias: "xx", countryCode: "FR" }] })]),
      19,
    );
    expectRefusal(
      withDispatchers([dispatcher({ countryAliases: [{ alias: "BE", countryCode: "BE" }] })]),
      19,
    );
    expectRefusal(
      withDispatchers([dispatcher({ countryAliases: [{ alias: "FR", countryCode: "BE" }] })]),
      19,
    );
    expectRefusal(
      withDispatchers([
        dispatcher({
          countryAliases: [
            { alias: "ZZ", countryCode: "FR" },
            { alias: "AA", countryCode: "FR" },
          ],
        }),
      ]),
      19,
    );
  });

  it("refuses a dispatcher without targets", () => {
    expectRefusal(withDispatchers([dispatcher({ targets: [] })]), 20);
  });

  it("refuses targets that are not sorted or repeat a country", () => {
    const two = [definition(1, "BE"), definition(2, "FR")];
    expectRefusal(
      withDispatchers(
        [
          dispatcher({
            targets: [
              target({ countryCode: "FR", identifierDefinitionId: 2 }),
              target({ countryCode: "BE", identifierDefinitionId: 1 }),
            ],
          }),
        ],
        two,
      ),
      20,
    );
  });

  it("refuses a malformed prefix or unsorted prefixes", () => {
    expectRefusal(
      withDispatchers([
        dispatcher({ targets: [target({ countryCode: "FR", acceptedPrefixes: ["F-R"] })] }),
      ]),
      20,
    );
    expectRefusal(
      withDispatchers([
        dispatcher({ targets: [target({ countryCode: "FR", acceptedPrefixes: ["FR", "AB"] })] }),
      ]),
      20,
    );
  });

  it("refuses a canonical prefix the target does not accept", () => {
    expectRefusal(
      withDispatchers([
        dispatcher({
          targets: [target({ countryCode: "FR", acceptedPrefixes: ["FR"], canonicalPrefix: "BE" })],
        }),
      ]),
      20,
    );
  });

  it("refuses two targets selectable without country or prefix", () => {
    expectRefusal(
      withDispatchers(
        [
          dispatcher({
            targets: [
              target({
                countryCode: "BE",
                identifierDefinitionId: 1,
                allowUnprefixedWithoutCountry: true,
              }),
              target({
                countryCode: "FR",
                identifierDefinitionId: 2,
                allowUnprefixedWithoutCountry: true,
              }),
            ],
          }),
        ],
        [definition(1, "BE"), definition(2, "FR")],
      ),
      20,
    );
  });

  it("refuses a GLOBAL target that is not alone", () => {
    expectRefusal(
      withDispatchers(
        [
          dispatcher({
            targets: [
              target({ identifierDefinitionId: 1 }),
              target({ countryCode: "FR", identifierDefinitionId: 2 }),
            ],
          }),
        ],
        [definition(1, undefined), definition(2, "FR")],
      ),
      21,
    );
  });

  it("refuses country aliases alongside a GLOBAL target", () => {
    expectRefusal(
      withDispatchers(
        [
          dispatcher({
            countryAliases: [{ alias: "UK", countryCode: "GB" }],
            targets: [target({ identifierDefinitionId: 1 })],
          }),
        ],
        [definition(1, undefined)],
      ),
      21,
    );
  });

  it("refuses a target whose definition disagrees on kind or country", () => {
    expectRefusal(withDispatchers([dispatcher({ targets: [target({ countryCode: "BE" })] })]), 22);
    expectRefusal(withDispatchers([dispatcher({ targets: [target({})] })]), 22);
  });

  it("refuses an unknown definition reference", () => {
    expectRefusal(
      withDispatchers([
        dispatcher({ targets: [target({ countryCode: "FR", identifierDefinitionId: 9 })] }),
      ]),
      22,
    );
  });

  it("refuses a definition claimed by two targets", () => {
    expectRefusal(
      withDispatchers(
        [
          dispatcher({
            kind: "alpha",
            targets: [target({ countryCode: "FR", identifierDefinitionId: 1 })],
          }),
          dispatcher({
            kind: "beta",
            targets: [target({ countryCode: "FR", identifierDefinitionId: 1 })],
          }),
        ],
        [definition(1, "FR", "alpha")],
      ),
      22,
    );
  });
});

describe("check 24: declared capabilities", () => {
  it("requires the custom alphabet capability from the variant, not the operation", () => {
    // A weighted sum over digits must not oblige an engine to implement an
    // alphabet it never reads, so the capability belongs to the mapping.
    const withMapping = (mapping: CharMapping, capabilities: number[]): Uint8Array =>
      singleKindBundle({
        capabilities,
        format: alwaysValidFormat(),
        checksum: [
          subjectNode(),
          node(
            ValueType.INTEGER,
            {
              case: "integerOperation",
              value: {
                kind: IntegerOpKind.WEIGHTED_SUM,
                weights: [1n],
                alignment: WeightAlignment.LEFT,
                mapping,
                ...(mapping === CharMapping.CUSTOM_ALPHABET ? { alphabet: "0123456789" } : {}),
              },
            },
            [0],
          ),
          node(
            ValueType.CHECKSUM_OUTCOME,
            {
              case: "checksumOperation",
              value: { kind: ChecksumOpKind.COMPARE_CONSTANT, constant: 0n },
            },
            [1],
          ),
        ],
      });

    // Everything these bundles use, minus the custom alphabet capability.
    const withoutAlphabet = [1, 3, 5, 10, 20, 21, 30, 33, 34];
    expect(() => loadBundle(withMapping(CharMapping.DIGIT_VALUE, withoutAlphabet))).not.toThrow();
    expectRefusal(withMapping(CharMapping.CUSTOM_ALPHABET, withoutAlphabet), 24);
  });

  it("requires the provenance capability from the presence of sources", () => {
    const payload = encode(
      bundle({
        capabilities: [1, 3, 5, 10, 20, 21, 30],
        programs: [
          program(1, ProgramKind.CANONICALIZATION, [canonicalizationSequence()]),
          program(2, ProgramKind.FORMAT, alwaysValidFormat()),
        ],
        definitions: [
          {
            id: 1,
            kind: "test",
            countryCode: "FR",
            canonicalizationProgram: 1,
            formatProgram: 2,
            absentChecksumReason: ReasonCode.UNSUPPORTED_CHECKSUM,
            defaultProfile: "compatible",
            sources: [{ id: "a" }],
          },
        ],
        dispatchers: [
          {
            kind: "test",
            kindAliases: [],
            preCanonicalizationProgram: 1,
            countryAliases: [],
            targets: [
              {
                countryCode: "FR",
                acceptedPrefixes: [],
                identifierDefinitionId: 1,
                allowUnprefixedWithoutCountry: true,
              },
            ],
          },
        ],
      }),
    );

    expectRefusal(payload, 24);
  });

  it("requires the tier capability only from a stated tier", () => {
    const withTier = (tier: SourceTier, capabilities: number[]): Uint8Array =>
      encode(
        bundle({
          capabilities,
          programs: [
            program(1, ProgramKind.CANONICALIZATION, [canonicalizationSequence()]),
            program(2, ProgramKind.FORMAT, alwaysValidFormat()),
          ],
          definitions: [
            {
              id: 1,
              kind: "test",
              countryCode: "FR",
              canonicalizationProgram: 1,
              formatProgram: 2,
              absentChecksumReason: ReasonCode.UNSUPPORTED_CHECKSUM,
              defaultProfile: "compatible",
              sources: [{ id: "a", tier }],
            },
          ],
          dispatchers: [
            {
              kind: "test",
              kindAliases: [],
              preCanonicalizationProgram: 1,
              countryAliases: [],
              targets: [
                {
                  countryCode: "FR",
                  acceptedPrefixes: [],
                  identifierDefinitionId: 1,
                  allowUnprefixedWithoutCountry: true,
                },
              ],
            },
          ],
        }),
      );

    const withoutTier = [1, 3, 5, 10, 20, 21, 30, 40];
    expect(() => loadBundle(withTier(SourceTier.UNSPECIFIED, withoutTier))).not.toThrow();
    expectRefusal(withTier(SourceTier.PRIMARY, withoutTier), 24);
  });
});
