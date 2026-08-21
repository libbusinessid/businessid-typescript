import { describe, expect, it } from "vitest";
import {
  CallOpKind,
  ProgramKind,
  StringOpKind,
  ValueType,
} from "../../generated/libbusinessid/ir/v1/rules_pb.js";
import { BundleError } from "../../tools/generator/errors.js";
import { generate } from "../../tools/generator/generate.js";
import {
  alwaysValidFormat,
  assertionSequence,
  canonicalizationSequence,
  node,
  type NodeSpec,
  program,
  requireNode,
  singleKindBundle,
  subjectNode,
  valueNode,
} from "../helpers/bundle.js";
import { expansionOf } from "../../tools/generator/load/expansion.js";
import { PredicateOpKind } from "../../generated/libbusinessid/ir/v1/rules_pb.js";

/**
 * Check 14: expansion within the evaluation budget.
 *
 * `ir.md` section 2 states the bound and section 10 places it: a generated
 * program may not carry more operation instances than an interpreter would have
 * taken steps to run it once. A DAG whose every node reads the previous one
 * twice expands exponentially while passing every other check, so this is the
 * one that sees it.
 */
describe("a bundle that expands exponentially", () => {
  it("is refused rather than emitted", () => {
    const nodes: NodeSpec[] = [valueNode()];
    for (let level = 0; level < 32; level += 1) {
      const previous = nodes.length - 1;
      nodes.push(
        node(ValueType.STRING, { case: "stringOperation", value: { kind: StringOpKind.CONCAT } }, [
          previous,
          previous,
        ]),
      );
    }
    const top = nodes.length - 1;
    nodes.push(
      node(
        ValueType.BOOLEAN,
        { case: "predicateOperation", value: { kind: PredicateOpKind.IS_ABSENT } },
        [top],
      ),
      requireNode(top + 1),
      assertionSequence([top + 2]),
    );

    try {
      generate(singleKindBundle({ format: nodes }));
      expect.unreachable("the bundle was emitted");
    } catch (error) {
      expect(error).toBeInstanceOf(BundleError);
      expect(error).toMatchObject({ reason: "invalid_ruleset", check: 14 });
      expect((error as BundleError).message).toContain("operation instances");
    }
  });

  it("counts only what a root reaches, so a dead chain costs nothing", () => {
    // `ir.md` section 2: the count starts at the roots a generator emits from
    // and follows operands. A node no root reaches is emitted by nobody. A
    // generator that counted every node would refuse this bundle, which any
    // generator can emit — and two generators would answer differently on it.
    const nodes: NodeSpec[] = [valueNode()];
    for (let level = 0; level < 40; level += 1) {
      const previous = nodes.length - 1;
      nodes.push(
        node(ValueType.STRING, { case: "stringOperation", value: { kind: StringOpKind.CONCAT } }, [
          previous,
          previous,
        ]),
      );
    }
    // The rule reads node 0 alone; the chain above it is unreachable.
    nodes.push(
      node(
        ValueType.BOOLEAN,
        { case: "predicateOperation", value: { kind: PredicateOpKind.IS_ABSENT } },
        [0],
      ),
      requireNode(nodes.length),
      assertionSequence([nodes.length + 1]),
    );

    expect(() => generate(singleKindBundle({ format: nodes }))).not.toThrow();
  });

  it("accepts a graph that stays inside the bound", () => {
    const nodes: NodeSpec[] = [valueNode()];
    for (let level = 0; level < 8; level += 1) {
      const previous = nodes.length - 1;
      nodes.push(
        node(ValueType.STRING, { case: "stringOperation", value: { kind: StringOpKind.CONCAT } }, [
          previous,
          previous,
        ]),
      );
    }
    const top = nodes.length - 1;
    nodes.push(
      node(
        ValueType.BOOLEAN,
        { case: "predicateOperation", value: { kind: PredicateOpKind.IS_ABSENT } },
        [top],
      ),
      requireNode(top + 1),
      assertionSequence([top + 2]),
    );

    expect(() => generate(singleKindBundle({ format: nodes }))).not.toThrow();
  });
});

describe("how the count is taken", () => {
  /** A chain where each level reads the previous one twice. */
  function chain(levels: number): NodeSpec[] {
    const nodes: NodeSpec[] = [valueNode()];
    for (let level = 0; level < levels; level += 1) {
      const previous = nodes.length - 1;
      nodes.push(
        node(ValueType.STRING, { case: "stringOperation", value: { kind: StringOpKind.CONCAT } }, [
          previous,
          previous,
        ]),
      );
    }
    return nodes;
  }

  it("saturates instead of overflowing", () => {
    // A chain two hundred levels deep reaches 2^201. An accumulator that
    // overflowed would land on a small number that passes, and the overflow is
    // the shape of the attack rather than an edge case.
    const deep = program(1, ProgramKind.CANONICALIZATION, [
      ...chain(200),
      canonicalizationSequence([]),
    ]);

    const counted = expansionOf(deep);

    expect(Number.isSafeInteger(counted)).toBe(true);
    expect(counted).toBeLessThanOrEqual(100_001);
  });

  it("counts a call as one instance and never expands its callee", () => {
    // The callee is a separate program, emitted once and reached by a function
    // call, so its own instances are bounded on its own.
    const caller = program(2, ProgramKind.CHECKSUM, [
      subjectNode(),
      node(
        ValueType.CHECKSUM_OUTCOME,
        { case: "callOperation", value: { kind: CallOpKind.CHECKSUM, programId: 9 } },
        [0],
      ),
    ]);

    // The subject operand, and the call itself.
    expect(expansionOf(caller)).toBe(2);
  });

  it("reaches a capture even when the root does not", () => {
    // `Program.captures` names emission roots. A capture the root already
    // reaches is emitted once, as part of the root; one it does not reach is
    // still something a generator emits from.
    const withCapture = program(
      3,
      ProgramKind.FORMAT,
      [...chain(30), ...alwaysValidFormat()],
      chain(30).length + alwaysValidFormat().length - 1,
      { captures: [{ name: "explosive", node: chain(30).length - 1 }] },
    );

    expect(expansionOf(withCapture)).toBeGreaterThan(100_000);
  });
});
