/**
 * Load time validation: the 25 checks of `ir.md` section 10, in order.
 *
 * The order carries meaning and is not an implementation detail. Two points
 * matter above the rest.
 *
 * Decoding stays at the wire level. Check 2 proves the bytes parse and nothing
 * more: an unresolved opcode is carried to check 10, an unknown field to check
 * 5, and an unrecognised enum value to the check that owns its field. A
 * generator that resolved any of them while decoding would report a newer
 * bundle as malformed at check 2, before the capability check could excuse it.
 *
 * The version checks precede the unknown field scan. A bundle built against a
 * later version holds fields this generator has never heard of; reporting those
 * as unknown fields would call a legitimate version gap a forged bundle.
 * Asking first whether the bundle announces something unsupported yields the
 * accurate answer, and tells an operator to upgrade rather than to suspect the
 * file.
 */
import type { LoadedBundle } from "./ir.js";

/**
 * How many checks `ir.md` section 10 enumerates.
 *
 * Stated here rather than copied into whatever needs it: a renumbering that
 * left a stale bound behind in the fuzz harness is what put this constant here.
 */
export const LOAD_CHECK_COUNT = 25;
import { build } from "./load/build.js";
import { checkDefinitions } from "./load/definitions.js";
import { checkDispatchers } from "./load/dispatchers.js";
import { checkExpansion } from "./load/expansion.js";
import { checkCallGraph, checkCapabilities } from "./load/graph.js";
import { checkEnvelope } from "./load/header.js";
import { checkOperations } from "./load/operations.js";
import { checkProgramShapes } from "./load/programs.js";

/**
 * Validates a bundle and builds the representation the emitter reads.
 *
 * The bytes are treated as untrusted: every check and every limit applies, and
 * nothing is emitted until all of them have passed. Refusal is a property of
 * generation time, which is why the published engine can never meet a
 * construct it does not understand.
 *
 * @throws BundleError with `invalid_ruleset` when the bundle is malformed, or
 * `incompatible_ruleset` when it announces a format version or a capability
 * this generator does not implement.
 */
export function loadBundle(bytes: Uint8Array): LoadedBundle {
  /* 1 to 9: the envelope */
  const { bundle, declared, programsById } = checkEnvelope(bytes);

  /* 10 to 13: what each node says it does */
  const resolved = checkOperations(bundle);

  /* 14: what each program expands to once repeated operands are inlined */
  checkExpansion(bundle);

  /* 15 and 16: what each program is shaped like */
  checkProgramShapes(bundle, resolved);

  /* 17 and 18: identifier definitions */
  const definitions = checkDefinitions(bundle, programsById);

  /* 19 to 23: routing */
  const dispatchers = checkDispatchers(bundle, definitions, programsById);

  /* 24: the call graph */
  checkCallGraph(bundle, resolved, programsById);

  /* 25: no capability used without being declared */
  checkCapabilities(bundle, resolved, declared);

  return build(bundle, resolved, definitions, dispatchers);
}
