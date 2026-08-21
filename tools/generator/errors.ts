/**
 * The error the generator raises when it refuses a bundle.
 *
 * This lives with the generator, not with the engine. The published package
 * never loads a bundle, so it can never raise this: refusal is a property of
 * generation time, and by construction the emitted code contains nothing it
 * does not understand.
 */

/** Why a bundle was refused. */
export type BundleErrorReason = "invalid_ruleset" | "incompatible_ruleset";

/**
 * A bundle the generator refuses to emit code for.
 *
 * `incompatible_ruleset` means the bundle announces something this generator
 * does not know — an unsupported `format_version` or an unknown capability id —
 * and tells an operator to upgrade. `invalid_ruleset` means the bundle is
 * malformed, which is a different problem with a different answer.
 */
export class BundleError extends Error {
  /** Whether the bundle is malformed or merely newer than this generator. */
  readonly reason: BundleErrorReason;

  /** The load time check of `ir.md` section 10 that refused the bundle. */
  readonly check: number;

  constructor(reason: BundleErrorReason, check: number, message: string) {
    super(`${reason} (check ${String(check)}): ${message}`);
    this.name = "BundleError";
    this.reason = reason;
    this.check = check;
  }
}

/**
 * An invariant the generator itself broke.
 *
 * Reaching this means a bundle passed all twenty five checks and then asked the
 * emitter for something those checks should have refused. It is a defect in the
 * generator, not in the bundle, which is why it is not a `BundleError`.
 */
export class GeneratorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeneratorError";
  }
}
