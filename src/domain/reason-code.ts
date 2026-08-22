/**
 * The immutable V1 registry of machine readable reasons.
 *
 * The list and the status each reason may carry are normative: `ir.md`
 * section 4 owns them, and `rules.proto` carries the same set as
 * `REASON_CODE_*`. Engines may add a technical error type but never a business
 * reason code.
 */
export const REASON_CODES = [
  "ok",
  "empty",
  "invalid_length",
  "invalid_characters",
  "invalid_format",
  "invalid_checksum",
  "missing_country_code",
  "country_mismatch",
  "unsupported_kind",
  "unsupported_country",
  "unsupported_format",
  "unsupported_checksum",
  "checksum_not_published",
  "not_requested",
  "not_run_format_invalid",
  "not_run_format_unsupported",
  "registry_not_configured",
  "incompatible_ruleset",
  "invalid_ruleset",
  "input_too_long",
  "invalid_encoding",
] as const;

/** A machine readable reason attached to a validation step. */
export type ReasonCode = (typeof REASON_CODES)[number];

/**
 * Reasons that prove an invalidity, and are therefore the only ones an
 * `invalid` status may carry.
 *
 * `ir.md` section 4 restricts `REQUIRE` to this set.
 */
export const INVALIDITY_REASON_CODES = [
  "empty",
  "invalid_length",
  "invalid_characters",
  "invalid_format",
  "country_mismatch",
] as const;

/** Reasons an absent checksum may report, per `ir.md` section 4. */
export const ABSENT_CHECKSUM_REASON_CODES = [
  "unsupported_checksum",
  "checksum_not_published",
] as const;
