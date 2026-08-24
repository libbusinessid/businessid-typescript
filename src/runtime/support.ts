/**
 * The primitives the generated rules call.
 *
 * This is the whole of the runtime the published package carries. There is no
 * interpreter here and no bundle: the rules are already code by the time this
 * package exists, and what remains is the handful of operations that code needs
 * — string views, character classes, checked arithmetic and the two published
 * checksum algorithms.
 *
 * Two rules run through everything. Absence propagates: every string
 * constructor applied to an absent view yields an absent result, and every
 * predicate reading one yields false. An indeterminate integer propagates too,
 * and makes the enclosing checksum `unsupported` — never `invalid`, because
 * refusing a valid identifier is the most serious defect this project
 * recognises.
 *
 * Integers are `bigint` throughout. The IR permits values up to `int64`, and
 * `number` is exact only to 2^53, so arbitrary precision is what keeps every
 * computation exact without a per-expression proof.
 */
import { isAsciiDigit, isAsciiLowerLetter, isAsciiUpperLetter, isWhitespaceV1 } from "./text.js";
import type { AssertionResult, ChecksumOutcome, IntegerValue, StringValue } from "./values.js";

/** The result a rule that raised no objection returns. */
export const PASSED: AssertionResult = Object.freeze({ failed: false });

/** The outcome every indeterminate checksum computation collapses to. */
export const UNSUPPORTED_CHECKSUM: ChecksumOutcome = Object.freeze({
  status: "unsupported",
  reasonCode: "unsupported_checksum",
});

/* -------------------------------------------------------------------------- */
/* String views                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The code points of `value` in `[start, end)`.
 *
 * Absent when a bound falls outside the view. Clamping instead would hand the
 * rule a different substring than the one it asked for.
 */
export function slice(value: StringValue, start: number, end: number): StringValue {
  if (value === undefined || start > end || end > value.length) {
    return undefined;
  }
  return value.slice(start, end);
}

/** The code points of `value` from `start` to the end. */
export function sliceFrom(value: StringValue, start: number): StringValue {
  return value === undefined || start > value.length ? undefined : value.slice(start);
}

/** The code points of `value` before `end`. */
export function sliceTo(value: StringValue, end: number): StringValue {
  return value === undefined || end > value.length ? undefined : value.slice(0, end);
}

/** The part of `value` before the first occurrence of `needle`. */
export function beforeFirst(value: StringValue, needle: readonly number[]): StringValue {
  const at = indexOf(value, needle);
  return value === undefined || at < 0 ? undefined : value.slice(0, at);
}

/** The part of `value` after the first occurrence of `needle`. */
export function afterFirst(value: StringValue, needle: readonly number[]): StringValue {
  const at = indexOf(value, needle);
  return value === undefined || at < 0 ? undefined : value.slice(at + needle.length);
}

/** `value` without its exact leading `prefix`. */
export function stripPrefix(value: StringValue, prefix: readonly number[]): StringValue {
  return value === undefined || !startsWith(value, prefix) ? undefined : value.slice(prefix.length);
}

/** The operands joined in order, absent when any of them is. */
export function concat(parts: readonly StringValue[]): StringValue {
  const out: number[] = [];
  for (const part of parts) {
    if (part === undefined) {
      return undefined;
    }
    // Appended one at a time rather than spread: a spread call passes every
    // element as an argument, and a long enough view would exceed the argument
    // limit and throw where the IR says the result is simply a longer string.
    for (const point of part) {
      out.push(point);
    }
  }
  return out;
}

function indexOf(value: StringValue, needle: readonly number[]): number {
  if (value === undefined || needle.length === 0) {
    return -1;
  }
  for (let start = 0; start + needle.length <= value.length; start += 1) {
    let matched = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (value[start + offset] !== needle[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return start;
    }
  }
  return -1;
}

/* -------------------------------------------------------------------------- */
/* Predicates                                                                 */
/* -------------------------------------------------------------------------- */

/** True when the view is present and holds no code point. */
export function isEmpty(value: StringValue): boolean {
  return value?.length === 0;
}

/** True when both views are present and hold the same code points. */
export function equals(left: StringValue, right: StringValue): boolean {
  if (left === undefined || right?.length !== left.length) {
    return false;
  }
  return left.every((point, index) => right[index] === point);
}

/** True when the view is present and its length is one of `lengths`. */
export function lengthIn(value: StringValue, lengths: readonly number[]): boolean {
  return value !== undefined && lengths.includes(value.length);
}

/** True when the view is present and its length lies in `[min, max]`. */
export function lengthBetween(value: StringValue, min: number, max: number): boolean {
  return value !== undefined && value.length >= min && value.length <= max;
}

/** True when the view is present, non empty and made only of `0..9`. */
export function asciiDigits(value: StringValue): boolean {
  return nonEmptyEvery(value, isAsciiDigit);
}

/** True when the view is present, non empty and made only of `A..Z`. */
export function asciiUpperLetters(value: StringValue): boolean {
  return nonEmptyEvery(value, isAsciiUpperLetter);
}

/**
 * True when the view is present, non empty and made only of `0..9` and `A..Z`.
 *
 * Lower case is alphanumeric in ordinary usage but not in this class:
 * canonicalization is what upper cases a value before such a check runs.
 */
export function asciiAlphanumeric(value: StringValue): boolean {
  return nonEmptyEvery(value, isAsciiAlnum);
}

/** True when the view is present, non empty and every code point is accepted. */
export function charsetAll(value: StringValue, accepts: (point: number) => boolean): boolean {
  return nonEmptyEvery(value, accepts);
}

/** True when the code point at `index` exists and is accepted. */
export function charAtIn(
  value: StringValue,
  index: number,
  accepts: (point: number) => boolean,
): boolean {
  const point = value?.[index];
  return point !== undefined && accepts(point);
}

/** True when the view is present and starts with `prefix`. */
export function startsWith(value: StringValue, prefix: readonly number[]): boolean {
  if (value === undefined || prefix.length > value.length) {
    return false;
  }
  return prefix.every((point, index) => value[index] === point);
}

/** True when the view is present and ends with `suffix`. */
export function endsWith(value: StringValue, suffix: readonly number[]): boolean {
  if (value === undefined || suffix.length > value.length) {
    return false;
  }
  const offset = value.length - suffix.length;
  return suffix.every((point, index) => value[offset + index] === point);
}

/** True when the view is present and starts with one of `prefixes`. */
export function prefixIn(
  value: StringValue,
  prefixes: readonly (readonly number[])[],
  lengths: readonly number[],
): boolean {
  if (value === undefined) {
    return false;
  }
  // `lengths` is the distinct element lengths of `prefixes`, ascending, so the
  // first one past the value ends the search.
  for (const length of lengths) {
    if (length > value.length) {
      return false;
    }
    if (holdsPrefixOfLength(value, prefixes, length)) {
      return true;
    }
  }
  return false;
}

/**
 * Whether the first `length` code points of `value` are in `prefixes`.
 *
 * `ir.md` states `values` is sorted and deduplicated by the compiler, and check
 * 13 refuses a bundle where it is not, so the list can be searched rather than
 * scanned. An element is a prefix of the value exactly when it equals the
 * value's opening of its own length, which is why the question is asked once
 * per distinct element length rather than once for the value: over
 * `["AB", "ABA"]` the element nearest `"ABCD"` is `"ABA"`, which is not a
 * prefix of it, while `"AB"` is.
 */
function holdsPrefixOfLength(
  value: readonly number[],
  prefixes: readonly (readonly number[])[],
  length: number,
): boolean {
  let low = 0;
  let high = prefixes.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const order = compareOpening(prefixes[middle] ?? [], value, length);
    if (order === 0) {
      return true;
    }
    if (order < 0) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return false;
}

/** Orders `entry` against the first `length` code points of `value`. */
function compareOpening(
  entry: readonly number[],
  value: readonly number[],
  length: number,
): number {
  const shared = Math.min(entry.length, length);
  for (let index = 0; index < shared; index += 1) {
    const left = entry[index] ?? 0;
    const right = value[index] ?? 0;
    if (left !== right) {
      return left < right ? -1 : 1;
    }
  }
  if (entry.length === length) {
    return 0;
  }
  return entry.length < length ? -1 : 1;
}

/** True when the view is present and contains `needle`. */
export function contains(value: StringValue, needle: readonly number[]): boolean {
  return indexOf(value, needle) >= 0;
}

function nonEmptyEvery(value: StringValue, accepts: (point: number) => boolean): boolean {
  return value !== undefined && value.length > 0 && value.every(accepts);
}

function isAsciiAlnum(point: number): boolean {
  return isAsciiDigit(point) || isAsciiUpperLetter(point);
}

/* -------------------------------------------------------------------------- */
/* Integers                                                                   */
/* -------------------------------------------------------------------------- */

/** The numeric contribution of an ASCII digit. */
export function digitValue(point: number): number | undefined {
  return isAsciiDigit(point) ? point - 0x30 : undefined;
}

/** The numeric contribution of a code point in base 36, `0..9` then `A..Z`. */
export function base36Value(point: number): number | undefined {
  if (isAsciiDigit(point)) {
    return point - 0x30;
  }
  return isAsciiUpperLetter(point) ? point - 0x41 + 10 : undefined;
}

/**
 * `value` read as a non negative decimal integer.
 *
 * The generator proved the view holds at most eighteen digits, so the result
 * stays inside `int64`.
 */
export function digitsToInteger(value: StringValue): IntegerValue {
  if (value === undefined || value.length === 0 || !value.every(isAsciiDigit)) {
    return undefined;
  }
  return value.reduce((total, point) => total * 10n + BigInt(point - 0x30), 0n);
}

/**
 * The remainder of `value` modulo `modulus`, taken digit by digit.
 *
 * No big integer conversion of the identifier happens, so a value longer than
 * any integer type stays exact.
 */
export function modDigits(value: StringValue, modulus: bigint): IntegerValue {
  if (value === undefined || value.length === 0 || !value.every(isAsciiDigit)) {
    return undefined;
  }
  let remainder = 0n;
  for (const point of value) {
    remainder = (remainder * 10n + BigInt(point - 0x30)) % modulus;
  }
  return remainder;
}

/** Maps every code point of the view, or fails on the first outside the domain. */
function mapAll(
  value: StringValue,
  mapper: (point: number) => number | undefined,
): number[] | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  const mapped: number[] = [];
  for (const point of value) {
    const contribution = mapper(point);
    // A code point outside the mapping domain makes the sum indeterminate even
    // at a position no weight pairs with: the value cannot be read at all.
    if (contribution === undefined) {
      return undefined;
    }
    mapped.push(contribution);
  }
  return mapped;
}

/** Pairs position `i` with `weights[i]`, leaving the tail unpaired. */
export function weightedSumLeft(
  value: StringValue,
  weights: readonly bigint[],
  mapper: (point: number) => number | undefined,
): IntegerValue {
  const mapped = mapAll(value, mapper);
  if (mapped === undefined) {
    return undefined;
  }
  let total = 0n;
  const paired = Math.min(mapped.length, weights.length);
  for (let index = 0; index < paired; index += 1) {
    total += BigInt(mapped[index] ?? 0) * (weights[index] ?? 0n);
  }
  return total;
}

/** Pairs the last position with the last weight, leaving the head unpaired. */
export function weightedSumRight(
  value: StringValue,
  weights: readonly bigint[],
  mapper: (point: number) => number | undefined,
): IntegerValue {
  const mapped = mapAll(value, mapper);
  if (mapped === undefined) {
    return undefined;
  }
  let total = 0n;
  const paired = Math.min(mapped.length, weights.length);
  for (let offset = 1; offset <= paired; offset += 1) {
    total += BigInt(mapped[mapped.length - offset] ?? 0) * (weights[weights.length - offset] ?? 0n);
  }
  return total;
}

/** Pairs position `i` with `weights[i mod len]`, so every position contributes. */
export function weightedSumCycle(
  value: StringValue,
  weights: readonly bigint[],
  mapper: (point: number) => number | undefined,
): IntegerValue {
  const mapped = mapAll(value, mapper);
  if (mapped === undefined) {
    return undefined;
  }
  let total = 0n;
  for (let index = 0; index < mapped.length; index += 1) {
    total += BigInt(mapped[index] ?? 0) * (weights[index % weights.length] ?? 0n);
  }
  return total;
}

/** The Euclidean remainder, always in `[0, modulus)`. */
export function modulo(value: IntegerValue, modulus: bigint): IntegerValue {
  if (value === undefined) {
    return undefined;
  }
  const remainder = value % modulus;
  return remainder < 0n ? remainder + modulus : remainder;
}

/** `modulus - value`, indeterminate when the operand sits outside `[0, modulus]`. */
export function complement(value: IntegerValue, modulus: bigint): IntegerValue {
  if (value === undefined || value < 0n || value > modulus) {
    return undefined;
  }
  return modulus - value;
}

/** The table entry `value` indexes, indeterminate when it falls outside. */
export function remainderMap(value: IntegerValue, table: readonly bigint[]): IntegerValue {
  if (value === undefined || value < 0n || value >= BigInt(table.length)) {
    return undefined;
  }
  return table[Number(value)];
}

/* -------------------------------------------------------------------------- */
/* Canonicalization steps                                                     */
/* -------------------------------------------------------------------------- */

/** Removes every leading and trailing code point of the frozen table. */
export function trimWhitespace(value: readonly number[]): readonly number[] {
  let start = 0;
  let end = value.length;
  while (start < end && isWhitespaceV1(value[start] ?? 0)) {
    start += 1;
  }
  while (end > start && isWhitespaceV1(value[end - 1] ?? 0)) {
    end -= 1;
  }
  return start === 0 && end === value.length ? value : value.slice(start, end);
}

/** Removes every code point of the frozen table. */
export function removeWhitespace(value: readonly number[]): readonly number[] {
  return value.filter((point) => !isWhitespaceV1(point));
}

/** Maps only `a..z` to `A..Z`, never consulting a locale. */
export function upperCaseAscii(value: readonly number[]): readonly number[] {
  return value.map((point) => (isAsciiLowerLetter(point) ? point - 32 : point));
}

/** Removes every accepted code point. */
export function removeChars(
  value: readonly number[],
  matches: (point: number) => boolean,
): readonly number[] {
  return value.filter((point) => !matches(point));
}

/** Replaces the exact leading `from` by `to` when present. */
export function replacePrefix(
  value: readonly number[],
  from: readonly number[],
  to: readonly number[],
): readonly number[] {
  return startsWith(value, from) ? [...to, ...value.slice(from.length)] : value;
}

/** Inserts `text` before the value. */
export function prepend(value: readonly number[], text: readonly number[]): readonly number[] {
  return [...text, ...value];
}

/** Appends `text` after the value. */
export function append(value: readonly number[], text: readonly number[]): readonly number[] {
  return [...value, ...text];
}

/**
 * Inserts `text` at a code point position.
 *
 * A position past the end leaves the value unchanged: appending instead would
 * silently move the inserted text.
 */
export function insert(
  value: readonly number[],
  index: number,
  text: readonly number[],
): readonly number[] {
  if (index > value.length) {
    return value;
  }
  return [...value.slice(0, index), ...text, ...value.slice(index)];
}

/** Prepends copies of `fill` until the value holds `width` code points. */
export function leftPad(value: readonly number[], width: number, fill: number): readonly number[] {
  // A longer value is never truncated.
  if (value.length >= width) {
    return value;
  }
  return [...new Array<number>(width - value.length).fill(fill), ...value];
}

/**
 * Prepends `prefix` unless the value already carries one the target accepts.
 *
 * The accepted list and the prefix are constants of the selected target, which
 * the generator inlined: a definition belongs to exactly one target.
 */
export function prependIfMissing(
  value: readonly number[],
  accepted: readonly (readonly number[])[],
  prefix: readonly number[],
): readonly number[] {
  if (accepted.some((candidate) => startsWith(value, candidate))) {
    return value;
  }
  return [...prefix, ...value];
}

/* -------------------------------------------------------------------------- */
/* Checksums                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Turns a comparison into an outcome.
 *
 * `undefined` means the comparison could not be made, which reports
 * `unsupported` rather than a failed check: an indeterminate computation never
 * proves an identifier wrong.
 */
export function verdict(matches: boolean | undefined, messageKey?: string): ChecksumOutcome {
  if (matches === undefined) {
    return messageKey === undefined
      ? UNSUPPORTED_CHECKSUM
      : { status: "unsupported", reasonCode: "unsupported_checksum", messageKey };
  }
  if (matches) {
    return messageKey === undefined
      ? VALID_CHECKSUM
      : { status: "valid", reasonCode: "ok", messageKey };
  }
  return messageKey === undefined
    ? INVALID_CHECKSUM
    : { status: "invalid", reasonCode: "invalid_checksum", messageKey };
}

const VALID_CHECKSUM: ChecksumOutcome = Object.freeze({ status: "valid", reasonCode: "ok" });
const INVALID_CHECKSUM: ChecksumOutcome = Object.freeze({
  status: "invalid",
  reasonCode: "invalid_checksum",
});

/**
 * The Luhn algorithm, whose rightmost code point is the check digit.
 *
 * `undefined` when the value cannot be read.
 */
export function luhn(value: StringValue): boolean | undefined {
  if (value === undefined || value.length < 2 || !value.every(isAsciiDigit)) {
    return undefined;
  }
  let total = 0;
  for (let offset = 0; offset < value.length; offset += 1) {
    const digit = (value[value.length - 1 - offset] ?? 0) - 0x30;
    if (offset % 2 === 1) {
      const doubled = digit * 2;
      total += doubled > 9 ? doubled - 9 : doubled;
    } else {
      total += digit;
    }
  }
  return total % 10 === 0;
}

/**
 * ISO 7064 MOD 97-10.
 *
 * Every ASCII letter expands to its base 36 decimal value and every digit to
 * itself; the resulting decimal string must be congruent to one modulo 97. The
 * remainder is taken digit by digit, so a value longer than any integer type
 * stays exact.
 */
export function iso7064Mod97(value: StringValue): boolean | undefined {
  if (value === undefined || value.length < 3) {
    return undefined;
  }
  let remainder = 0;
  for (const point of value) {
    if (isAsciiDigit(point)) {
      remainder = (remainder * 10 + (point - 0x30)) % 97;
    } else if (isAsciiUpperLetter(point)) {
      remainder = (remainder * 100 + (point - 0x41 + 10)) % 97;
    } else {
      return undefined;
    }
  }
  return remainder === 1;
}

/** Compares an integer to one ASCII digit of a view. */
export function comparedDigit(
  value: IntegerValue,
  text: StringValue,
  index: number,
): boolean | undefined {
  const point = text?.[index];
  if (value === undefined || point === undefined || !isAsciiDigit(point)) {
    return undefined;
  }
  return value === BigInt(point - 0x30);
}

/** Compares an integer to the decimal value of a slice of a view. */
export function comparedSlice(
  value: IntegerValue,
  text: StringValue,
  start: number,
  end: number,
): boolean | undefined {
  const view = slice(text, start, end);
  if (value === undefined || view === undefined || view.length === 0) {
    return undefined;
  }
  if (!view.every(isAsciiDigit)) {
    return undefined;
  }
  return value === view.reduce((total, point) => total * 10n + BigInt(point - 0x30), 0n);
}

/** Compares an integer to a literal constant. */
export function comparedConstant(value: IntegerValue, constant: bigint): boolean | undefined {
  return value === undefined ? undefined : value === constant;
}

/**
 * The first invalid outcome, else the first unsupported one, else valid.
 *
 * An unsupported operand never becomes an invalidity, which is why the search
 * order matters.
 */
export function allChecks(outcomes: readonly ChecksumOutcome[]): ChecksumOutcome {
  return (
    outcomes.find((outcome) => outcome.status === "invalid") ??
    outcomes.find((outcome) => outcome.status === "unsupported") ??
    VALID_CHECKSUM
  );
}

/** Valid as soon as one operand is, else the first unsupported, else the first invalid. */
export function anyCheck(outcomes: readonly ChecksumOutcome[]): ChecksumOutcome {
  return (
    outcomes.find((outcome) => outcome.status === "valid") ??
    outcomes.find((outcome) => outcome.status === "unsupported") ??
    outcomes[0] ??
    UNSUPPORTED_CHECKSUM
  );
}

/* -------------------------------------------------------------------------- */
/* Dispatch                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The first `length` code points of a value, as a string.
 *
 * Used only to match a declared prefix, which the generator proved is ASCII, so
 * a value whose head is not ASCII simply matches nothing.
 */
export function prefixString(value: readonly number[], length: number): string | undefined {
  if (value.length < length) {
    return undefined;
  }
  return String.fromCodePoint(...value.slice(0, length));
}
