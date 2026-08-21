import { describe, expect, it } from "vitest";
import { BusinessIdEngine } from "../../src/index.js";
import {
  CallOpKind,
  ChecksumOpKind,
  IntegerOpKind,
  PredicateOpKind,
  ProgramKind,
  ReasonCode,
  StringOpKind,
  ValueType,
} from "../../src/generated/libbusinessid/ir/v1/rules_pb.js";
import {
  alwaysValidFormat,
  assertionSequence,
  node,
  type NodeSpec,
  program,
  requireNode,
  singleKindBundle,
  subjectNode,
  valueNode,
} from "../helpers/bundle.js";

/**
 * The checksum operations of `ir.md` section 3.6 and the calls of section 3.7.
 *
 * The tri-state is the whole point: `unsupported` is a normal answer, and an
 * indeterminate computation must never collapse into `invalid`.
 */
interface Observed {
  status: string;
  reasonCode: string;
  messageKey: string | undefined;
}

function checksum(nodes: NodeSpec[], value: string): Observed {
  const engine = BusinessIdEngine.fromRules(
    singleKindBundle({ format: alwaysValidFormat(), checksum: nodes }),
  );
  const step = engine.validate({ kind: "test", value }).checksum;
  return { status: step.status, reasonCode: step.reasonCode, messageKey: step.messageKey };
}

const checksumNode = (
  kind: ChecksumOpKind,
  value: Record<string, unknown> = {},
  inputs: number[] = [],
): NodeSpec =>
  node(
    ValueType.CHECKSUM_OUTCOME,
    { case: "checksumOperation", value: { kind, ...value } },
    inputs,
  );

describe("CHECKSUM_OP_KIND_LUHN", () => {
  const luhn = (messageKey?: string): NodeSpec[] => [
    subjectNode(),
    checksumNode(ChecksumOpKind.LUHN, messageKey === undefined ? {} : { messageKey }, [0]),
  ];

  it("accepts a value whose weighted sum is a multiple of ten", () => {
    // 79927398713 is the canonical Luhn example.
    expect(checksum(luhn(), "79927398713").status).toBe("valid");
  });

  it("rejects a mutated check digit", () => {
    expect(checksum(luhn(), "79927398714")).toMatchObject({
      status: "invalid",
      reasonCode: "invalid_checksum",
    });
  });

  it("is unsupported rather than invalid when the value cannot be read", () => {
    expect(checksum(luhn(), "7992739871X").status).toBe("unsupported");
    expect(checksum(luhn(), "7").status).toBe("unsupported");
  });

  it("carries its declared message key", () => {
    expect(checksum(luhn("luhn.failed"), "79927398714").messageKey).toBe("luhn.failed");
  });
});

describe("CHECKSUM_OP_KIND_ISO7064_MOD97_10", () => {
  const mod97 = (): NodeSpec[] => [
    subjectNode(),
    checksumNode(ChecksumOpKind.ISO7064_MOD97_10, {}, [0]),
  ];

  it("expands letters to base 36 and requires a remainder of one", () => {
    // GB82WEST12345698765432 is the IBAN example published by SWIFT, rearranged
    // as WEST12345698765432GB82 before the modulo, which is what the rule
    // receives here.
    expect(checksum(mod97(), "WEST12345698765432GB82").status).toBe("valid");
  });

  it("rejects a value whose remainder is not one", () => {
    expect(checksum(mod97(), "WEST12345698765432GB83").status).toBe("invalid");
  });

  it("is unsupported on a code point outside 0..9 and A..Z", () => {
    expect(checksum(mod97(), "WEST-1234").status).toBe("unsupported");
    expect(checksum(mod97(), "AB").status).toBe("unsupported");
  });
});

describe("CHECKSUM_OP_KIND_COMPARE_DIGIT", () => {
  const compare = (index: number): NodeSpec[] => [
    subjectNode(),
    node(
      ValueType.STRING,
      { case: "stringOperation", value: { kind: StringOpKind.SLICE, start: 0, end: 2 } },
      [0],
    ),
    node(
      ValueType.INTEGER,
      { case: "integerOperation", value: { kind: IntegerOpKind.MOD_DIGITS, modulus: 10n } },
      [1],
    ),
    checksumNode(ChecksumOpKind.COMPARE_DIGIT, { index }, [2, 0]),
  ];

  it("compares against one ASCII digit position", () => {
    // "12" mod 10 is 2, and position 2 holds "2".
    expect(checksum(compare(2), "122").status).toBe("valid");
    expect(checksum(compare(2), "123").status).toBe("invalid");
  });

  it("is unsupported when the position is out of range or not a digit", () => {
    expect(checksum(compare(9), "122").status).toBe("unsupported");
    expect(checksum(compare(2), "12X").status).toBe("unsupported");
  });
});

describe("CHECKSUM_OP_KIND_COMPARE_SLICE", () => {
  const compare = (start: number, end: number): NodeSpec[] => [
    subjectNode(),
    node(
      ValueType.STRING,
      { case: "stringOperation", value: { kind: StringOpKind.SLICE, start: 0, end: 2 } },
      [0],
    ),
    node(
      ValueType.INTEGER,
      { case: "integerOperation", value: { kind: IntegerOpKind.MOD_DIGITS, modulus: 1000n } },
      [1],
    ),
    checksumNode(ChecksumOpKind.COMPARE_SLICE, { start, end }, [2, 0]),
  ];

  it("compares against the decimal value of a slice", () => {
    // "12" mod 1000 is 12, and positions [2,4) hold "12".
    expect(checksum(compare(2, 4), "1212").status).toBe("valid");
    expect(checksum(compare(2, 4), "1213").status).toBe("invalid");
  });

  it("is unsupported when the slice is out of range or not decimal", () => {
    expect(checksum(compare(2, 9), "1212").status).toBe("unsupported");
    expect(checksum(compare(2, 4), "12X2").status).toBe("unsupported");
  });
});

describe("CHECKSUM_OP_KIND_UNSUPPORTED", () => {
  it("always reports its declared reason", () => {
    expect(
      checksum(
        [
          checksumNode(ChecksumOpKind.UNSUPPORTED, {
            reasonCode: ReasonCode.CHECKSUM_NOT_PUBLISHED,
          }),
        ],
        "anything",
      ),
    ).toMatchObject({ status: "unsupported", reasonCode: "checksum_not_published" });
  });
});

describe("CHECKSUM_OP_KIND_CHOOSE and WHEN", () => {
  function branching(length: number): NodeSpec[] {
    return [
      subjectNode(),
      node(
        ValueType.BOOLEAN,
        { case: "predicateOperation", value: { kind: PredicateOpKind.LENGTH_EQ, length } },
        [0],
      ),
      checksumNode(ChecksumOpKind.UNSUPPORTED, {
        reasonCode: ReasonCode.CHECKSUM_NOT_PUBLISHED,
      }),
      checksumNode(ChecksumOpKind.WHEN, {}, [1, 2]),
      checksumNode(ChecksumOpKind.CHOOSE, {}, [3]),
    ];
  }

  it("returns the first applicable branch", () => {
    expect(checksum(branching(3), "123").reasonCode).toBe("checksum_not_published");
  });

  it("reports unsupported_checksum when no branch applies", () => {
    // A published algorithm exists for some lengths only; a value outside them
    // yields no conclusion rather than a rejection.
    expect(checksum(branching(3), "1234")).toMatchObject({
      status: "unsupported",
      reasonCode: "unsupported_checksum",
    });
  });
});

describe("CHECKSUM_OP_KIND_ALL_CHECKS and ANY_CHECK", () => {
  const luhnOn = (start: number, end: number): NodeSpec[] => [
    node(
      ValueType.STRING,
      { case: "stringOperation", value: { kind: StringOpKind.SLICE, start, end } },
      [0],
    ),
  ];

  function combine(kind: ChecksumOpKind): NodeSpec[] {
    return [
      subjectNode(),
      ...luhnOn(0, 11),
      checksumNode(ChecksumOpKind.LUHN, {}, [1]),
      ...luhnOn(0, 4),
      checksumNode(ChecksumOpKind.LUHN, {}, [3]),
      checksumNode(kind, {}, [2, 4]),
    ];
  }

  it("ALL_CHECKS returns the first invalid outcome", () => {
    // The full value is a valid Luhn; its first four digits are not.
    expect(checksum(combine(ChecksumOpKind.ALL_CHECKS), "79927398713").status).toBe("invalid");
  });

  it("ANY_CHECK returns valid as soon as one operand is", () => {
    expect(checksum(combine(ChecksumOpKind.ANY_CHECK), "79927398713").status).toBe("valid");
  });
});

describe("CALL_OP_KIND_CHECKSUM", () => {
  it("runs another program on a caller supplied view and propagates its outcome", () => {
    const callee = program(5, ProgramKind.CHECKSUM, [
      subjectNode(),
      checksumNode(ChecksumOpKind.LUHN, {}, [0]),
    ]);
    const caller: NodeSpec[] = [
      subjectNode(),
      node(
        ValueType.STRING,
        { case: "stringOperation", value: { kind: StringOpKind.SLICE_FROM, start: 2 } },
        [0],
      ),
      node(
        ValueType.CHECKSUM_OUTCOME,
        { case: "callOperation", value: { kind: CallOpKind.CHECKSUM, programId: 5 } },
        [1],
      ),
    ];
    const engine = BusinessIdEngine.fromRules(
      singleKindBundle({
        format: alwaysValidFormat(),
        checksum: caller,
        extraPrograms: [callee],
      }),
    );

    expect(engine.validate({ kind: "test", value: "FR79927398713" }).checksum.status).toBe("valid");
    expect(engine.validate({ kind: "test", value: "FR79927398714" }).checksum.status).toBe(
      "invalid",
    );
  });
});

describe("CALL_OP_KIND_FORMAT", () => {
  it("propagates the callee reason code and message key unchanged", () => {
    const callee = program(5, ProgramKind.FORMAT, [
      subjectNode(),
      node(
        ValueType.BOOLEAN,
        { case: "predicateOperation", value: { kind: PredicateOpKind.ASCII_DIGITS } },
        [0],
      ),
      requireNode(1, ReasonCode.INVALID_CHARACTERS, "callee.characters"),
      assertionSequence([2]),
    ]);
    const caller: NodeSpec[] = [
      valueNode(),
      node(
        ValueType.STRING,
        { case: "stringOperation", value: { kind: StringOpKind.SLICE_FROM, start: 2 } },
        [0],
      ),
      node(
        ValueType.ASSERTION,
        { case: "callOperation", value: { kind: CallOpKind.FORMAT, programId: 5 } },
        [1],
      ),
      assertionSequence([2]),
    ];
    const engine = BusinessIdEngine.fromRules(
      singleKindBundle({ format: caller, extraPrograms: [callee] }),
    );

    expect(engine.validateFormat({ kind: "test", value: "FR123" }).format.status).toBe("valid");
    expect(engine.validateFormat({ kind: "test", value: "FR12X" }).format).toMatchObject({
      status: "invalid",
      reasonCode: "invalid_characters",
      messageKey: "callee.characters",
    });
  });
});
