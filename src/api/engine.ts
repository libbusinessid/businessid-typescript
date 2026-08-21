import { ENGINE_VERSION } from "../assets/version.generated.js";
import type { IdentifierInput, ValidationOptions } from "../domain/input.js";
import type { CanonicalizationResult, ValidationReport } from "../domain/result.js";
import * as rules from "../rules.generated.js";
import type { RuleSet } from "../runtime/ruleset.js";
import { execute } from "../runtime/pipeline.js";
import {
  type RegistryInput,
  type RegistryLookupOptions,
  type RegistryProvider,
  type RegistryResult,
  registryNotConfigured,
} from "../registry/provider.js";

/** What a bundle announces about itself. */
/** The generated rules this package ships, seen through their contract. */
const ruleSet: RuleSet = rules;

/** What a rule set announces about itself. */
export type RulesInfo = Readonly<{
  rulesVersion: string;
  formatVersion: number;
  engineVersion: string;
}>;

/**
 * The engine.
 *
 * The rules are code: a generator read the bundle when this package was built,
 * applied every load time check, and emitted what you are calling. Nothing here
 * decodes anything, so there is no factory taking bundle bytes — a custom rule
 * set goes through the generator, at build time.
 *
 * Immutable and safe to share. Ordinary user input never throws: an unusable
 * value produces a report saying why.
 */
export class BusinessIdEngine {
  /**
   * The engine bound to the rules this package ships.
   *
   * Nothing is decoded, fetched or read from a file, so this works unchanged in
   * a browser and costs nothing at start-up.
   */
  static readonly default: BusinessIdEngine = new BusinessIdEngine();

  /** What the generated rules announce about themselves. */
  rulesInfo(): RulesInfo {
    return {
      rulesVersion: ruleSet.RULES_VERSION,
      formatVersion: ruleSet.FORMAT_VERSION,
      engineVersion: ENGINE_VERSION,
    };
  }

  /** The capability ids the rules required of their generator, ascending. */
  capabilities(): readonly number[] {
    return ruleSet.CAPABILITIES;
  }

  /** Every kind token these rules route, canonical kinds and aliases alike. */
  kinds(): readonly string[] {
    return ruleSet.KINDS;
  }

  /** Canonicalizes a value without running format or checksum rules. */
  canonicalize(input: IdentifierInput, options?: ValidationOptions): CanonicalizationResult {
    return execute(
      ruleSet,
      ENGINE_VERSION,
      "canonicalize",
      input,
      options,
    ) as CanonicalizationResult;
  }

  /** Runs format and, when the format is valid, checksum. */
  validate(input: IdentifierInput, options?: ValidationOptions): ValidationReport {
    return execute(ruleSet, ENGINE_VERSION, "validate", input, options) as ValidationReport;
  }

  /**
   * Runs the format step only.
   *
   * Still returns a complete report: on a valid format the checksum step is
   * `not_run` with `not_requested`, never omitted.
   */
  validateFormat(input: IdentifierInput, options?: ValidationOptions): ValidationReport {
    return execute(ruleSet, ENGINE_VERSION, "validateFormat", input, options) as ValidationReport;
  }

  /**
   * Runs the checksum step, with the format step as its guard.
   *
   * Returns exactly the report `validate` returns for the same input. The
   * separate name exists for readability, never to bypass the format step.
   */
  validateChecksum(input: IdentifierInput, options?: ValidationOptions): ValidationReport {
    return execute(ruleSet, ENGINE_VERSION, "validateChecksum", input, options) as ValidationReport;
  }

  /**
   * Asks a registry about an identifier.
   *
   * V1 ships no provider. Without one the answer is `registry_not_configured`,
   * which is an absence of knowledge and never an invalidity.
   */
  async registryLookup(
    input: RegistryInput,
    provider: RegistryProvider | undefined,
    options?: RegistryLookupOptions,
  ): Promise<RegistryResult> {
    if (provider?.supports(input.kind, input.countryCode) !== true) {
      // The moment the engine answered. Validation never reads a clock; a
      // registry answer legitimately records when it was observed.
      return registryNotConfigured(input.canonicalValue, new Date().toISOString());
    }
    return provider.lookup(input, options);
  }
}
