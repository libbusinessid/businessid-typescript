import { describe, expect, it } from "vitest";
import { engineFor } from "../helpers/rules.js";
import {
  ChecksumOpKind,
  IntegerOpKind,
  PredicateOpKind,
  ReasonCode,
  StringOpKind,
  ValueType,
} from "../../generated/libbusinessid/ir/v1/rules_pb.js";
import {
  alwaysValidFormat,
  assertionSequence,
  constantNode,
  node,
  type NodeSpec,
  requireNode,
  singleKindBundle,
  subjectNode,
  valueNode,
} from "../helpers/bundle.js";

/**
 * The predicates of `ir.md` section 3.3.
 *
 * A predicate is exercised as the condition of a `REQUIRE`, so a true predicate
 * reports `valid` and a false one reports `invalid`. Absent operands are tested
 * throughout: every predicate but `IS_ABSENT` reads absence as false.
 */
async function holds(build: NodeSpec[], value: string): Promise<boolean> {
  const nodes = [...build, requireNode(build.length - 1)];
  nodes.push(assertionSequence([nodes.length - 1]));
  const engine = await engineFor(singleKindBundle({ format: nodes }));
  return engine.validateFormat({ kind: "test", value }).format.status === "valid";
}

/** A view that is always absent, for the absence half of every case. */
const absentView = (): NodeSpec[] => [
  valueNode(),
  node(
    ValueType.STRING,
    { case: "stringOperation", value: { kind: StringOpKind.SLICE_FROM, start: 4000 } },
    [0],
  ),
];

const predicate = (
  kind: PredicateOpKind,
  value: Record<string, unknown>,
  inputs: number[],
): NodeSpec =>
  node(ValueType.BOOLEAN, { case: "predicateOperation", value: { kind, ...value } }, inputs);

describe("length predicates", () => {
  it.each([
    [PredicateOpKind.LENGTH_EQ, { length: 3 }, "ABC", true],
    [PredicateOpKind.LENGTH_EQ, { length: 3 }, "ABCD", false],
    [PredicateOpKind.LENGTH_IN, { lengths: [2, 4] }, "ABCD", true],
    [PredicateOpKind.LENGTH_IN, { lengths: [2, 4] }, "ABC", false],
    [PredicateOpKind.LENGTH_BETWEEN, { minLength: 2, maxLength: 4 }, "ABC", true],
    [PredicateOpKind.LENGTH_BETWEEN, { minLength: 2, maxLength: 4 }, "ABCDE", false],
  ])("%s %o on %o is %s", async (kind, options, value, expected) => {
    expect(await holds([valueNode(), predicate(kind, options, [0])], value)).toBe(expected);
  });

  it("counts code points, not UTF-16 units", async () => {
    // "\u{1D400}AB" is four UTF-16 units but three code points.
    expect(
      await holds(
        [valueNode(), predicate(PredicateOpKind.LENGTH_EQ, { length: 3 }, [0])],
        "\u{1D400}AB",
      ),
    ).toBe(true);
  });

  it.each([PredicateOpKind.LENGTH_EQ, PredicateOpKind.LENGTH_IN, PredicateOpKind.LENGTH_BETWEEN])(
    "%s is false on an absent view",
    async (kind) => {
      const options =
        kind === PredicateOpKind.LENGTH_EQ
          ? { length: 0 }
          : kind === PredicateOpKind.LENGTH_IN
            ? { lengths: [0] }
            : { minLength: 0, maxLength: 4096 };

      expect(await holds([...absentView(), predicate(kind, options, [1])], "ABC")).toBe(false);
    },
  );
});

describe("emptiness and absence", () => {
  it("IS_EMPTY is true only on a present, empty view", async () => {
    const empty: NodeSpec[] = [
      valueNode(),
      node(
        ValueType.STRING,
        { case: "stringOperation", value: { kind: StringOpKind.SLICE, start: 0, end: 0 } },
        [0],
      ),
      predicate(PredicateOpKind.IS_EMPTY, {}, [1]),
    ];

    expect(await holds(empty, "ABC")).toBe(true);
    expect(await holds([valueNode(), predicate(PredicateOpKind.IS_EMPTY, {}, [0])], "ABC")).toBe(
      false,
    );
    expect(
      await holds([...absentView(), predicate(PredicateOpKind.IS_EMPTY, {}, [1])], "ABC"),
    ).toBe(false);
  });

  it("IS_ABSENT is the only predicate that reads absence as true", async () => {
    expect(
      await holds([...absentView(), predicate(PredicateOpKind.IS_ABSENT, {}, [1])], "ABC"),
    ).toBe(true);
    expect(await holds([valueNode(), predicate(PredicateOpKind.IS_ABSENT, {}, [0])], "ABC")).toBe(
      false,
    );
  });
});

describe("EQUALS", () => {
  it("compares code point sequences", async () => {
    const build: NodeSpec[] = [
      valueNode(),
      constantNode("ABC"),
      predicate(PredicateOpKind.EQUALS, {}, [0, 1]),
    ];

    expect(await holds(build, "ABC")).toBe(true);
    expect(await holds(build, "ABD")).toBe(false);
  });

  it("is false when either operand is absent", async () => {
    const build: NodeSpec[] = [
      ...absentView(),
      constantNode("ABC"),
      predicate(PredicateOpKind.EQUALS, {}, [1, 2]),
    ];

    expect(await holds(build, "ABC")).toBe(false);
  });
});

describe("character classes", () => {
  it.each([
    [PredicateOpKind.ASCII_DIGITS, {}, "123", true],
    [PredicateOpKind.ASCII_DIGITS, {}, "12A", false],
    [PredicateOpKind.ASCII_UPPER_LETTERS, {}, "ABC", true],
    [PredicateOpKind.ASCII_UPPER_LETTERS, {}, "AbC", false],
    [PredicateOpKind.ASCII_ALPHANUMERIC, {}, "A1B", true],
    // Lower case is outside the IR class, which covers digits and A..Z only.
    [PredicateOpKind.ASCII_ALPHANUMERIC, {}, "A1b", false],
    [PredicateOpKind.ASCII_CHARSET, { text: "AB" }, "ABBA", true],
    [PredicateOpKind.ASCII_CHARSET, { text: "AB" }, "ABC", false],
  ])("%s %o on %o is %s", async (kind, options, value, expected) => {
    expect(await holds([valueNode(), predicate(kind, options, [0])], value)).toBe(expected);
  });

  it("rejects an empty view: a class needs something to classify", async () => {
    const empty: NodeSpec[] = [
      valueNode(),
      node(
        ValueType.STRING,
        { case: "stringOperation", value: { kind: StringOpKind.SLICE, start: 0, end: 0 } },
        [0],
      ),
      predicate(PredicateOpKind.ASCII_DIGITS, {}, [1]),
    ];

    expect(await holds(empty, "123")).toBe(false);
  });

  it("CHAR_AT_IN reads one code point position", async () => {
    const build = (index: number): NodeSpec[] => [
      valueNode(),
      predicate(PredicateOpKind.CHAR_AT_IN, { index, text: "XY" }, [0]),
    ];

    expect(await holds(build(1), "AXC")).toBe(true);
    expect(await holds(build(1), "ABC")).toBe(false);
    expect(await holds(build(9), "ABC")).toBe(false);
  });
});

describe("text predicates", () => {
  it.each([
    [PredicateOpKind.STARTS_WITH, { text: "FR" }, "FR123", true],
    [PredicateOpKind.STARTS_WITH, { text: "FR" }, "BE123", false],
    [PredicateOpKind.ENDS_WITH, { text: "23" }, "FR123", true],
    [PredicateOpKind.ENDS_WITH, { text: "23" }, "FR124", false],
    [PredicateOpKind.PREFIX_IN, { values: ["BE", "FR"] }, "FR1", true],
    [PredicateOpKind.PREFIX_IN, { values: ["BE", "FR"] }, "DE1", false],
    [PredicateOpKind.CONTAINS, { text: "12" }, "FR123", true],
    [PredicateOpKind.CONTAINS, { text: "99" }, "FR123", false],
  ])("%s %o on %o is %s", async (kind, options, value, expected) => {
    expect(await holds([valueNode(), predicate(kind, options, [0])], value)).toBe(expected);
  });

  it.each([
    [PredicateOpKind.STARTS_WITH, { text: "FR" }],
    [PredicateOpKind.ENDS_WITH, { text: "FR" }],
    [PredicateOpKind.PREFIX_IN, { values: ["FR"] }],
    [PredicateOpKind.CONTAINS, { text: "FR" }],
  ])("%s is false on an absent view", async (kind, options) => {
    expect(await holds([...absentView(), predicate(kind, options, [1])], "FR123")).toBe(false);
  });
});

/**
 * `PREFIX_IN` over a list large enough that how it is searched matters.
 *
 * `ir.md` states `values` is sorted and deduplicated by the compiler, and
 * `engine.md` section 14 now asks that the test not be linear in the list. The
 * cases here fix the semantics the search has to preserve, independently of how
 * it is implemented — they passed against the linear scan and must go on
 * passing.
 *
 * The one that matters most is the last. A search that finds the greatest
 * element not after the value and asks whether that element is a prefix gets it
 * wrong: over `["AB", "ABA"]` the greatest element before `"ABCD"` is `"ABA"`,
 * which is not a prefix of it, while `"AB"` is. Membership has to be asked once
 * per distinct element length, not once for the value.
 */
describe("PREFIX_IN over a sorted list", () => {
  const prefixIn = (values: string[]): NodeSpec[] => [
    valueNode(),
    node(
      ValueType.BOOLEAN,
      { case: "predicateOperation", value: { kind: PredicateOpKind.PREFIX_IN, values } },
      [0],
    ),
  ];
  // Sorted and deduplicated, as check 13 now requires of any bundle.
  const many = Array.from({ length: 500 }, (_, index) => `P${String(index).padStart(4, "0")}`);

  it.each([
    ["first element", "P0000X", true],
    ["last element", "P0499X", true],
    ["a middle element", "P0250X", true],
    ["exactly an element, nothing after it", "P0250", true],
    ["one before the first", "P", false],
    ["between two elements", "P0250A", true],
    ["absent from the list", "Q0250X", false],
    ["past the last element", "Z9999", false],
    ["shorter than every element", "P00", false],
  ])("%s -> %s", async (_label, value, expected) => {
    expect(await holds(prefixIn(many), value)).toBe(expected);
  });

  it("answers a single element list", async () => {
    expect(await holds(prefixIn(["FR"]), "FR123")).toBe(true);
    expect(await holds(prefixIn(["FR"]), "BE123")).toBe(false);
  });

  it("finds a short element when a longer one sorts between it and the value", async () => {
    // "AB" is a prefix of "ABCD"; "ABA" is not, and sorts after "AB" and before
    // "ABCD". Asking only about the nearest element answers false here.
    expect(await holds(prefixIn(["AB", "ABA"]), "ABCD")).toBe(true);
    expect(await holds(prefixIn(["ABA", "ABB"]), "ABCD")).toBe(false);
  });

  it("searches every distinct element length, not just one", async () => {
    // Lengths 1, 3 and 5 in one list.
    expect(await holds(prefixIn(["A", "BBB", "CCCCC"]), "CCCCCX")).toBe(true);
    expect(await holds(prefixIn(["A", "BBB", "CCCCC"]), "BBBX")).toBe(true);
    expect(await holds(prefixIn(["A", "BBB", "CCCCC"]), "AX")).toBe(true);
    expect(await holds(prefixIn(["A", "BBB", "CCCCC"]), "BBX")).toBe(false);
  });
});

describe("combinators", () => {
  const yes = (): NodeSpec => predicate(PredicateOpKind.IS_ABSENT, {}, [1]);
  const no = (): NodeSpec => predicate(PredicateOpKind.IS_ABSENT, {}, [0]);

  it("ALL requires every operand", async () => {
    expect(
      await holds([...absentView(), yes(), yes(), predicate(PredicateOpKind.ALL, {}, [2, 3])], "A"),
    ).toBe(true);
    expect(
      await holds([...absentView(), yes(), no(), predicate(PredicateOpKind.ALL, {}, [2, 3])], "A"),
    ).toBe(false);
  });

  it("ANY requires one operand", async () => {
    expect(
      await holds([...absentView(), no(), yes(), predicate(PredicateOpKind.ANY, {}, [2, 3])], "A"),
    ).toBe(true);
    expect(
      await holds([...absentView(), no(), no(), predicate(PredicateOpKind.ANY, {}, [2, 3])], "A"),
    ).toBe(false);
  });

  it("NOT negates", async () => {
    expect(await holds([...absentView(), no(), predicate(PredicateOpKind.NOT, {}, [2])], "A")).toBe(
      true,
    );
  });
});

describe("PROFILE_IS", () => {
  const build: NodeSpec[] = [predicate(PredicateOpKind.PROFILE_IS, { text: "strict_current" }, [])];

  it("reads the effective profile", async () => {
    const nodes = [...build, requireNode(0)];
    nodes.push(assertionSequence([1]));
    const engine = await engineFor(singleKindBundle({ format: nodes }));

    expect(
      engine.validateFormat({ kind: "test", value: "A" }, { profile: "strict_current" }).format
        .status,
    ).toBe("valid");
    expect(
      engine.validateFormat({ kind: "test", value: "A" }, { profile: "compatible" }).format.status,
    ).toBe("invalid");
  });
});

describe("INTEGER_IS", () => {
  /**
   * `INTEGER_IS` reads an integer, and integer operations belong to checksum
   * programs alone, so it is driven through a `CHOOSE` here. The reason code
   * reports which branch applied.
   */
  async function branchReason(value: string, constant: bigint): Promise<string> {
    const checksum: NodeSpec[] = [
      subjectNode(),
      node(
        ValueType.INTEGER,
        { case: "integerOperation", value: { kind: IntegerOpKind.MOD_DIGITS, modulus: 7n } },
        [0],
      ),
      predicate(PredicateOpKind.INTEGER_IS, { constant }, [1]),
      node(ValueType.CHECKSUM_OUTCOME, {
        case: "checksumOperation",
        value: { kind: ChecksumOpKind.UNSUPPORTED, reasonCode: ReasonCode.CHECKSUM_NOT_PUBLISHED },
      }),
      node(
        ValueType.CHECKSUM_OUTCOME,
        { case: "checksumOperation", value: { kind: ChecksumOpKind.WHEN } },
        [2, 3],
      ),
      node(ValueType.CHECKSUM_OUTCOME, {
        case: "checksumOperation",
        value: { kind: ChecksumOpKind.UNSUPPORTED, reasonCode: ReasonCode.UNSUPPORTED_CHECKSUM },
      }),
      node(
        ValueType.CHECKSUM_OUTCOME,
        { case: "checksumOperation", value: { kind: ChecksumOpKind.CHOOSE } },
        [4, 5],
      ),
    ];
    const engine = await engineFor(singleKindBundle({ format: alwaysValidFormat(), checksum }));
    return engine.validate({ kind: "test", value }).checksum.reasonCode;
  }

  it("is true when the integer equals the literal", async () => {
    // 10 mod 7 is 3, so the branch applies.
    expect(await branchReason("10", 3n)).toBe("checksum_not_published");
  });

  it("is false when it does not, and the CHOOSE falls through", async () => {
    expect(await branchReason("11", 3n)).toBe("unsupported_checksum");
  });

  it("is false on an indeterminate operand rather than failing", async () => {
    // "1X" cannot be read as digits, so the branch simply does not apply.
    expect(await branchReason("1X", 3n)).toBe("unsupported_checksum");
  });
});
