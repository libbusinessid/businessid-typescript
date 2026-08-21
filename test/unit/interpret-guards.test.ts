import { describe, expect, it } from "vitest";
import {
  CallOpKind,
  CanonicalizationOpKind,
  ChecksumOpKind,
  IntegerOpKind,
  PredicateOpKind,
  ProgramKind,
  StringOpKind,
  ValueType,
} from "../../src/generated/libbusinessid/ir/v1/rules_pb.js";
import { EngineError } from "../../src/domain/errors.js";
import { Budget } from "../../src/runtime/budget.js";
import {
  type EvaluationContext,
  runCanonicalization,
  runChecksum,
  runFormat,
} from "../../src/runtime/interpret.js";
import type { IrNode, IrProgram, LoadedBundle } from "../../src/runtime/ir.js";

/**
 * The defensive layer of the interpreter.
 *
 * Every guard here protects an invariant load time validation already proves,
 * so none of them can fire through the public API. They are tested anyway,
 * because what they guarantee is exactly what `engine.md` section 19 forbids
 * losing: an internal inconsistency must surface as an engine error, never as
 * `invalid_checksum` or any other verdict about the identifier.
 *
 * Reaching them means building an IR that the loader would have refused, which
 * is why these tests call the interpreter directly.
 */
function contextFor(programs: IrProgram[]): EvaluationContext {
  const bundle: LoadedBundle = {
    formatVersion: 1,
    rulesVersion: "2026.08.14",
    capabilities: new Set(),
    programs: new Map(programs.map((entry) => [entry.id, entry])),
    definitions: new Map(),
    dispatchers: new Map(),
    kindIndex: new Map(),
  };
  return {
    bundle,
    budget: new Budget(),
    profile: "compatible",
    countryCode: undefined,
    target: undefined,
    definition: undefined,
  };
}

const irProgram = (
  id: number,
  kind: ProgramKind,
  nodes: IrNode[],
  rootNode = nodes.length - 1,
): IrProgram => ({ id, kind, nodes, rootNode });

const stringNode = (kind: StringOpKind, inputs: number[] = [], extra = {}): IrNode => ({
  outputType: ValueType.STRING,
  inputs,
  operation: { family: "string", kind, ...extra },
});

describe("a node index outside the program", () => {
  it("raises an engine error rather than reading past the graph", () => {
    const program = irProgram(1, ProgramKind.FORMAT, [stringNode(StringOpKind.VALUE)], 9);

    expect(() => runFormat(contextFor([program]), 1, [])).toThrow(EngineError);
  });
});

describe("a node of the wrong family", () => {
  it("refuses to read a string from a node that does not produce one", () => {
    const program = irProgram(1, ProgramKind.FORMAT, [
      // Declared a string, but carrying an assertion: the loader would have
      // refused this at check 10.
      { outputType: ValueType.STRING, inputs: [], operation: { family: "assertion", kind: 1 } },
      {
        outputType: ValueType.BOOLEAN,
        inputs: [0],
        operation: { family: "predicate", kind: PredicateOpKind.IS_EMPTY },
      },
      {
        outputType: ValueType.ASSERTION,
        inputs: [1],
        operation: { family: "assertion", kind: 2, reasonCode: "empty" },
      },
    ]);

    expect(() => runFormat(contextFor([program]), 1, [])).toThrow(EngineError);
  });

  it("refuses to read an integer, a boolean, a step or an outcome likewise", () => {
    const asInteger = irProgram(1, ProgramKind.CHECKSUM, [
      { outputType: ValueType.INTEGER, inputs: [], operation: { family: "assertion", kind: 1 } },
      {
        outputType: ValueType.CHECKSUM_OUTCOME,
        inputs: [0],
        operation: { family: "checksum", kind: ChecksumOpKind.COMPARE_CONSTANT, constant: 0n },
      },
    ]);
    expect(() => runChecksum(contextFor([asInteger]), 1, [])).toThrow(EngineError);

    const asPredicate = irProgram(1, ProgramKind.FORMAT, [
      { outputType: ValueType.BOOLEAN, inputs: [], operation: { family: "assertion", kind: 1 } },
      {
        outputType: ValueType.ASSERTION,
        inputs: [0],
        operation: { family: "assertion", kind: 2, reasonCode: "empty" },
      },
    ]);
    expect(() => runFormat(contextFor([asPredicate]), 1, [])).toThrow(EngineError);

    const asStep = irProgram(1, ProgramKind.CANONICALIZATION, [
      {
        outputType: ValueType.CANONICALIZATION_STEP,
        inputs: [],
        operation: { family: "string", kind: StringOpKind.VALUE },
      },
    ]);
    expect(() => runCanonicalization(contextFor([asStep]), 1, [])).toThrow(EngineError);

    const asOutcome = irProgram(1, ProgramKind.CHECKSUM, [
      {
        outputType: ValueType.CHECKSUM_OUTCOME,
        inputs: [],
        operation: { family: "string", kind: StringOpKind.VALUE },
      },
    ]);
    expect(() => runChecksum(contextFor([asOutcome]), 1, [])).toThrow(EngineError);
  });
});

describe("a missing operand", () => {
  it.each([
    [
      "a string constructor",
      irProgram(1, ProgramKind.FORMAT, [stringNode(StringOpKind.SLICE, [], { start: 0, end: 1 })]),
      runFormat,
    ],
    [
      "an integer constructor",
      irProgram(1, ProgramKind.CHECKSUM, [
        {
          outputType: ValueType.INTEGER,
          inputs: [],
          operation: { family: "integer", kind: IntegerOpKind.MOD_DIGITS, modulus: 7n },
        },
      ]),
      runChecksum,
    ],
    [
      "a predicate",
      irProgram(1, ProgramKind.FORMAT, [
        {
          outputType: ValueType.BOOLEAN,
          inputs: [],
          operation: { family: "predicate", kind: PredicateOpKind.IS_EMPTY },
        },
      ]),
      runFormat,
    ],
    [
      "a negation",
      irProgram(1, ProgramKind.FORMAT, [
        {
          outputType: ValueType.BOOLEAN,
          inputs: [],
          operation: { family: "predicate", kind: PredicateOpKind.NOT },
        },
      ]),
      runFormat,
    ],
    [
      "an integer predicate",
      irProgram(1, ProgramKind.CHECKSUM, [
        {
          outputType: ValueType.BOOLEAN,
          inputs: [],
          operation: { family: "predicate", kind: PredicateOpKind.INTEGER_IS, constant: 0n },
        },
      ]),
      runChecksum,
    ],
    [
      "a conditional step",
      irProgram(1, ProgramKind.CANONICALIZATION, [
        {
          outputType: ValueType.CANONICALIZATION_STEP,
          inputs: [],
          operation: { family: "canonicalization", kind: CanonicalizationOpKind.WHEN },
        },
      ]),
      runCanonicalization,
    ],
    [
      "a checksum comparison",
      irProgram(1, ProgramKind.CHECKSUM, [
        {
          outputType: ValueType.CHECKSUM_OUTCOME,
          inputs: [],
          operation: { family: "checksum", kind: ChecksumOpKind.LUHN },
        },
      ]),
      runChecksum,
    ],
    [
      "a checksum branch",
      irProgram(1, ProgramKind.CHECKSUM, [
        {
          outputType: ValueType.CHECKSUM_OUTCOME,
          inputs: [],
          operation: { family: "checksum", kind: ChecksumOpKind.WHEN },
        },
      ]),
      runChecksum,
    ],
    [
      "a format call",
      irProgram(1, ProgramKind.FORMAT, [
        {
          outputType: ValueType.ASSERTION,
          inputs: [],
          operation: { family: "call", kind: CallOpKind.FORMAT, programId: 2 },
        },
      ]),
      runFormat,
    ],
    [
      "a checksum call",
      irProgram(1, ProgramKind.CHECKSUM, [
        {
          outputType: ValueType.CHECKSUM_OUTCOME,
          inputs: [],
          operation: { family: "call", kind: CallOpKind.CHECKSUM, programId: 2 },
        },
      ]),
      runChecksum,
    ],
  ])("raises an engine error for %s", (_name, program, run) => {
    expect(() => run(contextFor([program]), 1, [])).toThrow(EngineError);
  });
});

describe("a malformed require", () => {
  it("raises an engine error when no reason code is declared", () => {
    const program = irProgram(1, ProgramKind.FORMAT, [
      {
        outputType: ValueType.BOOLEAN,
        inputs: [],
        operation: { family: "predicate", kind: PredicateOpKind.PROFILE_IS },
      },
      { outputType: ValueType.ASSERTION, inputs: [0], operation: { family: "assertion", kind: 2 } },
    ]);

    expect(() => runFormat(contextFor([program]), 1, [])).toThrow(EngineError);
  });
});

describe("an unsupported checksum without a reason", () => {
  it("raises an engine error rather than inventing one", () => {
    const program = irProgram(1, ProgramKind.CHECKSUM, [
      {
        outputType: ValueType.CHECKSUM_OUTCOME,
        inputs: [],
        operation: { family: "checksum", kind: ChecksumOpKind.UNSUPPORTED },
      },
    ]);

    expect(() => runChecksum(contextFor([program]), 1, [])).toThrow(EngineError);
  });
});

describe("a WHEN branch reached outside a CHOOSE", () => {
  it("raises an engine error rather than returning a non applicable outcome", () => {
    const program = irProgram(1, ProgramKind.CHECKSUM, [
      {
        outputType: ValueType.BOOLEAN,
        inputs: [],
        operation: {
          family: "predicate",
          kind: PredicateOpKind.PROFILE_IS,
          profile: "strict_current",
        },
      },
      {
        outputType: ValueType.CHECKSUM_OUTCOME,
        inputs: [],
        operation: {
          family: "checksum",
          kind: ChecksumOpKind.UNSUPPORTED,
          reasonCode: "unsupported_checksum",
        },
      },
      {
        outputType: ValueType.CHECKSUM_OUTCOME,
        inputs: [0, 1],
        operation: { family: "checksum", kind: ChecksumOpKind.WHEN },
      },
      {
        outputType: ValueType.CHECKSUM_OUTCOME,
        inputs: [2],
        operation: { family: "checksum", kind: ChecksumOpKind.ALL_CHECKS },
      },
    ]);

    expect(() => runChecksum(contextFor([program]), 1, [])).toThrow(EngineError);
  });
});

describe("prepend_country_if_missing without a selected target", () => {
  it("raises an engine error rather than prepending nothing silently", () => {
    const program = irProgram(1, ProgramKind.CANONICALIZATION, [
      {
        outputType: ValueType.CANONICALIZATION_STEP,
        inputs: [],
        operation: {
          family: "canonicalization",
          kind: CanonicalizationOpKind.PREPEND_COUNTRY_IF_MISSING,
        },
      },
    ]);

    expect(() => runCanonicalization(contextFor([program]), 1, [])).toThrow(EngineError);
  });
});

describe("a call towards a program that is missing", () => {
  it("raises an engine error", () => {
    const program = irProgram(1, ProgramKind.FORMAT, [stringNode(StringOpKind.VALUE)]);

    expect(() => runChecksum(contextFor([program]), 1, [])).toThrow(EngineError);
    expect(() => runFormat(contextFor([program]), 99, [])).toThrow(EngineError);
  });
});
