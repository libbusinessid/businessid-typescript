import { describe, expect, it } from "vitest";
import { engineFor } from "../helpers/rules.js";
import {
  CharMapping,
  ChecksumOpKind,
  IntegerOpKind,
  ValueType,
  WeightAlignment,
} from "../../generated/libbusinessid/ir/v1/rules_pb.js";
import {
  alwaysValidFormat,
  node,
  type NodeSpec,
  singleKindBundle,
  subjectNode,
} from "../helpers/bundle.js";

/**
 * The integer constructors of `ir.md` section 3.2.
 *
 * Each is driven through `COMPARE_CONSTANT`, so a computed value that matches
 * reports `valid`, one that does not reports `invalid`, and an *indeterminate*
 * one reports `unsupported`. That third outcome is the point: an integer that
 * cannot be evaluated never proves an identifier wrong.
 */
async function checksumOf(build: NodeSpec[], constant: bigint, value: string): Promise<string> {
  const nodes = [...build];
  nodes.push(
    node(
      ValueType.CHECKSUM_OUTCOME,
      { case: "checksumOperation", value: { kind: ChecksumOpKind.COMPARE_CONSTANT, constant } },
      [build.length - 1],
    ),
  );
  const engine = await engineFor(
    singleKindBundle({ format: alwaysValidFormat(), checksum: nodes }),
  );
  return engine.validate({ kind: "test", value }).checksum.status;
}

const digitsToInteger = (): NodeSpec[] => [
  subjectNode(),
  node(ValueType.STRING, { case: "stringOperation", value: { kind: 5, start: 0, end: 4 } }, [0]),
  node(
    ValueType.INTEGER,
    { case: "integerOperation", value: { kind: IntegerOpKind.DIGITS_TO_INTEGER } },
    [1],
  ),
];

describe("INTEGER_OP_KIND_DIGITS_TO_INTEGER", () => {
  it("reads a bounded run of digits as a decimal integer", async () => {
    expect(await checksumOf(digitsToInteger(), 1234n, "12345")).toBe("valid");
    expect(await checksumOf(digitsToInteger(), 9999n, "12345")).toBe("invalid");
  });

  it("is indeterminate on a non digit, which reports unsupported", async () => {
    expect(await checksumOf(digitsToInteger(), 1234n, "12A45")).toBe("unsupported");
  });
});

const modDigits = (modulus: bigint): NodeSpec[] => [
  subjectNode(),
  node(
    ValueType.INTEGER,
    { case: "integerOperation", value: { kind: IntegerOpKind.MOD_DIGITS, modulus } },
    [0],
  ),
];

describe("INTEGER_OP_KIND_MOD_DIGITS", () => {
  it("takes the remainder digit by digit, past any integer width", async () => {
    // 40 digits: far beyond 2^53 and beyond int64, yet exact.
    const long = "1".repeat(40);
    const expected = BigInt(long) % 97n;

    expect(await checksumOf(modDigits(97n), expected, long)).toBe("valid");
  });

  it("is indeterminate on an empty or non digit view", async () => {
    expect(await checksumOf(modDigits(97n), 0n, "")).toBe("unsupported");
    expect(await checksumOf(modDigits(97n), 0n, "12X")).toBe("unsupported");
  });
});

const weighted = (
  weights: bigint[],
  alignment: WeightAlignment,
  mapping: CharMapping,
  alphabet?: string,
): NodeSpec[] => [
  subjectNode(),
  node(
    ValueType.INTEGER,
    {
      case: "integerOperation",
      value: {
        kind: IntegerOpKind.WEIGHTED_SUM,
        weights,
        alignment,
        mapping,
        ...(alphabet === undefined ? {} : { alphabet }),
      },
    },
    [0],
  ),
];

describe("INTEGER_OP_KIND_WEIGHTED_SUM", () => {
  it("pairs LEFT from the first position", async () => {
    // 1*2 + 2*3 = 8, and the trailing "3" pairs with nothing.
    const build = weighted([2n, 3n], WeightAlignment.LEFT, CharMapping.DIGIT_VALUE);

    expect(await checksumOf(build, 8n, "123")).toBe("valid");
  });

  it("pairs RIGHT from the last position", async () => {
    // last digit 3*3 + preceding 2*2 = 13, and the leading "1" pairs with nothing.
    const build = weighted([2n, 3n], WeightAlignment.RIGHT, CharMapping.DIGIT_VALUE);

    expect(await checksumOf(build, 13n, "123")).toBe("valid");
  });

  it("cycles the weights over every position", async () => {
    // 1*2 + 2*3 + 3*2 = 14: every position contributes under CYCLE.
    const build = weighted([2n, 3n], WeightAlignment.CYCLE, CharMapping.DIGIT_VALUE);

    expect(await checksumOf(build, 14n, "123")).toBe("valid");
  });

  it("maps letters to base 36 under ALNUM_BASE36", async () => {
    // A is 10, B is 11: 10*1 + 11*1 = 21.
    const build = weighted([1n, 1n], WeightAlignment.LEFT, CharMapping.ALNUM_BASE36);

    expect(await checksumOf(build, 21n, "AB")).toBe("valid");
  });

  it("takes a value from its index in a custom alphabet", async () => {
    // The alphabet skips I, O, S, V and Z, so J is 18 where base 36 makes it 19.
    const alphabet = "0123456789ABCDEFGHJKLMNPQRTUWXY";
    const build = weighted([1n], WeightAlignment.LEFT, CharMapping.CUSTOM_ALPHABET, alphabet);

    expect(await checksumOf(build, 18n, "J")).toBe("valid");
    expect(await checksumOf(build, 19n, "J")).toBe("invalid");
  });

  it("is indeterminate on a code point outside the alphabet", async () => {
    const build = weighted([1n], WeightAlignment.LEFT, CharMapping.CUSTOM_ALPHABET, "0123456789");

    expect(await checksumOf(build, 0n, "I")).toBe("unsupported");
  });

  it("is indeterminate on a code point no weight pairs with", async () => {
    // LEFT pairs only the first position, but the letter at the second still
    // makes the sum indeterminate: the value cannot be read at all.
    const build = weighted([1n], WeightAlignment.LEFT, CharMapping.DIGIT_VALUE);

    expect(await checksumOf(build, 1n, "1X")).toBe("unsupported");
  });
});

describe("INTEGER_OP_KIND_MODULO", () => {
  const build = (modulus: bigint): NodeSpec[] => [
    ...modDigits(1_000_000_000n),
    node(
      ValueType.INTEGER,
      { case: "integerOperation", value: { kind: IntegerOpKind.MODULO, modulus } },
      [1],
    ),
  ];

  it("always lands in [0, modulus)", async () => {
    expect(await checksumOf(build(7n), 123n % 7n, "123")).toBe("valid");
  });
});

describe("INTEGER_OP_KIND_COMPLEMENT", () => {
  const build = (modulus: bigint): NodeSpec[] => [
    ...modDigits(1_000_000_000n),
    node(
      ValueType.INTEGER,
      { case: "integerOperation", value: { kind: IntegerOpKind.COMPLEMENT, modulus } },
      [1],
    ),
  ];

  it("yields modulus minus the operand", async () => {
    expect(await checksumOf(build(97n), 97n - 12n, "12")).toBe("valid");
  });

  it("is indeterminate when the operand sits outside [0, modulus]", async () => {
    expect(await checksumOf(build(50n), 0n, "123")).toBe("unsupported");
  });
});

describe("INTEGER_OP_KIND_REMAINDER_MAP", () => {
  const build = (values: bigint[]): NodeSpec[] => [
    ...modDigits(1_000_000_000n),
    node(
      ValueType.INTEGER,
      {
        case: "integerOperation",
        value: { kind: IntegerOpKind.REMAINDER_MAP, remainderValues: values },
      },
      [1],
    ),
  ];

  it("indexes the table with the operand", async () => {
    expect(await checksumOf(build([5n, 6n, 7n]), 7n, "2")).toBe("valid");
  });

  it("is indeterminate outside the table", async () => {
    expect(await checksumOf(build([5n, 6n]), 0n, "9")).toBe("unsupported");
  });
});
