import { describe, expect, it } from "vitest";
import { StringOpKind, ValueType } from "../../generated/libbusinessid/ir/v1/rules_pb.js";
import { BundleError } from "../../tools/generator/errors.js";
import { generate } from "../../tools/generator/generate.js";
import {
  assertionSequence,
  node,
  type NodeSpec,
  requireNode,
  singleKindBundle,
  valueNode,
} from "../helpers/bundle.js";
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
