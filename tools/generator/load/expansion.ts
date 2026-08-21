/**
 * Check 14: expansion within the evaluation budget once repeated operands are
 * inlined.
 *
 * The emitter inlines: a node the graph reads twice is emitted twice, which
 * keeps the short-circuit of `ALL`, `ANY` and the assertion sequence exactly
 * where the IR puts it. The node count of a program is bounded, but the graph
 * is a DAG, and a DAG whose every node reads the previous one twice expands
 * exponentially while passing every other check. Without this one, such a
 * bundle is a denial of service against the generator rather than against the
 * engine, and nothing else would see it.
 *
 * The bound is the evaluation budget of `ir.md` section 8: a generated program
 * may not carry more operation instances than an interpreter would have taken
 * steps to run it once. A generator that shares a repeated operand instead of
 * inlining it stays free to do so, provided the sharing preserves that short
 * circuit.
 */
import type {
  Program as ProtoProgram,
  RuleBundle,
} from "../../../generated/libbusinessid/ir/v1/rules_pb.js";
import { invalid } from "./diagnostics.js";
import { LIMITS } from "../limits.js";

/**
 * The number of operation instances a program expands to when inlined.
 *
 * `Infinity` once the count leaves the budget, so a graph designed to explode
 * is answered in linear time rather than by computing the explosion.
 */
export function expansionOf(program: ProtoProgram): number {
  const cost = new Array<number>(program.nodes.length).fill(0);
  for (const [index, node] of program.nodes.entries()) {
    let total = 1;
    for (const input of node.inputNodes) {
      total += cost[input] ?? 0;
      if (total > LIMITS.stepsPerValidation) {
        return Number.POSITIVE_INFINITY;
      }
    }
    cost[index] = total;
  }
  return cost[program.rootNode] ?? 0;
}

/** Refuses a bundle whose programs cannot be emitted within the budget. */
export function checkExpansion(bundle: RuleBundle): void {
  for (const program of bundle.programs) {
    if (expansionOf(program) > LIMITS.stepsPerValidation) {
      invalid(
        14,
        `program ${String(program.id)} expands to more than the ${String(LIMITS.stepsPerValidation)} operation instances the evaluation budget allows`,
      );
    }
  }
}
