/**
 * The generator.
 *
 * It reads a rule bundle, applies the twenty five load time checks of `ir.md`
 * section 10, and emits TypeScript. It refuses to produce anything it does not
 * fully understand: an unknown version, field, opcode or capability stops it,
 * which is why the published engine can never meet one.
 *
 * Nothing here ships. The package carries the emitted code and the primitives
 * it calls.
 */
import { type EmitOptions, emitModule } from "./emit/module.js";
import { loadBundle } from "./load.js";

/** What the generator produced from one bundle. */
export interface Generated {
  /** The rules module source. */
  source: string;
  /** Every kind token the rules route, canonical kinds and aliases alike. */
  kinds: readonly string[];
  rulesVersion: string;
  formatVersion: number;
  capabilities: readonly number[];
}

/**
 * Validates a bundle and emits the rules module.
 *
 * @throws BundleError when any of the twenty five checks refuses the bundle.
 */
export function generate(bytes: Uint8Array, options: EmitOptions = {}): Generated {
  const bundle = loadBundle(bytes);
  const { source, kinds } = emitModule(bundle, options);
  return {
    source,
    kinds,
    rulesVersion: bundle.rulesVersion,
    formatVersion: bundle.formatVersion,
    capabilities: [...bundle.capabilities].sort((left, right) => left - right),
  };
}

export type { EmitOptions } from "./emit/module.js";
export { BundleError, type BundleErrorReason, GeneratorError } from "./errors.js";
