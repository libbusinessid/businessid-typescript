import type { IdentifierKind } from "./kind.js";
import type { ValidationProfile } from "./profile.js";

/** One identifier submitted for canonicalization or validation. */
export type IdentifierInput = Readonly<{
  /** The kind of identifier. Unknown tokens report `unsupported_kind`. */
  kind: IdentifierKind;
  /** The raw value, reported unchanged in every result. */
  value: string;
  /** Optional country context. A proven conflict reports `country_mismatch`. */
  countryCode?: string;
}>;

/**
 * Caller options.
 *
 * `profile` is optional on purpose. Leaving it out is what lets the selected
 * definition's `default_profile` apply, which `ir.md` section 5.2 makes
 * meaningful; passing `compatible` explicitly overrides that default and is
 * therefore not the same request.
 */
export type ValidationOptions = Readonly<{
  profile?: ValidationProfile;
}>;
