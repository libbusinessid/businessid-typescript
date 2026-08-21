/**
 * Load time validation: the 24 checks of `ir.md` section 10, in order.
 *
 * The order carries meaning and is not an implementation detail. Two points
 * matter above the rest.
 *
 * Decoding stays at the wire level. Check 2 proves the bytes parse and nothing
 * more: an unresolved opcode is carried to check 10, an unknown field to check
 * 5, and an unrecognised enum value to the check that owns its field. An engine
 * that resolved any of them while decoding would report a newer bundle as
 * malformed at check 2, before the capability check could excuse it.
 *
 * The version checks precede the unknown field scan. A bundle built against a
 * later version holds fields this runtime has never heard of; reporting those
 * as unknown fields would call a legitimate version gap a forged bundle.
 * Asking first whether the bundle announces something unsupported yields the
 * accurate answer, and tells an operator to upgrade rather than to suspect the
 * file.
 *
 * Note that `engine.md` section 7.3 lists an older 18 check order that puts the
 * unknown field scan before the version checks. `ir.md` section 10 is the
 * exhaustive and later revision, states the reasoning above explicitly, and
 * governs here.
 */
import type { LoadedBundle } from "./ir.js";
import { build } from "./load/build.js";
import { checkDefinitions } from "./load/definitions.js";
import { checkDispatchers } from "./load/dispatchers.js";
import { checkCallGraph, checkCapabilities } from "./load/graph.js";
import { checkEnvelope } from "./load/header.js";
import { checkOperations } from "./load/operations.js";
import { checkProgramShapes } from "./load/programs.js";

/**
 * Validates a bundle and builds the representation the engine executes.
 *
 * The bytes are treated as untrusted: every check and every limit applies, and
 * nothing is executed until all of them have passed.
 *
 * @throws BundleError with `invalid_ruleset` when the bundle is malformed, or
 * `incompatible_ruleset` when it announces a format version or a capability
 * this build does not implement.
 */
export function loadBundle(bytes: Uint8Array): LoadedBundle {
  /* 1 to 9: the envelope */
  const { bundle, declared, programsById } = checkEnvelope(bytes);

  /* 10 to 13: what each node says it does */
  const resolved = checkOperations(bundle);

  /* 14 and 15: what each program is shaped like */
  checkProgramShapes(bundle, resolved);

  /* 16 and 17: identifier definitions */
  const definitions = checkDefinitions(bundle, programsById);

  /* 18 to 22: routing */
  const dispatchers = checkDispatchers(bundle, definitions, programsById);

  /* 23: the call graph */
  checkCallGraph(bundle, resolved, programsById);

  /* 24: no capability used without being declared */
  checkCapabilities(bundle, resolved, declared);

  return build(bundle, resolved, definitions, dispatchers);
}
