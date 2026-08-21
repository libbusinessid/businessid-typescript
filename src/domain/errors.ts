/**
 * Technical errors.
 *
 * Ordinary user input never throws: it produces a report. Only a bundle that
 * cannot be executed, or an invariant the engine itself broke, is an error
 * (`engine.md` section 6).
 */

/** Why a bundle was refused. */
export type BundleErrorReason = "invalid_ruleset" | "incompatible_ruleset";

/**
 * A bundle the engine refuses to execute.
 *
 * `incompatible_ruleset` means the bundle announces something this build does
 * not know — an unsupported `format_version` or an unknown capability id — and
 * tells an operator to upgrade. `invalid_ruleset` means the bundle is
 * malformed, which is a different problem with a different answer.
 */
export class BundleError extends Error {
  /** Whether the bundle is malformed or merely newer than this engine. */
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
 * An invariant the engine itself broke.
 *
 * Reaching this means a bundle passed load time validation and then asked for
 * something the validation should have refused. It is never a verdict on the
 * identifier being validated.
 */
export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineError";
  }
}
