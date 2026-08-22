/**
 * The shape of a generated rules module.
 *
 * The generator emits exactly this: a function per program, a switch per
 * dispatch decision, and read only tables. Naming the shape lets the pipeline
 * be written once against it, and lets a test drive freshly generated rules
 * through the same code the package ships.
 *
 * A rule set is *code*, produced at build time. Nothing here reads bytes, so
 * there is no way to obtain one at run time and no public API that accepts one.
 */
import type { ValidationProfile } from "../domain/profile.js";
import type { AssertionResult, ChecksumOutcome } from "./values.js";

/** A generated rules module. */
export interface RuleSet {
  /** The business version of the rules. */
  readonly RULES_VERSION: string;
  /** The structural version of the IR they were generated from. */
  readonly FORMAT_VERSION: number;
  /** The capability ids the rules required of their generator, ascending. */
  readonly CAPABILITIES: readonly number[];
  /** Every kind token the rules route, canonical kinds and aliases alike. */
  readonly KINDS: readonly string[];

  /** The dispatcher a normalized kind token selects, or -1. */
  dispatcherOf: (kind: string) => number;
  /** The canonical kind of a dispatcher. */
  canonicalKindOf: (dispatcher: number) => string;
  /** Runs the pre-canonicalization program of a dispatcher, exactly once. */
  preCanonicalize: (dispatcher: number, value: readonly number[]) => readonly number[];
  /** Normalizes a country token through the alias table of a dispatcher. */
  aliasCountry: (dispatcher: number, country: string) => string;
  /** The definition a country selects within a dispatcher, or -1. */
  definitionForCountry: (dispatcher: number, country: string) => number;
  /** The definition the longest accepted prefix of a value selects, or -1. */
  definitionForPrefix: (dispatcher: number, value: readonly number[]) => number;
  /** The GLOBAL target of a dispatcher, or -1. */
  globalDefinitionOf: (dispatcher: number) => number;
  /** The single target selectable with neither country nor prefix, or -1. */
  implicitDefinitionOf: (dispatcher: number) => number;

  /** The country a definition reports, absent for a GLOBAL definition. */
  countryOf: (definition: number) => string | undefined;
  /** The profile a definition applies when the caller states none. */
  profileOf: (definition: number) => ValidationProfile;
  /** Runs the canonicalization program of a definition, exactly once. */
  canonicalizeWith: (
    definition: number,
    value: readonly number[],
    profile: ValidationProfile,
  ) => readonly number[];
  /** Runs the format rule of a definition on its canonical value. */
  checkFormat: (
    definition: number,
    value: readonly number[],
    profile: ValidationProfile,
  ) => AssertionResult;
  /** Runs the checksum rule of a definition, or reports why none applies. */
  checkChecksum: (
    definition: number,
    value: readonly number[],
    profile: ValidationProfile,
  ) => ChecksumOutcome;
}
