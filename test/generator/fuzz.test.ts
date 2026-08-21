import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { RULES_BUNDLE_BYTES } from "./bundle-bytes.js";
import { BundleError } from "../../tools/generator/errors.js";
import { generate } from "../../tools/generator/generate.js";

/**
 * Fuzzing of the generator.
 *
 * The contract is narrow and absolute: arbitrary bytes either produce a rules
 * module or raise a `BundleError`. Nothing else is acceptable — not a crash,
 * not an unbounded allocation, not a `TypeError` escaping from the decoder, and
 * above all not code emitted from a bundle that only half validated.
 *
 * The mutation corpus starts from the official bundle, because bytes that are
 * almost valid reach far deeper into the checks than random noise does.
 */
/**
 * How many cases each property runs.
 *
 * CI runs a smoke budget on every push and a far longer one on a schedule,
 * which is what `FUZZ_RUNS` raises.
 */
const budget = Number(process.env["FUZZ_RUNS"] ?? "0");
const runs = (smoke: number): number => (budget > 0 ? budget : smoke);

function attempt(payload: Uint8Array): void {
  try {
    generate(payload);
  } catch (error) {
    if (error instanceof BundleError) {
      expect(["invalid_ruleset", "incompatible_ruleset"]).toContain(error.reason);
      expect(error.check).toBeGreaterThanOrEqual(1);
      expect(error.check).toBeLessThanOrEqual(24);
      return;
    }
    throw error;
  }
}

describe("arbitrary bytes", () => {
  it("never escape as anything but a BundleError", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 512 }), (payload) => {
        attempt(payload);
      }),
      { numRuns: runs(1500) },
    );
  });
});

describe("mutations of the official bundle", () => {
  const original = RULES_BUNDLE_BYTES;

  it("survive a single flipped byte", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: original.length - 1 }),
        fc.integer({ min: 0, max: 255 }),
        (offset, value) => {
          const mutated = original.slice();
          mutated[offset] = value;
          attempt(mutated);
        },
      ),
      { numRuns: runs(800) },
    );
  });

  it("survive truncation at any point", () => {
    fc.assert(
      fc.property(fc.nat({ max: original.length }), (length) => {
        attempt(original.slice(0, length));
      }),
      { numRuns: runs(400) },
    );
  });

  it("survive arbitrary trailing bytes", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 32 }), (extra) => {
        const grown = new Uint8Array(original.length + extra.length);
        grown.set(original);
        grown.set(extra, original.length);
        attempt(grown);
      }),
      { numRuns: runs(300) },
    );
  });

  it("survive a spliced out run of bytes", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: original.length - 1 }),
        fc.integer({ min: 1, max: 64 }),
        (offset, length) => {
          const spliced = new Uint8Array([
            ...original.slice(0, offset),
            ...original.slice(offset + length),
          ]);
          attempt(spliced);
        },
      ),
      { numRuns: runs(400) },
    );
  });
});
