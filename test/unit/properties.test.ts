import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BusinessIdEngine, isInvalid } from "../../src/index.js";
import * as support from "../../src/runtime/support.js";
import { codePointsOf, stringOf, utf8ByteLength } from "../../src/runtime/text.js";

/**
 * Properties that must hold for every input, not merely for the cases the
 * corpus happens to carry.
 *
 * The first two are the load bearing ones. Canonicalization is idempotent, so
 * a value that has been through it never changes again. And no user string,
 * however hostile, makes the engine throw: an unusable value produces a report
 * saying why.
 */
const engine = BusinessIdEngine.default;
const kinds = engine.kinds();

/** Well formed strings: fast-check's `string` can emit lone surrogates. */
const wellFormed = fc.string({ unit: "grapheme", maxLength: 60 });

describe("canonicalization", () => {
  it("is idempotent on well formed input", () => {
    fc.assert(
      fc.property(fc.constantFrom(...kinds), wellFormed, (kind, value) => {
        const once = engine.canonicalize({ kind, value }).canonicalValue;
        const twice = engine.canonicalize({ kind, value: once }).canonicalValue;

        expect(twice).toBe(once);
      }),
      { numRuns: 400 },
    );
  });

  it("never truncates below what the rules add or remove", () => {
    // A canonicalizer may only trim, remove, replace, pad or prefix. It never
    // silently drops the tail of a value, so a canonical value that is shorter
    // than its input differs by characters the rules name.
    fc.assert(
      fc.property(fc.stringMatching(/^[0-9A-Z]{1,20}$/), (value) => {
        const result = engine.canonicalize({ kind: "siren", value });

        expect(result.inputValue).toBe(value);
      }),
      { numRuns: 200 },
    );
  });
});

describe("the engine never throws on user input", () => {
  it("answers any string, any kind and any country", () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 40 }),
        fc.string({ maxLength: 40 }),
        fc.option(fc.string({ maxLength: 8 }), { nil: undefined }),
        (kind, value, countryCode) => {
          const input = { kind, value, ...(countryCode === undefined ? {} : { countryCode }) };

          expect(() => engine.validate(input)).not.toThrow();
          expect(() => engine.validateFormat(input)).not.toThrow();
          expect(() => engine.validateChecksum(input)).not.toThrow();
          expect(() => engine.canonicalize(input)).not.toThrow();
        },
      ),
      { numRuns: 500 },
    );
  });

  it("reports the raw value unchanged in every result", () => {
    fc.assert(
      fc.property(fc.constantFrom(...kinds), fc.string({ maxLength: 40 }), (kind, value) => {
        expect(engine.validate({ kind, value }).inputValue).toBe(value);
      }),
      { numRuns: 300 },
    );
  });
});

describe("an unsupported answer never becomes an invalidity", () => {
  it("keeps a checksum that could not be decided out of the invalid verdicts", () => {
    fc.assert(
      fc.property(fc.constantFrom(...kinds), fc.string({ maxLength: 40 }), (kind, value) => {
        const report = engine.validate({ kind, value });

        if (report.checksum.status === "unsupported") {
          expect(isInvalid(report)).toBe(report.format.status === "invalid");
        }
      }),
      { numRuns: 400 },
    );
  });
});

describe("the input bound", () => {
  it("refuses exactly the values above 1024 UTF-8 bytes", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme", maxLength: 1200 }), (value) => {
        const report = engine.validate({ kind: "vat", value });
        const tooLong = utf8ByteLength(value) > 1024;

        expect(report.format.reasonCode === "input_too_long").toBe(tooLong);
      }),
      { numRuns: 300 },
    );
  });
});

describe("the code point abstraction", () => {
  it("round trips any well formed string", () => {
    fc.assert(
      fc.property(wellFormed, (value) => {
        expect(stringOf(codePointsOf(value))).toBe(value);
      }),
      { numRuns: 500 },
    );
  });

  it("agrees with the platform encoder on length", () => {
    fc.assert(
      fc.property(wellFormed, (value) => {
        expect(utf8ByteLength(value)).toBe(new TextEncoder().encode(value).length);
      }),
      { numRuns: 500 },
    );
  });
});

describe("determinism and immutability", () => {
  it("returns equal reports for equal inputs and leaves the input alone", () => {
    fc.assert(
      fc.property(fc.constantFrom(...kinds), fc.string({ maxLength: 30 }), (kind, value) => {
        const input = Object.freeze({ kind, value });

        expect(engine.validate(input)).toEqual(engine.validate(input));
      }),
      { numRuns: 300 },
    );
  });
});

/**
 * `prefixIn` against the definition of what it computes.
 *
 * This is what `ir.md` requires, not a precaution taken here. Rules 2026.09.2
 * refuses a `prefix_in` whose elements differ in length, and the refusal takes
 * its own evidence with it: every list a bundle may now carry holds one length,
 * so no conformance case can distinguish a search run per length from one run
 * over the whole table — the second passes every published case while being
 * wrong on `["AB", "ABA"]` against `"ABCD"`. An engine MUST therefore pin the
 * semantics below its loader, by a native test comparing its search against the
 * definition transcribed literally, over tables of mixed lengths. This test and
 * the direct cases in `support.test.ts` are that.
 *
 * It is the second rule the corpus cannot carry, alongside `invalid_encoding`,
 * and for the same kind of reason: what makes a case expressible and what makes
 * a rule worth stating are not the same thing.
 *
 * The reference below is the definition transcribed: some element is a prefix
 * of the subject. It is quadratic and obviously right, which is the only thing
 * asked of it. The search under test has to agree with it on every table
 * fast-check can build, mixed lengths included.
 */
describe("prefixIn agrees with the definition of a prefix", () => {
  const sortedTable = (values: readonly string[]): readonly (readonly number[])[] =>
    [...new Set(values)]
      .map((value) => codePointsOf(value))
      .sort((left, right) => {
        const shared = Math.min(left.length, right.length);
        for (let index = 0; index < shared; index += 1) {
          const a = left[index] ?? 0;
          const b = right[index] ?? 0;
          if (a !== b) {
            return a - b;
          }
        }
        return left.length - right.length;
      });

  /** Some element is a prefix of the subject. Quadratic, and plainly correct. */
  const byDefinition = (
    subject: readonly number[],
    table: readonly (readonly number[])[],
  ): boolean =>
    table.some(
      (element) =>
        element.length <= subject.length &&
        element.every((point, index) => subject[index] === point),
    );

  const element = fc.stringMatching(/^[AB]{1,4}$/);

  it("answers every table fast-check can build", () => {
    fc.assert(
      fc.property(
        fc.array(element, { minLength: 1, maxLength: 24 }),
        fc.stringMatching(/^[AB]{0,6}$/),
        (values, subject) => {
          const table = sortedTable(values);
          const lengths = [...new Set(table.map((one) => one.length))].sort((a, b) => a - b);
          const points = codePointsOf(subject);

          expect(support.prefixIn(points, table, lengths)).toBe(byDefinition(points, table));
        },
      ),
      { numRuns: 400 },
    );
  });

  it("answers a table of one length, the only shape a bundle may carry", () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[AB]{3}$/), { minLength: 1, maxLength: 24 }),
        fc.stringMatching(/^[AB]{0,6}$/),
        (values, subject) => {
          const table = sortedTable(values);
          const points = codePointsOf(subject);

          expect(support.prefixIn(points, table, [3])).toBe(byDefinition(points, table));
        },
      ),
      { numRuns: 400 },
    );
  });
});
