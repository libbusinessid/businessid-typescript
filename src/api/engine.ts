import { RULES_BUNDLE_BYTES } from "../assets/rules.generated.js";
import { ENGINE_VERSION } from "../assets/version.generated.js";
import type { IdentifierInput, ValidationOptions } from "../domain/input.js";
import type { CanonicalizationResult, ValidationReport } from "../domain/result.js";
import { loadBundle } from "../runtime/load.js";
import type { LoadedBundle } from "../runtime/ir.js";
import { execute } from "../runtime/pipeline.js";
import {
  type RegistryInput,
  type RegistryLookupOptions,
  type RegistryProvider,
  type RegistryResult,
  registryNotConfigured,
} from "../registry/provider.js";

/** What a bundle announces about itself. */
export type RulesInfo = Readonly<{
  rulesVersion: string;
  formatVersion: number;
  engineVersion: string;
}>;

let defaultEngine: BusinessIdEngine | undefined;

/**
 * An engine bound to one rule bundle.
 *
 * Immutable once constructed and safe to share. Ordinary user input never
 * throws: an unusable value produces a report saying why. Only a bundle that
 * cannot be executed throws, and it throws when the engine is built rather
 * than when a value is validated.
 */
export class BusinessIdEngine {
  readonly #bundle: LoadedBundle;

  private constructor(bundle: LoadedBundle) {
    this.#bundle = bundle;
  }

  /**
   * The engine bound to the bundle this package ships.
   *
   * Decoded at most once per process, on first use. No network request and no
   * filesystem read is involved, so this works unchanged in a browser.
   */
  static get default(): BusinessIdEngine {
    defaultEngine ??= new BusinessIdEngine(loadBundle(RULES_BUNDLE_BYTES));
    return defaultEngine;
  }

  /**
   * Builds an engine from bundle bytes.
   *
   * The bytes are treated as untrusted: every load time check and every limit
   * applies.
   *
   * @throws BundleError when the bundle is malformed or announces something
   * this build does not implement.
   */
  static fromRules(bytes: Uint8Array): BusinessIdEngine {
    return new BusinessIdEngine(loadBundle(bytes));
  }

  /** What the loaded bundle announces about itself. */
  rulesInfo(): RulesInfo {
    return {
      rulesVersion: this.#bundle.rulesVersion,
      formatVersion: this.#bundle.formatVersion,
      engineVersion: ENGINE_VERSION,
    };
  }

  /** The capability ids the loaded bundle requires, ascending. */
  capabilities(): readonly number[] {
    return [...this.#bundle.capabilities].sort((left, right) => left - right);
  }

  /** Every kind token this bundle routes, canonical kinds and aliases alike. */
  kinds(): readonly string[] {
    return [...this.#bundle.kindIndex.keys()].sort();
  }

  /** Canonicalizes a value without running format or checksum rules. */
  canonicalize(input: IdentifierInput, options?: ValidationOptions): CanonicalizationResult {
    return execute(
      this.#bundle,
      ENGINE_VERSION,
      "canonicalize",
      input,
      options,
    ) as CanonicalizationResult;
  }

  /** Runs format and, when the format is valid, checksum. */
  validate(input: IdentifierInput, options?: ValidationOptions): ValidationReport {
    return execute(this.#bundle, ENGINE_VERSION, "validate", input, options) as ValidationReport;
  }

  /**
   * Runs the format step only.
   *
   * Still returns a complete report: on a valid format the checksum step is
   * `not_run` with `not_requested`, never omitted.
   */
  validateFormat(input: IdentifierInput, options?: ValidationOptions): ValidationReport {
    return execute(
      this.#bundle,
      ENGINE_VERSION,
      "validateFormat",
      input,
      options,
    ) as ValidationReport;
  }

  /**
   * Runs the checksum step, with the format step as its guard.
   *
   * Returns exactly the report `validate` returns for the same input. The
   * separate name exists for readability, never to bypass the format step.
   */
  validateChecksum(input: IdentifierInput, options?: ValidationOptions): ValidationReport {
    return execute(
      this.#bundle,
      ENGINE_VERSION,
      "validateChecksum",
      input,
      options,
    ) as ValidationReport;
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
