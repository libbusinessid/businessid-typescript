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
 *
 * The count is what a generator emits, and `ir.md` section 2 turns that into
 * four rules, each of which decides whether two generators agree on the same
 * bundle.
 *
 * It starts at the emission roots and follows operands, so a node no root
 * reaches costs nothing: a generator does not emit dead code.
 *
 * The roots are the program root, the `subject_node` when the program declares
 * one, and every capture no other root already reaches. A capture *any* root
 * reaches is not a second emission — it is emitted inside that root's
 * expression, and charging its subtree again would count it twice. That holds
 * for a capture reached by another capture, not only by the program root.
 *
 * Captures are taken from the highest index down. An operand always sits lower
 * than the node reading it, so a capture reached by another is seen after the
 * one reaching it and a single pass settles it. Walking the declared list in
 * its own order would make the count depend on how the captures happen to be
 * listed, which is not an observable property of the bundle.
 *
 * Their costs are summed, because a generator emits all of them. Checking each
 * root on its own would let a program carry any number of roots just below the
 * ceiling.
 *
 * A `CALL` counts as one instance. Its callee is a separate program, emitted
 * once and reached by a function call, so the callee's own instances are
 * bounded on its own. Only the operand a call passes expands here, because
 * that operand is emitted as the argument.
 *
 * The arithmetic saturates rather than wrapping. A chain two hundred levels
 * deep reaches 2^201 instances, and an accumulator that overflowed would land
 * on a small number that passes — the overflow being the shape of the attack
 * rather than an edge case.
 */
import type {
  Program as ProtoProgram,
  RuleBundle,
} from "../../../generated/entid/ir/v1/rules_pb.js";
import { LIMITS } from "../limits.js";
import { invalid } from "./diagnostics.js";

/** Where the count stops. Anything at this value has already left the budget. */
const CEILING = LIMITS.stepsPerValidation + 1;

function saturatingAdd(left: number, right: number): number {
  const total = left + right;
  return total > CEILING ? CEILING : total;
}

/**
 * Adds a node and everything it reads to a set.
 *
 * Iterative: a program may hold four thousand nodes, and a chain that deep
 * would be a recursion the generator should not depend on surviving.
 */
function reach(program: ProtoProgram, from: number, into: Set<number>): void {
  const pending = [from];
  while (pending.length > 0) {
    const index = pending.pop();
    if (index === undefined || into.has(index)) {
      continue;
    }
    into.add(index);
    for (const input of program.nodes[index]?.inputNodes ?? []) {
      pending.push(input);
    }
  }
}

/**
 * The number of operation instances a program expands to when inlined.
 *
 * Operand indices are strictly lower than the node that reads them, proved by
 * check 11, so one ascending pass computes every cost without recursion, and
 * the same fact is what makes the descending capture pass correct.
 */
export function expansionOf(program: ProtoProgram): number {
  const live = new Set<number>();
  reach(program, program.rootNode, live);
  if (program.subjectNode !== undefined) {
    reach(program, program.subjectNode, live);
  }
  for (const capture of program.captures) {
    reach(program, capture.node, live);
  }

  const cost = new Array<number>(program.nodes.length).fill(0);
  for (let index = 0; index < program.nodes.length; index += 1) {
    if (!live.has(index)) {
      continue;
    }
    let total = 1;
    for (const input of program.nodes[index]?.inputNodes ?? []) {
      total = saturatingAdd(total, cost[input] ?? 0);
    }
    cost[index] = total;
  }

  const covered = new Set<number>();
  let total = 0;
  const charge = (index: number): void => {
    total = saturatingAdd(total, cost[index] ?? 0);
    reach(program, index, covered);
  };

  charge(program.rootNode);
  if (program.subjectNode !== undefined) {
    // Emitted at the call site to build the default subject of a top level
    // invocation, beside the program body rather than inside it.
    charge(program.subjectNode);
  }
  for (const capture of [...program.captures].sort((left, right) => right.node - left.node)) {
    if (!covered.has(capture.node)) {
      charge(capture.node);
    }
  }
  return total;
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
