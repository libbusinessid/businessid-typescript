/**
 * EntID — offline canonicalization, format and checksum validation of business
 * identifiers.
 *
 * The engine states what a documented rule proves and nothing more. A valid
 * format means the shape matches a documented variant; a valid checksum means
 * the documented internal check passes. Neither says a company exists, is
 * active, or belongs to anyone: that needs a registry, which this version does
 * not query.
 *
 * When no applicable rule can decide, the answer is `unsupported`, never
 * `invalid`. Refusing a valid identifier is the most serious defect this
 * project recognises.
 *
 * Every operation is synchronous and always will be. Consulting a company
 * register is a different operation, deferred to a later version, and it will
 * arrive in a separate server-only entry point rather than by making these
 * asynchronous: a lookup carries an API token, which must never be reachable
 * from a browser.
 *
 * @example
 * ```ts
 * import { EntIdEngine } from "@entid/entid";
 *
 * const report = EntIdEngine.default.validate({
 *   kind: "vat",
 *   value: "BE 0123.456.749",
 * });
 * report.canonicalValue;      // "BE0123456749"
 * report.format.status;       // "valid"
 * report.checksum.status;     // "valid"
 * ```
 *
 * @packageDocumentation
 */

export { EntIdEngine, type RulesInfo } from "./api/engine.js";

export type { IdentifierInput, ValidationOptions } from "./domain/input.js";
export type { IdentifierKind, KnownIdentifierKind } from "./domain/kind.js";
export { KNOWN_IDENTIFIER_KINDS } from "./domain/kind.js";
export { VALIDATION_PROFILES, type ValidationProfile } from "./domain/profile.js";
export { REASON_CODES, type ReasonCode } from "./domain/reason-code.js";
export {
  STEP_STATUSES,
  type StepStatus,
  VALIDATION_LEVELS,
  type ValidationLevel,
} from "./domain/status.js";
export {
  type CanonicalizationResult,
  isChecksumValid,
  isFormatValid,
  isFullyValidated,
  isInvalid,
  type StepResult,
  type ValidationReport,
} from "./domain/result.js";
