/**
 * The bound on how much code one program may expand to.
 *
 * The emitter inlines: a node referenced twice is emitted twice, which keeps
 * the short-circuit of `ALL`, `ANY` and the assertion sequence exactly where
 * the IR puts it. Across the shipped bundle that costs almost nothing — 2375
 * nodes expand to 3069 instances, the largest program reaching 118 — but a
 * bundle where each node reads the previous one twice expands exponentially.
 *
 * Such a bundle passes every load time check, so the generator is what must
 * refuse it. The bound is the evaluation budget of `ir.md` section 8: a
 * generated program may not carry more expression instances than the number of
 * steps an interpreter would have been given to run it once. Refusing is the
 * right answer rather than emitting less faithful code, and it is a property of
 * generation time, where refusal belongs.
 */
import { BundleError } from "../errors.js";
import type { IrProgram, LoadedBundle } from "../ir.js";
import { LIMITS } from "../limits.js";

/** The number of expression instances a program expands to when inlined. */
export function expansionOf(program: IrProgram): number {
  const cost = new Array<number>(program.nodes.length).fill(0);
  for (const [index, node] of program.nodes.entries()) {
    let total = 1;
    for (const input of node.inputs) {
      total += cost[input] ?? 0;
      if (total > LIMITS.stepsPerValidation) {
        return Number.POSITIVE_INFINITY;
      }
    }
    cost[index] = total;
  }
  return cost[program.rootNode] ?? 0;
}

/** Refuses a bundle whose programs cannot be emitted within the bound. */
export function checkExpansion(bundle: LoadedBundle): void {
  for (const program of bundle.programs.values()) {
    const expanded = expansionOf(program);
    if (expanded > LIMITS.stepsPerValidation) {
      throw new BundleError(
        "invalid_ruleset",
        9,
        `program ${String(program.id)} expands to more expression instances than the evaluation budget of ${String(LIMITS.stepsPerValidation)} allows`,
      );
    }
  }
}
