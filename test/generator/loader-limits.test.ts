import { describe, expect, it } from "vitest";
import { BundleError } from "../../tools/generator/errors.js";
import {
  CallOpKind,
  CanonicalizationOpKind,
  ChecksumOpKind,
  IntegerOpKind,
  PredicateOpKind,
  ProgramKind,
  ReasonCode,
  StringOpKind,
  ValueType,
} from "../../generated/libbusinessid/ir/v1/rules_pb.js";
import { loadBundle } from "../../tools/generator/load.js";
import {
  alwaysValidFormat,
  assertionSequence,
  bundle,
  canonicalizationSequence,
  constantNode,
  encode,
  node,
  type NodeSpec,
  program,
  requireNode,
  singleKindBundle,
  subjectNode,
  valueNode,
} from "../helpers/bundle.js";

/**
 * The structural limits and the anchors of a program.
 *
 * The limits of `ir.md` section 8 are normative and part of the security
 * surface: they are what bounds the work and the memory a bundle can ask an
 * engine for. An engine may raise one internally, never lower it.
 */
function refusal(payload: Uint8Array): { reason: string; check: number } {
  try {
    loadBundle(payload);
  } catch (error) {
    if (error instanceof BundleError) {
      return { reason: error.reason, check: error.check };
    }
    throw error;
  }
  throw new Error("the bundle was accepted");
}

const expectCheck = (payload: Uint8Array, check: number): void => {
  expect(refusal(payload)).toMatchObject({ check, reason: "invalid_ruleset" });
};

const onlyPrograms = (programs: ReturnType<typeof program>[]): Uint8Array =>
  encode(bundle({ programs, definitions: [], dispatchers: [] }));

describe("check 9: node counts", () => {
  it("refuses more than 4096 nodes in one program", () => {
    const nodes: NodeSpec[] = [];
    for (let index = 0; index < 4097; index += 1) {
      nodes.push(constantNode("x"));
    }
    nodes.push(canonicalizationSequence());

    expectCheck(onlyPrograms([program(1, ProgramKind.CANONICALIZATION, nodes)]), 9);
  });
});

describe("check 10 and 11: resolution and operands", () => {
  it("refuses a node carrying no operation kind", () => {
    // The oneof is present but the message inside carries no kind, which the
    // decoder reports as a zero and the table does not know.
    expectCheck(
      onlyPrograms([
        program(1, ProgramKind.CANONICALIZATION, [
          node(ValueType.CANONICALIZATION_STEP, {
            case: "canonicalizationOperation",
            value: { kind: CanonicalizationOpKind.UNSPECIFIED },
          }),
        ]),
      ]),
      10,
    );
  });

  it("refuses an operand of the wrong type in a repeated tail", () => {
    expectCheck(
      singleKindBundle({
        format: [
          valueNode(),
          node(
            ValueType.BOOLEAN,
            { case: "predicateOperation", value: { kind: PredicateOpKind.IS_ABSENT } },
            [0],
          ),
          requireNode(1),
          // A CONCAT tail expects strings; this passes an assertion.
          node(
            ValueType.STRING,
            { case: "stringOperation", value: { kind: StringOpKind.CONCAT } },
            [2],
          ),
          assertionSequence([2]),
        ],
      }),
      11,
    );
  });
});

describe("check 13: provable integer widths", () => {
  const digitsFrom = (build: NodeSpec[]): Uint8Array =>
    singleKindBundle({
      format: alwaysValidFormat(),
      checksum: [
        ...build,
        node(
          ValueType.INTEGER,
          { case: "integerOperation", value: { kind: IntegerOpKind.DIGITS_TO_INTEGER } },
          [build.length - 1],
        ),
        node(
          ValueType.CHECKSUM_OUTCOME,
          {
            case: "checksumOperation",
            value: { kind: ChecksumOpKind.COMPARE_CONSTANT, constant: 0n },
          },
          [build.length],
        ),
      ],
    });

  it("accepts a bound proven through a slice", () => {
    expect(() =>
      loadBundle(
        digitsFrom([
          subjectNode(),
          node(
            ValueType.STRING,
            { case: "stringOperation", value: { kind: StringOpKind.SLICE, start: 0, end: 9 } },
            [0],
          ),
        ]),
      ),
    ).not.toThrow();
  });

  it("accepts a bound proven through a constant, a country code or a concat", () => {
    expect(() => loadBundle(digitsFrom([constantNode("123456")]))).not.toThrow();
    expect(() =>
      loadBundle(
        digitsFrom([
          node(ValueType.STRING, {
            case: "stringOperation",
            value: { kind: StringOpKind.COUNTRY_CODE },
          }),
        ]),
      ),
    ).not.toThrow();
    expect(() =>
      loadBundle(
        digitsFrom([
          constantNode("12"),
          constantNode("34"),
          node(
            ValueType.STRING,
            { case: "stringOperation", value: { kind: StringOpKind.CONCAT } },
            [0, 1],
          ),
        ]),
      ),
    ).not.toThrow();
  });

  it("accepts a bound narrowed by slice_to and slice_from", () => {
    expect(() =>
      loadBundle(
        digitsFrom([
          constantNode("1234567890"),
          node(
            ValueType.STRING,
            { case: "stringOperation", value: { kind: StringOpKind.SLICE_TO, end: 4 } },
            [0],
          ),
          node(
            ValueType.STRING,
            { case: "stringOperation", value: { kind: StringOpKind.SLICE_FROM, start: 1 } },
            [1],
          ),
        ]),
      ),
    ).not.toThrow();
  });

  it("refuses a bound that only a prefix search would give", () => {
    // BEFORE_FIRST inherits the bound of its operand, and `subject()` has none.
    expectCheck(
      digitsFrom([
        subjectNode(),
        node(
          ValueType.STRING,
          { case: "stringOperation", value: { kind: StringOpKind.BEFORE_FIRST, text: "." } },
          [0],
        ),
      ]),
      13,
    );
  });

  it("refuses a concat where one part is unbounded", () => {
    expectCheck(
      digitsFrom([
        subjectNode(),
        constantNode("12"),
        node(
          ValueType.STRING,
          { case: "stringOperation", value: { kind: StringOpKind.CONCAT } },
          [0, 1],
        ),
      ]),
      13,
    );
  });

  it("refuses more than eighteen provable digits", () => {
    expectCheck(digitsFrom([constantNode("1".repeat(19))]), 13);
  });

  it("refuses a slice that proves no digit at all", () => {
    expectCheck(
      digitsFrom([
        subjectNode(),
        node(
          ValueType.STRING,
          { case: "stringOperation", value: { kind: StringOpKind.SLICE, start: 4, end: 2 } },
          [0],
        ),
      ]),
      13,
    );
  });
});

describe("check 15: anchors", () => {
  const formatProgram = (
    nodes: NodeSpec[],
    rootNode: number,
    extras: { subjectNode?: number; captures?: { name: string; node: number }[] } = {},
  ): Uint8Array => onlyPrograms([program(1, ProgramKind.FORMAT, nodes, rootNode, extras)]);

  it("refuses a root outside the program", () => {
    expectCheck(formatProgram(alwaysValidFormat(), 99), 15);
  });

  it("refuses a root of the wrong type", () => {
    expectCheck(formatProgram(alwaysValidFormat(), 0), 15);
  });

  it("refuses a subject outside the program or of the wrong type", () => {
    expectCheck(formatProgram(alwaysValidFormat(), 4, { subjectNode: 99 }), 15);
    expectCheck(formatProgram(alwaysValidFormat(), 4, { subjectNode: 1 }), 15);
  });

  it("accepts a subject naming a string node", () => {
    expect(() =>
      loadBundle(formatProgram(alwaysValidFormat(), 4, { subjectNode: 0 })),
    ).not.toThrow();
  });

  it("refuses an unnamed or repeated capture", () => {
    expectCheck(formatProgram(alwaysValidFormat(), 4, { captures: [{ name: "", node: 0 }] }), 15);
    expectCheck(
      formatProgram(alwaysValidFormat(), 4, {
        captures: [
          { name: "a", node: 0 },
          { name: "a", node: 0 },
        ],
      }),
      15,
    );
  });

  it("refuses a capture pointing outside the program", () => {
    expectCheck(formatProgram(alwaysValidFormat(), 4, { captures: [{ name: "a", node: 99 }] }), 15);
  });

  it("refuses more than 128 captures", () => {
    const captures = Array.from({ length: 129 }, (_unused, index) => ({
      name: `c${String(index)}`,
      node: 0,
    }));

    expectCheck(formatProgram(alwaysValidFormat(), 4, { captures }), 15);
  });

  it("accepts a capture naming a string node", () => {
    expect(() =>
      loadBundle(formatProgram(alwaysValidFormat(), 4, { captures: [{ name: "a", node: 0 }] })),
    ).not.toThrow();
  });
});

describe("check 16: roots per program kind", () => {
  it("refuses a canonicalization program that does not root at a sequence", () => {
    expectCheck(
      onlyPrograms([
        program(1, ProgramKind.CANONICALIZATION, [
          node(ValueType.CANONICALIZATION_STEP, {
            case: "canonicalizationOperation",
            value: { kind: CanonicalizationOpKind.TRIM_WHITESPACE },
          }),
        ]),
      ]),
      16,
    );
  });
});

describe("check 24: the call graph", () => {
  it("refuses a call chain deeper than 32", () => {
    // Each program calls the next, so the depth is the chain length. The bound
    // is what lets a generated engine drop the step budget entirely.
    const programs = [];
    for (let index = 1; index <= 34; index += 1) {
      const nodes: NodeSpec[] =
        index === 34
          ? [
              node(ValueType.CHECKSUM_OUTCOME, {
                case: "checksumOperation",
                value: {
                  kind: ChecksumOpKind.UNSUPPORTED,
                  reasonCode: ReasonCode.UNSUPPORTED_CHECKSUM,
                },
              }),
            ]
          : [
              subjectNode(),
              node(
                ValueType.CHECKSUM_OUTCOME,
                {
                  case: "callOperation",
                  value: { kind: CallOpKind.CHECKSUM, programId: index + 1 },
                },
                [0],
              ),
            ];
      programs.push(program(index, ProgramKind.CHECKSUM, nodes));
    }

    expectCheck(onlyPrograms(programs), 24);
  });
});

describe("check 15: a subject node that defines itself", () => {
  /**
   * `Program.subject_node` produces the subject of a top level invocation, so a
   * subtree that reads `subject()` asks for the value it is computing. A
   * generator emitting it recurses forever and an interpreter exhausts its
   * budget; nothing else sees it, because the node is checked for scope and
   * type and never walked.
   */
  function withSubject(subjectSubtree: NodeSpec[], subjectNode: number): Uint8Array {
    const format: NodeSpec[] = [...subjectSubtree, ...alwaysValidFormat()];
    // The rule itself reads nothing of the subject subtree.
    const offset = subjectSubtree.length;
    const shifted = format.map((entry, index) =>
      index < offset
        ? entry
        : { ...entry, inputs: entry.inputs?.map((input) => input + offset) ?? [] },
    );
    return encode(
      bundle({
        programs: [
          program(1, ProgramKind.CANONICALIZATION, [canonicalizationSequence()]),
          program(2, ProgramKind.FORMAT, shifted, shifted.length - 1, { subjectNode }),
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
  }

  it("refuses a subject node that reads the subject directly", () => {
    expectCheck(withSubject([subjectNode()], 0), 15);
  });

  it("refuses a subject node that reads it through a view", () => {
    expectCheck(
      withSubject(
        [
          subjectNode(),
          node(
            ValueType.STRING,
            { case: "stringOperation", value: { kind: StringOpKind.SLICE_FROM, start: 2 } },
            [0],
          ),
        ],
        1,
      ),
      15,
    );
  });

  it("accepts a subject node built from the canonical value", () => {
    // `value()` is the identifier under validation, which exists before the
    // subject does, so a subject built from it is not circular.
    expect(() =>
      loadBundle(
        withSubject(
          [
            valueNode(),
            node(
              ValueType.STRING,
              { case: "stringOperation", value: { kind: StringOpKind.SLICE_FROM, start: 2 } },
              [0],
            ),
          ],
          1,
        ),
      ),
    ).not.toThrow();
  });
});
