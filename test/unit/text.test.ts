import { describe, expect, it } from "vitest";
import {
  WHITESPACE_V1,
  codePointsOf,
  hasLoneSurrogate,
  isAsciiAlphanumericCodePoint,
  isAsciiDigit,
  isAsciiUpperLetter,
  isWhitespaceV1,
  stringOf,
  trimAsciiSpace,
  upperCaseAscii,
  utf8ByteLength,
} from "../../src/runtime/text.js";

describe("code point handling", () => {
  it("iterates astral characters as single code points", () => {
    // U+1D400 MATHEMATICAL BOLD CAPITAL A is two UTF-16 units but one code point.
    const value = "A\u{1D400}B";

    expect(value.length).toBe(4);
    expect(codePointsOf(value)).toEqual([0x41, 0x1d400, 0x42]);
  });

  it("round trips a string through its code points", () => {
    const value = "EL\u{1D400}0123";

    expect(stringOf(codePointsOf(value))).toBe(value);
  });
});

describe("utf8ByteLength", () => {
  it.each([
    ["", 0],
    ["A", 1],
    ["é", 2],
    ["€", 3],
    ["\u{1D400}", 4],
    ["BE0123456749", 12],
  ])("measures %o as %i bytes", (value, expected) => {
    expect(utf8ByteLength(value)).toBe(expected);
  });

  it.each([
    // The exact code points where the UTF-8 width changes. A comparison that
    // is off by one here mis-measures the 1024 byte input bound.
    ["\u007F", 1],
    ["\u0080", 2],
    ["\u07FF", 2],
    ["\u0800", 3],
    ["\uFFFF", 3],
    ["\u{10000}", 4],
    ["\u{10FFFF}", 4],
  ])("measures the width boundary %o as %i bytes", (value, expected) => {
    expect(utf8ByteLength(value)).toBe(expected);
    expect(utf8ByteLength(value)).toBe(new TextEncoder().encode(value).length);
  });

  it("agrees with TextEncoder on well formed input", () => {
    const value = "FR 12 345 678 901 — é€\u{1D400}";

    expect(utf8ByteLength(value)).toBe(new TextEncoder().encode(value).length);
  });
});

describe("hasLoneSurrogate", () => {
  it("accepts a well formed surrogate pair", () => {
    expect(hasLoneSurrogate("\u{1D400}")).toBe(false);
  });

  it.each([
    ["high surrogate alone", "\uD83D"],
    ["low surrogate alone", "\uDE00"],
    ["high surrogate followed by a letter", "\uD83DA"],
    ["low surrogate before a high one", "\uDE00\uD83D"],
  ])("rejects a %s", (_name, value) => {
    expect(hasLoneSurrogate(value)).toBe(true);
  });
});

describe("whitespace_v1", () => {
  it("contains exactly the frozen table", () => {
    const expected = [
      0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003,
      0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f,
      0x3000, 0xfeff,
    ];

    expect([...WHITESPACE_V1].sort((a, b) => a - b)).toEqual(expected);
  });

  it("excludes code points the runtime would call whitespace", () => {
    // U+200B ZERO WIDTH SPACE is not in the frozen table, and U+180E is
    // whitespace in some Unicode versions but never in whitespace_v1.
    expect(isWhitespaceV1(0x200b)).toBe(false);
    expect(isWhitespaceV1(0x180e)).toBe(false);
  });

  it("is the class the canonicalization steps use", () => {
    // The table is exercised end to end by TRIM_WHITESPACE and
    // REMOVE_WHITESPACE in test/unit/ir-canonicalization.test.ts. Here the
    // membership itself is what matters: a runtime must never delegate this
    // definition to its own Unicode tables, whose versions differ.
    expect([...WHITESPACE_V1].every((point) => isWhitespaceV1(point))).toBe(true);
  });
});

describe("trimAsciiSpace", () => {
  it("trims only U+0009..U+000D and U+0020", () => {
    expect(trimAsciiSpace("\t\n\v\f\r vat \r ")).toBe("vat");
    expect(trimAsciiSpace(" vat ")).toBe(" vat ");
  });
});

describe("upperCaseAscii", () => {
  it("maps only a..z", () => {
    expect(upperCaseAscii("be0123abz")).toBe("BE0123ABZ");
  });

  it("leaves non ASCII letters untouched", () => {
    // A locale aware uppercase would turn ß into SS, and a Turkish locale
    // would turn i into İ. Neither is allowed here.
    expect(upperCaseAscii("stra\u00dfe i")).toBe("STRA\u00dfE I");
  });
});

describe("ASCII classes", () => {
  const all = (value: string, accepts: (point: number) => boolean): boolean =>
    codePointsOf(value).every(accepts);

  it.each([
    ["0123456789", true],
    ["12a", false],
    // Fullwidth digits are digits to a Unicode table, never to this class.
    ["\uFF11\uFF12\uFF13", false],
  ])("isAsciiDigit over %o is %s", (value, expected) => {
    expect(all(value, isAsciiDigit)).toBe(expected);
  });

  it.each([
    ["ABZ", true],
    ["AbZ", false],
    ["A1", false],
  ])("isAsciiUpperLetter over %o is %s", (value, expected) => {
    expect(all(value, isAsciiUpperLetter)).toBe(expected);
  });

  it.each([
    ["A1Z", true],
    ["0", true],
    ["A-1", false],
    // ir.md restricts the IR class to digits and upper letters. Lower case is
    // alphanumeric in ordinary usage but not here, and accepting it would let a
    // value pass a check another engine refuses.
    ["A1z", false],
  ])("isAsciiAlphanumericCodePoint over %o is %s", (value, expected) => {
    expect(all(value, isAsciiAlphanumericCodePoint)).toBe(expected);
  });
});
