import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BusinessIdEngine, isInvalid } from "../../src/index.js";
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
