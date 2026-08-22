/**
 * Compatibility profiles.
 *
 * `compatible` accepts current variants and the historical ones still
 * documented as legitimate; `strict_current` is opt-in and accepts only
 * variants currently issued.
 */
export const VALIDATION_PROFILES = ["compatible", "strict_current"] as const;

/** A compatibility profile. */
export type ValidationProfile = (typeof VALIDATION_PROFILES)[number];

/**
 * The profile dispatch runs under when the caller states none.
 *
 * A caller who states no profile is not the same as one who states
 * `compatible`: `ir.md` section 5.2 makes the absence what lets a definition's
 * `default_profile` apply once it has been selected. This constant is the
 * dispatch phase fallback only, and never fills in for the caller.
 */
export const DISPATCH_DEFAULT_PROFILE: ValidationProfile = "compatible";
