/**
 * The normative limits of `ir.md` section 8.
 *
 * An engine may raise an internal limit, never lower it. The bundle shaped
 * limits are enforced when a bundle is accepted; the user input limit is an
 * obligation of every call.
 */
export const LIMITS = {
  /** Maximum size of a bundle, in bytes. */
  bundleBytes: 16_777_216,
  /** Maximum number of identifier definitions in a bundle. */
  identifiers: 10_000,
  /** Maximum number of nodes across every program of a bundle. */
  totalNodes: 500_000,
  /** Maximum number of nodes in one program. */
  nodesPerProgram: 4_096,
  /** Maximum static depth of the call graph. */
  callDepth: 32,
  /** Maximum size of a constant string, in UTF-8 bytes. */
  constantBytes: 4_096,
  /** Maximum size of a user supplied value, in UTF-8 bytes. */
  inputBytes: 1_024,
  /** Evaluation budget of one public operation, in steps. */
  stepsPerValidation: 100_000,
  /** Produced code points billed as one further step. */
  codePointsPerStep: 64,
  /** Maximum number of captures declared by one format program. */
  capturesPerFormat: 128,
  /** Maximum length of `rules_version`, in bytes. */
  rulesVersionBytes: 64,
  /** Exact length of a digest field, in bytes. */
  digestBytes: 32,
} as const;

/** The arithmetic bounds of `ir.md` section 8. */
export const ARITHMETIC = {
  /** Inclusive bounds of a modulus or a complement. */
  modulus: { min: 2n, max: 1_000_000_000n },
  /** Inclusive bounds of the absolute value of a weight. */
  weightAbsolute: { min: 0n, max: 1_000_000n },
  /** Inclusive bounds of the number of weights of one operation. */
  weightCount: { min: 1, max: 256 },
  /** Inclusive bounds of the number of entries of a remainder map. */
  remainderCount: { min: 1, max: 1_000_000 },
  /** Inclusive bounds of an index or a slice bound. */
  index: { min: 0, max: 4_096 },
  /** Inclusive bounds of a comparison constant. */
  comparisonConstant: { min: -1_000_000_000n, max: 1_000_000_000n },
  /** Inclusive bounds of the number of operands of a concat. */
  concatOperands: { min: 1, max: 256 },
  /** Inclusive bounds of the provable digit count of `digits_to_integer`. */
  digitsToInteger: { min: 1, max: 18 },
  /** Inclusive bounds of the size of a custom alphabet, whose points are distinct. */
  alphabetCodePoints: { min: 1, max: 256 },
  /** Inclusive bounds of a signed 64 bit integer. */
  int64: { min: -(2n ** 63n), max: 2n ** 63n - 1n },
} as const;

/** The IR format versions this engine understands. */
export const SUPPORTED_FORMAT_VERSIONS: ReadonlySet<number> = new Set([1]);
