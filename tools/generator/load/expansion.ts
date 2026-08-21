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
 * Three details decide whether two generators agree on the same bundle, and
 * `ir.md` section 2 states all three.
 *
 * The count starts at the roots a generator emits from and follows operands. A
 * node no root reaches is emitted by nobody and counts for nothing: counting
 * every node instead would refuse bundles any generator can emit.
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
} from "../../../generated/libbusinessid/ir/v1/rules_pb.js";
import { LIMITS } from "../limits.js";
import { invalid } from "./diagnostics.js";

/** Where the count stops. Anything at this value has already left the budget. */
const CEILING = LIMITS.stepsPerValidation + 1;

function saturatingAdd(left: number, right: number): number {
  const total = left + right;
  return total > CEILING ? CEILING : total;
}

/** Adds a node and everything it reads to a set. */
function reach(program: ProtoProgram, index: number, into: Set<number>): void {
  if (into.has(index)) {
    return;
  }
  into.add(index);
  for (const input of program.nodes[index]?.inputNodes ?? []) {
    reach(program, input, into);
  }
}

/**
 * The number of operation instances a program expands to when inlined.
 *
 * Operand indices are strictly lower than the node that reads them, proved by
 * check 11, so one ascending pass computes every cost without recursion.
 */
export function expansionOf(program: ProtoProgram): number {
  const fromRoot = new Set<number>();
  reach(program, program.rootNode, fromRoot);

  const emitted = new Set<number>(fromRoot);
  for (const capture of program.captures) {
    reach(program, capture.node, emitted);
  }

  const cost = new Array<number>(program.nodes.length).fill(0);
  for (let index = 0; index < program.nodes.length; index += 1) {
    if (!emitted.has(index)) {
      continue;
    }
    let total = 1;
    for (const input of program.nodes[index]?.inputNodes ?? []) {
      total = saturatingAdd(total, cost[input] ?? 0);
    }
    cost[index] = total;
  }

  let total = cost[program.rootNode] ?? 0;
  for (const capture of program.captures) {
    // A capture reference is lowered to a direct node reference before the
    // bundle exists, so a capture the root already reaches is emitted once, as
    // part of the root. Only one the root does not reach would add anything,
    // and no program in the shipped bundle has one.
    if (!fromRoot.has(capture.node)) {
      total = saturatingAdd(total, cost[capture.node] ?? 0);
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
