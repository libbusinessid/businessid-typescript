import type { IdentifierKind } from "./kind.js";
import type { ValidationProfile } from "./profile.js";
import type { ReasonCode } from "./reason-code.js";
import type { StepStatus, ValidationLevel } from "./status.js";

/** The resolved outcome of one validation level. */
export type StepResult = Readonly<{
  level: ValidationLevel;
  status: StepStatus;
  reasonCode: ReasonCode;
  /**
   * The stable key of the rule that produced this result.
   *
   * Absent for every result produced before a rule assertion runs — the input
   * bound, dispatch, and the `not_run` reasons. A declared key is never empty.
   */
  messageKey?: string;
}>;

/** Fields every report shares, whatever the operation. */
type ReportIdentity = Readonly<{
  kind: IdentifierKind;
  /** The raw input, never modified. */
  inputValue: string;
  canonicalValue: string;
  countryCode?: string;
  profile: ValidationProfile;
  rulesVersion: string;
  formatVersion: number;
  engineVersion: string;
}>;

/** The report returned by `validate`, `validateFormat` and `validateChecksum`. */
export type ValidationReport = ReportIdentity &
  Readonly<{
    format: StepResult;
    checksum: StepResult;
  }>;

/** The result returned by `canonicalize`. */
export type CanonicalizationResult = ReportIdentity &
  Readonly<{
    status: StepStatus;
    reasonCode: ReasonCode;
    messageKey?: string;
  }>;

/** True when the format step succeeded. */
export function isFormatValid(report: ValidationReport): boolean {
  return report.format.status === "valid";
}

/** True when the checksum step succeeded. */
export function isChecksumValid(report: ValidationReport): boolean {
  return report.checksum.status === "valid";
}

/**
 * True when both steps succeeded.
 *
 * There is deliberately no plain `isValid`: a valid format with an unsupported
 * checksum is neither fully validated nor invalid, so a single boolean would
 * have to lie about one of them.
 */
export function isFullyValidated(report: ValidationReport): boolean {
  return isFormatValid(report) && isChecksumValid(report);
}

/** True when at least one step that ran proved an invalidity. */
export function isInvalid(report: ValidationReport): boolean {
  return report.format.status === "invalid" || report.checksum.status === "invalid";
}
