import { describe, expect, it } from "vitest";
import { engineFor, type TestEngine } from "../helpers/rules.js";
import {
  PredicateOpKind,
  StringOpKind,
  ValueType,
} from "../../generated/libbusinessid/ir/v1/rules_pb.js";
import {
  assertionSequence,
  constantNode,
  node,
  requireNode,
  singleKindBundle,
  valueNode,
} from "../helpers/bundle.js";

/**
 * The string constructors of `ir.md` section 3.1.
 *
 * Each is exercised through the public API, so the test covers the loader, the
 * interpreter and the pipeline together rather than a private function that
 * could drift from what the engine actually runs.
 *
 * Every case asserts the *absence* rule as well as the nominal one: a view that
 * cannot be taken is absent, absence propagates through every constructor, and
 * a predicate reading an absent view is false.
 */
async function engineWhere(spec: {
  build: NodeSpec[];
  predicate: (stringNode: number) => NodeSpec;
}): Promise<TestEngine> {
  const nodes = [...spec.build];
  nodes.push(spec.predicate(nodes.length - 1));
  nodes.push(requireNode(nodes.length - 1));
  nodes.push(assertionSequence([nodes.length - 1]));
  return engineFor(singleKindBundle({ format: nodes }));
}

type NodeSpec = ReturnType<typeof valueNode>;

const isEmpty = (input: number): NodeSpec =>
  node(
    ValueType.BOOLEAN,
    { case: "predicateOperation", value: { kind: PredicateOpKind.IS_EMPTY } },
    [input],
  );

const isAbsent = (input: number): NodeSpec =>
  node(
    ValueType.BOOLEAN,
    { case: "predicateOperation", value: { kind: PredicateOpKind.IS_ABSENT } },
    [input],
  );

const equalsConstant = (input: number, constantIndex: number): NodeSpec =>
  node(ValueType.BOOLEAN, { case: "predicateOperation", value: { kind: PredicateOpKind.EQUALS } }, [
    input,
    constantIndex,
  ]);

/** Builds an engine whose format rule requires `expr` to equal `expected`. */
async function equalityEngine(build: NodeSpec[], expected: string): Promise<TestEngine> {
  const nodes = [...build, constantNode(expected)];
  nodes.push(equalsConstant(build.length - 1, nodes.length - 1));
  nodes.push(requireNode(nodes.length - 1));
  nodes.push(assertionSequence([nodes.length - 1]));
  return engineFor(singleKindBundle({ format: nodes }));
}

const verdict = (engine: TestEngine, value: string): string =>
  engine.validateFormat({ kind: "test", value }).format.status;

describe("STRING_OP_KIND_CONSTANT", () => {
  it("yields its constant whatever the input", async () => {
    const engine = await equalityEngine([constantNode("FIXED")], "FIXED");

    expect(verdict(engine, "anything")).toBe("valid");
  });
});

describe("STRING_OP_KIND_VALUE", () => {
  it("yields the canonical value", async () => {
    const engine = await equalityEngine([valueNode()], "ABC");

    expect(verdict(engine, "ABC")).toBe("valid");
    expect(verdict(engine, "ABD")).toBe("invalid");
  });
});

describe("STRING_OP_KIND_SLICE", () => {
  const sliced = (start: number, end: number): NodeSpec[] => [
    valueNode(),
    node(
      ValueType.STRING,
      { case: "stringOperation", value: { kind: StringOpKind.SLICE, start, end } },
      [0],
    ),
  ];

  it("yields the code points in [start, end)", async () => {
    expect(verdict(await equalityEngine(sliced(1, 3), "BC"), "ABCD")).toBe("valid");
  });

  it("is absent when end exceeds the length", async () => {
    const engine = await engineWhere({ build: sliced(1, 9), predicate: isAbsent });

    expect(verdict(engine, "ABCD")).toBe("valid");
  });

  it("is absent when start is greater than end", async () => {
    const engine = await engineWhere({ build: sliced(3, 1), predicate: isAbsent });

    expect(verdict(engine, "ABCD")).toBe("valid");
  });

  it("counts positions in code points, not UTF-16 units", async () => {
    // U+1D400 occupies two UTF-16 units; slicing [1,2) must yield the single
    // code point that follows it, not half of it.
    expect(verdict(await equalityEngine(sliced(1, 2), "B"), "\u{1D400}BC")).toBe("valid");
  });
});

describe("STRING_OP_KIND_SLICE_FROM", () => {
  const from = (start: number): NodeSpec[] => [
    valueNode(),
    node(
      ValueType.STRING,
      { case: "stringOperation", value: { kind: StringOpKind.SLICE_FROM, start } },
      [0],
    ),
  ];

  it("yields the code points from start", async () => {
    expect(verdict(await equalityEngine(from(2), "CD"), "ABCD")).toBe("valid");
  });

  it("yields the empty view when start equals the length", async () => {
    expect(verdict(await engineWhere({ build: from(4), predicate: isEmpty }), "ABCD")).toBe(
      "valid",
    );
  });

  it("is absent when start exceeds the length", async () => {
    expect(verdict(await engineWhere({ build: from(5), predicate: isAbsent }), "ABCD")).toBe(
      "valid",
    );
  });
});

describe("STRING_OP_KIND_SLICE_TO", () => {
  const to = (end: number): NodeSpec[] => [
    valueNode(),
    node(
      ValueType.STRING,
      { case: "stringOperation", value: { kind: StringOpKind.SLICE_TO, end } },
      [0],
    ),
  ];

  it("yields the code points before end", async () => {
    expect(verdict(await equalityEngine(to(2), "AB"), "ABCD")).toBe("valid");
  });

  it("is absent when end exceeds the length", async () => {
    expect(verdict(await engineWhere({ build: to(9), predicate: isAbsent }), "ABCD")).toBe("valid");
  });
});

describe("STRING_OP_KIND_BEFORE_FIRST and AFTER_FIRST", () => {
  const split = (kind: StringOpKind, text: string): NodeSpec[] => [
    valueNode(),
    node(ValueType.STRING, { case: "stringOperation", value: { kind, text } }, [0]),
  ];

  it("splits on the first occurrence", async () => {
    expect(
      verdict(await equalityEngine(split(StringOpKind.BEFORE_FIRST, "."), "FR"), "FR.123"),
    ).toBe("valid");
    expect(
      verdict(await equalityEngine(split(StringOpKind.AFTER_FIRST, "."), "123.4"), "FR.123.4"),
    ).toBe("valid");
  });

  it("is absent when the delimiter does not occur", async () => {
    expect(
      verdict(
        await engineWhere({ build: split(StringOpKind.BEFORE_FIRST, "."), predicate: isAbsent }),
        "FR123",
      ),
    ).toBe("valid");
    expect(
      verdict(
        await engineWhere({ build: split(StringOpKind.AFTER_FIRST, "."), predicate: isAbsent }),
        "FR123",
      ),
    ).toBe("valid");
  });
});

describe("STRING_OP_KIND_STRIP_PREFIX", () => {
  const strip = (text: string): NodeSpec[] => [
    valueNode(),
    node(
      ValueType.STRING,
      { case: "stringOperation", value: { kind: StringOpKind.STRIP_PREFIX, text } },
      [0],
    ),
  ];

  it("removes the exact leading text", async () => {
    expect(verdict(await equalityEngine(strip("FR"), "123"), "FR123")).toBe("valid");
  });

  it("is absent when the value does not start with it", async () => {
    expect(verdict(await engineWhere({ build: strip("FR"), predicate: isAbsent }), "BE123")).toBe(
      "valid",
    );
  });
});

describe("STRING_OP_KIND_CONCAT", () => {
  it("joins its operands in order", async () => {
    const build: NodeSpec[] = [
      constantNode("A"),
      constantNode("B"),
      node(
        ValueType.STRING,
        { case: "stringOperation", value: { kind: StringOpKind.CONCAT } },
        [0, 1],
      ),
    ];

    expect(verdict(await equalityEngine(build, "AB"), "anything")).toBe("valid");
  });

  it("is absent when any operand is absent", async () => {
    const build: NodeSpec[] = [
      valueNode(),
      node(
        ValueType.STRING,
        { case: "stringOperation", value: { kind: StringOpKind.SLICE_FROM, start: 99 } },
        [0],
      ),
      constantNode("A"),
      node(
        ValueType.STRING,
        { case: "stringOperation", value: { kind: StringOpKind.CONCAT } },
        [2, 1],
      ),
    ];

    expect(verdict(await engineWhere({ build, predicate: isAbsent }), "ABC")).toBe("valid");
  });
});
