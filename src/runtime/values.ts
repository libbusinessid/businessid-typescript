/**
 * The values the generated rules produce.
 *
 * Strings are held as code point arrays. Every length, index and slice the IR
 * defines is counted in code points, and a JavaScript string indexed in UTF-16
 * units answers those questions wrongly the moment a value leaves the BMP.
 * Converting once at the boundary makes the whole engine correct by
 * construction instead of correct by remembering.
 */
import type { ReasonCode } from "../domain/reason-code.js";

/**
 * A possibly absent string view, held as code points.
 *
 * Absence propagates: every constructor applied to an absent operand yields an
 * absent result, and every predicate reading one yields false except the one
 * that asks about absence. Absence is never an error.
 */
export type StringValue = readonly number[] | undefined;

/**
 * A checked integer that may be indeterminate.
 *
 * An indeterminate integer propagates through every operation and makes the
 * enclosing checksum `unsupported`. It never produces `invalid`.
 */
export type IntegerValue = bigint | undefined;

/** The tri-state result of a checksum rule. */
export type ChecksumOutcome = Readonly<{
  status: "valid" | "invalid" | "unsupported";
  reasonCode: ReasonCode;
  messageKey?: string;
}>;

/** The result of a format rule. */
export type AssertionResult =
  | Readonly<{ failed: false }>
  | Readonly<{ failed: true; reasonCode: ReasonCode; messageKey?: string }>;
