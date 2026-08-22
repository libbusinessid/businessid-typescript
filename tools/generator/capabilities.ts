/**
 * The frozen capability registry of `features.md`.
 *
 * A capability id designates an exact and frozen set of operations, fields,
 * bounds and semantics. Ids are never renumbered or reused, and a bundle
 * declaring a single id this engine does not know is `incompatible_ruleset`.
 */
export const CAPABILITY_NAMES: ReadonlyMap<number, string> = new Map([
  [1, "CORE_GRAPH_V1"],
  [2, "ASCII_AND_WHITESPACE_V1"],
  [3, "CANONICALIZATION_BASIC_V1"],
  [4, "CANONICALIZATION_CONDITIONAL_V1"],
  [5, "IDENTIFIER_DISPATCH_V1"],
  [10, "STRING_VIEWS_V1"],
  [11, "CAPTURES_AND_CALLS_V1"],
  [20, "FORMAT_ASSERTIONS_V1"],
  [21, "PROFILES_V1"],
  [30, "CHECKSUM_TRISTATE_V1"],
  [31, "CHECKSUM_LUHN_V1"],
  [32, "CHECKSUM_MOD97_V1"],
  [33, "CHECKSUM_WEIGHTED_V1"],
  [34, "CHECKSUM_COMPARE_CONSTANT_V1"],
  [35, "CHECKSUM_INTEGER_PREDICATE_V1"],
  [40, "PROVENANCE_V1"],
  [41, "PROVENANCE_TIER_V1"],
  [42, "CHECKSUM_CUSTOM_ALPHABET_V1"],
]);

/** Every capability id this engine implements. */
export const SUPPORTED_CAPABILITIES: ReadonlySet<number> = new Set(CAPABILITY_NAMES.keys());

/** Capability ids referenced by name, for the checks that own a bundle level construct. */
export const CAPABILITY = {
  CORE_GRAPH_V1: 1,
  ASCII_AND_WHITESPACE_V1: 2,
  CANONICALIZATION_BASIC_V1: 3,
  CANONICALIZATION_CONDITIONAL_V1: 4,
  IDENTIFIER_DISPATCH_V1: 5,
  STRING_VIEWS_V1: 10,
  CAPTURES_AND_CALLS_V1: 11,
  FORMAT_ASSERTIONS_V1: 20,
  PROFILES_V1: 21,
  CHECKSUM_TRISTATE_V1: 30,
  CHECKSUM_LUHN_V1: 31,
  CHECKSUM_MOD97_V1: 32,
  CHECKSUM_WEIGHTED_V1: 33,
  CHECKSUM_COMPARE_CONSTANT_V1: 34,
  CHECKSUM_INTEGER_PREDICATE_V1: 35,
  PROVENANCE_V1: 40,
  PROVENANCE_TIER_V1: 41,
  CHECKSUM_CUSTOM_ALPHABET_V1: 42,
} as const;
