import { describe, expect, it } from "vitest";
import * as support from "../../src/runtime/support.js";
import { codePointsOf, stringOf } from "../../src/runtime/text.js";
import type { ChecksumOutcome } from "../../src/runtime/values.js";

/**
 * The primitives the generated rules call.
 *
 * The conformance run exercises these through the rules that ship, which covers
 * what those rules happen to use. These tests cover the primitives themselves,
 * including the paths no current rule reaches: a message key on a checksum, the
 * ordering `ALL_CHECKS` and `ANY_CHECK` promise, and every way a view can be
 * absent or an integer indeterminate.
 */
const cp = (value: string): number[] => codePointsOf(value);
const text = (value: readonly number[] | undefined): string | undefined =>
  value === undefined ? undefined : stringOf(value);

describe("string views", () => {
  it("yields absence rather than a clamped view", () => {
    expect(support.slice(cp("ABCD"), 1, 3)).toEqual(cp("BC"));
    expect(support.slice(cp("ABCD"), 1, 9)).toBeUndefined();
    expect(support.slice(cp("ABCD"), 3, 1)).toBeUndefined();
    expect(support.slice(undefined, 0, 1)).toBeUndefined();
    expect(support.sliceFrom(cp("ABCD"), 9)).toBeUndefined();
    expect(support.sliceTo(cp("ABCD"), 9)).toBeUndefined();
    expect(support.sliceFrom(undefined, 0)).toBeUndefined();
    expect(support.sliceTo(undefined, 0)).toBeUndefined();
  });

  it("splits on the first occurrence only", () => {
    expect(text(support.beforeFirst(cp("FR.12.3"), cp(".")))).toBe("FR");
    expect(text(support.afterFirst(cp("FR.12.3"), cp(".")))).toBe("12.3");
    expect(support.beforeFirst(cp("FR123"), cp("."))).toBeUndefined();
    expect(support.afterFirst(cp("FR123"), cp("."))).toBeUndefined();
    expect(support.beforeFirst(undefined, cp("."))).toBeUndefined();
    // An empty needle occurs nowhere: the IR requires a non empty constant.
    expect(support.beforeFirst(cp("ABC"), [])).toBeUndefined();
  });

  it("strips only an exact leading prefix", () => {
    expect(text(support.stripPrefix(cp("FR123"), cp("FR")))).toBe("123");
    expect(support.stripPrefix(cp("BE123"), cp("FR"))).toBeUndefined();
    expect(support.stripPrefix(undefined, cp("FR"))).toBeUndefined();
  });

  it("concatenates, and is absent when any operand is", () => {
    expect(text(support.concat([cp("AB"), cp("CD")]))).toBe("ABCD");
    expect(support.concat([cp("AB"), undefined])).toBeUndefined();
  });

  it("concatenates a long view without spreading it as arguments", () => {
    // A spread call would pass every code point as an argument and blow the
    // argument limit, where the IR says the result is simply a longer string.
    const long = new Array<number>(200_000).fill(0x41);

    expect(support.concat([long, long])?.length).toBe(400_000);
  });
});

describe("predicates", () => {
  it("reads absence as false everywhere but the question about absence", () => {
    expect(support.isEmpty(undefined)).toBe(false);
    expect(support.isEmpty([])).toBe(true);
    expect(support.equals(undefined, cp("A"))).toBe(false);
    expect(support.equals(cp("A"), undefined)).toBe(false);
    expect(support.equals(cp("AB"), cp("A"))).toBe(false);
    expect(support.equals(cp("AB"), cp("AB"))).toBe(true);
    expect(support.lengthIn(undefined, [0])).toBe(false);
    expect(support.lengthBetween(undefined, 0, 9)).toBe(false);
    expect(support.startsWith(undefined, cp("A"))).toBe(false);
    expect(support.endsWith(undefined, cp("A"))).toBe(false);
    expect(support.contains(undefined, cp("A"))).toBe(false);
    expect(support.prefixIn(undefined, [cp("A")])).toBe(false);
    expect(support.charAtIn(undefined, 0, () => true)).toBe(false);
    expect(support.charsetAll(undefined, () => true)).toBe(false);
  });

  it("refuses a prefix or suffix longer than the view", () => {
    expect(support.startsWith(cp("A"), cp("AB"))).toBe(false);
    expect(support.endsWith(cp("A"), cp("AB"))).toBe(false);
  });

  it("requires a non empty view for every character class", () => {
    expect(support.asciiDigits([])).toBe(false);
    expect(support.asciiUpperLetters([])).toBe(false);
    expect(support.asciiAlphanumeric([])).toBe(false);
    expect(support.asciiDigits(cp("12"))).toBe(true);
    expect(support.asciiUpperLetters(cp("AB"))).toBe(true);
    // Digits and upper letters only: lower case is outside the IR class.
    expect(support.asciiAlphanumeric(cp("A1"))).toBe(true);
    expect(support.asciiAlphanumeric(cp("a1"))).toBe(false);
  });
});

describe("integers", () => {
  it("is indeterminate on an absent, empty or non digit view", () => {
    expect(support.digitsToInteger(undefined)).toBeUndefined();
    expect(support.digitsToInteger([])).toBeUndefined();
    expect(support.digitsToInteger(cp("1A"))).toBeUndefined();
    expect(support.modDigits(undefined, 97n)).toBeUndefined();
    expect(support.modDigits([], 97n)).toBeUndefined();
    expect(support.modDigits(cp("1A"), 97n)).toBeUndefined();
  });

  it("takes a remainder past any integer width", () => {
    const long = "9".repeat(60);

    expect(support.modDigits(cp(long), 97n)).toBe(BigInt(long) % 97n);
  });

  it("maps code points under each mapping", () => {
    expect(support.digitValue(0x39)).toBe(9);
    expect(support.digitValue(0x41)).toBeUndefined();
    expect(support.base36Value(0x39)).toBe(9);
    expect(support.base36Value(0x41)).toBe(10);
    expect(support.base36Value(0x2d)).toBeUndefined();
  });

  it("pairs weights three ways", () => {
    const digits = cp("123");

    expect(support.weightedSumLeft(digits, [2n, 3n], support.digitValue)).toBe(8n);
    expect(support.weightedSumRight(digits, [2n, 3n], support.digitValue)).toBe(13n);
    expect(support.weightedSumCycle(digits, [2n, 3n], support.digitValue)).toBe(14n);
  });

  it("is indeterminate on an absent, empty or unmappable view", () => {
    for (const sum of [
      support.weightedSumLeft,
      support.weightedSumRight,
      support.weightedSumCycle,
    ]) {
      expect(sum(undefined, [1n], support.digitValue)).toBeUndefined();
      expect(sum([], [1n], support.digitValue)).toBeUndefined();
      // A code point outside the domain, even where no weight pairs with it.
      expect(sum(cp("1X"), [1n], support.digitValue)).toBeUndefined();
    }
  });

  it("keeps a modulo in range and propagates indeterminacy", () => {
    expect(support.modulo(-5n, 97n)).toBe(92n);
    expect(support.modulo(undefined, 97n)).toBeUndefined();
    expect(support.complement(12n, 97n)).toBe(85n);
    expect(support.complement(undefined, 97n)).toBeUndefined();
    expect(support.complement(-1n, 97n)).toBeUndefined();
    expect(support.complement(98n, 97n)).toBeUndefined();
    expect(support.remainderMap(1n, [5n, 6n])).toBe(6n);
    expect(support.remainderMap(undefined, [5n])).toBeUndefined();
    expect(support.remainderMap(-1n, [5n])).toBeUndefined();
    expect(support.remainderMap(9n, [5n])).toBeUndefined();
  });
});

describe("canonicalization steps", () => {
  it("never truncates and never fails", () => {
    expect(text(support.trimWhitespace(cp("  AB  ")))).toBe("AB");
    // A value with nothing to trim is returned as it arrived.
    expect(text(support.trimWhitespace(cp("AB")))).toBe("AB");
    expect(text(support.removeWhitespace(cp("A B")))).toBe("AB");
    expect(text(support.upperCaseAscii(cp("aBé")))).toBe("ABé");
    expect(text(support.removeChars(cp("1.2"), (point) => point === 0x2e))).toBe("12");
    expect(text(support.replacePrefix(cp("GR1"), cp("GR"), cp("EL")))).toBe("EL1");
    expect(text(support.replacePrefix(cp("FR1"), cp("GR"), cp("EL")))).toBe("FR1");
    expect(text(support.prepend(cp("1"), cp("FR")))).toBe("FR1");
    expect(text(support.append(cp("1"), cp("Z")))).toBe("1Z");
    expect(text(support.insert(cp("14"), 1, cp("-")))).toBe("1-4");
    expect(text(support.insert(cp("14"), 9, cp("-")))).toBe("14");
    expect(text(support.leftPad(cp("1"), 3, 0x30))).toBe("001");
    expect(text(support.leftPad(cp("1234"), 2, 0x30))).toBe("1234");
  });

  it("prepends a prefix only when the value carries none the target accepts", () => {
    expect(text(support.prependIfMissing(cp("EL1"), [cp("EL"), cp("GR")], cp("EL")))).toBe("EL1");
    expect(text(support.prependIfMissing(cp("1"), [cp("EL"), cp("GR")], cp("EL")))).toBe("EL1");
  });
});

describe("checksums", () => {
  const key = "rule.key";

  it("turns a comparison into an outcome, with or without a message key", () => {
    expect(support.verdict(true)).toMatchObject({ status: "valid", reasonCode: "ok" });
    expect(support.verdict(false)).toMatchObject({
      status: "invalid",
      reasonCode: "invalid_checksum",
    });
    expect(support.verdict(undefined)).toBe(support.UNSUPPORTED_CHECKSUM);
    expect(support.verdict(true, key)).toMatchObject({ status: "valid", messageKey: key });
    expect(support.verdict(false, key)).toMatchObject({ status: "invalid", messageKey: key });
    expect(support.verdict(undefined, key)).toMatchObject({
      status: "unsupported",
      messageKey: key,
    });
  });

  it("applies Luhn to a value whose rightmost digit is the check digit", () => {
    // 79927398713 is the algorithm's canonical example.
    expect(support.luhn(cp("79927398713"))).toBe(true);
    expect(support.luhn(cp("79927398714"))).toBe(false);
    expect(support.luhn(undefined)).toBeUndefined();
    expect(support.luhn(cp("7"))).toBeUndefined();
    expect(support.luhn(cp("7992739871X"))).toBeUndefined();
  });

  it("applies ISO 7064 MOD 97-10 over digits and letters", () => {
    // The IBAN example published by SWIFT, rearranged as the check requires.
    expect(support.iso7064Mod97(cp("WEST12345698765432GB82"))).toBe(true);
    expect(support.iso7064Mod97(cp("WEST12345698765432GB83"))).toBe(false);
    expect(support.iso7064Mod97(undefined)).toBeUndefined();
    expect(support.iso7064Mod97(cp("AB"))).toBeUndefined();
    expect(support.iso7064Mod97(cp("WEST-1"))).toBeUndefined();
  });

  it("compares against a digit, a slice or a constant", () => {
    expect(support.comparedDigit(2n, cp("122"), 2)).toBe(true);
    expect(support.comparedDigit(2n, cp("123"), 2)).toBe(false);
    expect(support.comparedDigit(undefined, cp("122"), 2)).toBeUndefined();
    expect(support.comparedDigit(2n, cp("12X"), 2)).toBeUndefined();
    expect(support.comparedDigit(2n, cp("12"), 9)).toBeUndefined();
    expect(support.comparedSlice(12n, cp("1212"), 2, 4)).toBe(true);
    expect(support.comparedSlice(13n, cp("1212"), 2, 4)).toBe(false);
    expect(support.comparedSlice(undefined, cp("1212"), 2, 4)).toBeUndefined();
    expect(support.comparedSlice(12n, cp("1212"), 2, 9)).toBeUndefined();
    expect(support.comparedSlice(12n, cp("1212"), 2, 2)).toBeUndefined();
    expect(support.comparedSlice(12n, cp("12X2"), 2, 4)).toBeUndefined();
    expect(support.comparedConstant(3n, 3n)).toBe(true);
    expect(support.comparedConstant(4n, 3n)).toBe(false);
    expect(support.comparedConstant(undefined, 3n)).toBeUndefined();
  });

  it("orders ALL_CHECKS so that unsupported never becomes invalid", () => {
    const valid: ChecksumOutcome = { status: "valid", reasonCode: "ok" };
    const invalid: ChecksumOutcome = { status: "invalid", reasonCode: "invalid_checksum" };
    const unsupported = support.UNSUPPORTED_CHECKSUM;

    expect(support.allChecks([valid, valid]).status).toBe("valid");
    expect(support.allChecks([unsupported, invalid]).status).toBe("invalid");
    expect(support.allChecks([valid, unsupported]).status).toBe("unsupported");
    expect(support.allChecks([]).status).toBe("valid");
  });

  it("orders ANY_CHECK so that a single valid operand wins", () => {
    const valid: ChecksumOutcome = { status: "valid", reasonCode: "ok" };
    const invalid: ChecksumOutcome = { status: "invalid", reasonCode: "invalid_checksum" };
    const unsupported = support.UNSUPPORTED_CHECKSUM;

    expect(support.anyCheck([invalid, valid]).status).toBe("valid");
    expect(support.anyCheck([invalid, unsupported]).status).toBe("unsupported");
    expect(support.anyCheck([invalid, invalid]).status).toBe("invalid");
    expect(support.anyCheck([]).status).toBe("unsupported");
  });
});

describe("prefix matching", () => {
  it("reads the head of a value as a string, or nothing", () => {
    expect(support.prefixString(cp("FR123"), 2)).toBe("FR");
    expect(support.prefixString(cp("F"), 2)).toBeUndefined();
    // A declared prefix is ASCII, so a non ASCII head simply matches nothing.
    expect(support.prefixString(cp("é1"), 2)).toBe("é1");
  });
});
