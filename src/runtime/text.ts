/**
 * Text primitives working in Unicode code points.
 *
 * JavaScript indexes strings in UTF-16 code units, so `value.length` and
 * `value[i]` are wrong the moment a code point leaves the BMP. Everything the
 * IR measures — lengths, slices, character classes — is counted in code points
 * (`spec.md` section 6.5), so the engine converts once at the boundary and
 * works on code point arrays from there.
 *
 * The whitespace table is the frozen `whitespace_v1` class. Delegating it to a
 * runtime's own Unicode functions is forbidden: their tables move between
 * versions, and two engines would then disagree on the same input.
 */

/** A string decomposed into Unicode code points. */
export type CodePoints = readonly number[];

/**
 * The frozen `whitespace_v1` class.
 *
 * `U+0009..U+000D, U+0020, U+0085, U+00A0, U+1680, U+2000..U+200A, U+2028,
 * U+2029, U+202F, U+205F, U+3000, U+FEFF`.
 */
export const WHITESPACE_V1: ReadonlySet<number> = new Set([
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x0085, 0x00a0, 0x1680, 0x2000, 0x2001, 0x2002,
  0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f,
  0x3000, 0xfeff,
]);

/** True when the code point belongs to the frozen `whitespace_v1` class. */
export function isWhitespaceV1(codePoint: number): boolean {
  return WHITESPACE_V1.has(codePoint);
}

/** Decomposes a string into its Unicode code points. */
export function codePointsOf(value: string): number[] {
  const out: number[] = [];
  for (const character of value) {
    // `for...of` iterates code points, so a surrogate pair yields one item.
    out.push(character.codePointAt(0) ?? 0);
  }
  return out;
}

/** Rebuilds a string from Unicode code points. */
export function stringOf(codePoints: CodePoints): string {
  let out = "";
  // Chunked to keep a long value from exceeding the argument limit of apply.
  const chunk = 1024;
  for (let index = 0; index < codePoints.length; index += chunk) {
    out += String.fromCodePoint(...codePoints.slice(index, index + chunk));
  }
  return out;
}

/**
 * True when the string holds a surrogate that is not part of a pair.
 *
 * Such a string has no UTF-8 encoding, so it carries no code point sequence to
 * evaluate and is reported `invalid_encoding` (`spec.md` section 6.6).
 */
export function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = index + 1 < value.length ? value.charCodeAt(index + 1) : 0;
      if (next < 0xdc00 || next > 0xdfff) {
        return true;
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/**
 * The length of the string once encoded as UTF-8.
 *
 * Counted without allocating a buffer. A lone surrogate counts as three bytes,
 * the width of the replacement character an encoder would emit for it, so the
 * bound stays defined on input that `hasLoneSurrogate` will reject.
 */
export function utf8ByteLength(value: string): number {
  let total = 0;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit < 0x80) {
      total += 1;
    } else if (unit < 0x800) {
      total += 2;
    } else if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = index + 1 < value.length ? value.charCodeAt(index + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        total += 4;
        index += 1;
      } else {
        total += 3;
      }
    } else {
      total += 3;
    }
  }
  return total;
}

/**
 * Removes `U+0009..U+000D` and `U+0020` at both ends.
 *
 * This narrower class is what dispatch uses to normalise a kind token
 * (`spec.md` section 6.11); it is not `whitespace_v1`.
 */
export function trimAsciiSpace(value: string): string {
  const isAsciiSpace = (unit: number): boolean => (unit >= 0x09 && unit <= 0x0d) || unit === 0x20;
  let start = 0;
  let end = value.length;
  while (start < end && isAsciiSpace(value.charCodeAt(start))) {
    start += 1;
  }
  while (end > start && isAsciiSpace(value.charCodeAt(end - 1))) {
    end -= 1;
  }
  return start === 0 && end === value.length ? value : value.slice(start, end);
}

/** Maps `a..z` to `A..Z` and leaves every other code point alone. */
export function upperCaseAscii(value: string): string {
  let out = "";
  let changed = false;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0x61 && unit <= 0x7a) {
      out += String.fromCharCode(unit - 32);
      changed = true;
    } else {
      out += value.charAt(index);
    }
  }
  return changed ? out : value;
}

/** Maps `A..Z` to `a..z` and leaves every other code point alone. */
export function lowerCaseAscii(value: string): string {
  let out = "";
  let changed = false;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0x41 && unit <= 0x5a) {
      out += String.fromCharCode(unit + 32);
      changed = true;
    } else {
      out += value.charAt(index);
    }
  }
  return changed ? out : value;
}

/** True when the code point is `0..9`. */
export function isAsciiDigit(codePoint: number): boolean {
  return codePoint >= 0x30 && codePoint <= 0x39;
}

/** True when the code point is `A..Z`. */
export function isAsciiUpperLetter(codePoint: number): boolean {
  return codePoint >= 0x41 && codePoint <= 0x5a;
}

/** True when the code point is `a..z`. */
export function isAsciiLowerLetter(codePoint: number): boolean {
  return codePoint >= 0x61 && codePoint <= 0x7a;
}

/**
 * True when the code point is an ASCII digit or upper letter.
 *
 * This is the domain of the IR `ASCII_ALPHANUMERIC` predicate and of the
 * `ALNUM_BASE36` mapping, which `ir.md` restricts to `0..9` and `A..Z`. Lower
 * case is alphanumeric in ordinary usage but not in this class: a rule that
 * accepted it would pass values another engine refuses. Canonicalization is
 * what upper cases a value before such a check runs.
 */
export function isAsciiAlphanumericCodePoint(codePoint: number): boolean {
  return isAsciiDigit(codePoint) || isAsciiUpperLetter(codePoint);
}
