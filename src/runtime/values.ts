/**
 * The typed values an IR program manipulates.
 *
 * Strings are held as code point arrays rather than JavaScript strings. Every
 * length, index and slice of the IR is counted in code points, and a string
 * indexed in UTF-16 units answers those questions wrongly the moment a value
 * leaves the BMP. Converting once at the boundary makes the whole interpreter
 * correct by construction instead of correct by remembering.
 */
import type { ReasonCode } from "../domain/reason-code.js";

/** A possibly absent string view, held as code points. */
export type StringValue = readonly number[] | undefined;

/** A checked integer that may be indeterminate. */
export type IntegerValue = bigint | undefined;

/** The tri-state result of a checksum node. */
export type ChecksumOutcome = Readonly<{
  status: "valid" | "invalid" | "unsupported";
  reasonCode: ReasonCode;
  messageKey?: string;
}>;

/**
 * A `WHEN` branch whose predicate is false.
 *
 * Distinct from any outcome: `CHOOSE` skips a non applicable branch and falls
 * through to the next, which is not the same as receiving an `unsupported`
 * outcome it would have to return.
 */
export const NOT_APPLICABLE = Symbol("not applicable");

/** What evaluating a checksum node yields. */
export type ChecksumResult = ChecksumOutcome | typeof NOT_APPLICABLE;

/** The result of an assertion node. */
export type AssertionResult =
  | Readonly<{ failed: false }>
  | Readonly<{ failed: true; reasonCode: ReasonCode; messageKey?: string }>;

/** The assertion result of a rule that raised no objection. */
export const ASSERTION_PASSED: AssertionResult = { failed: false };

/** The outcome every indeterminate checksum computation collapses to. */
export const CHECKSUM_UNSUPPORTED: ChecksumOutcome = {
  status: "unsupported",
  reasonCode: "unsupported_checksum",
};
