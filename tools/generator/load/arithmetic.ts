/**
 * Check 13: arithmetic bounds, string constants and custom alphabets.
 *
 * Every computation a bundle can ask for must be provably safe before any of
 * it runs. A value whose safety cannot be proven makes the bundle
 * `invalid_ruleset` rather than a silently inexact result at validation time.
 */
import {
  AssertionOpKind,
  CharMapping,
  ChecksumOpKind,
  IntegerOpKind,
  StringOpKind,
  WeightAlignment,
} from "../../../generated/libbusinessid/ir/v1/rules_pb.js";
import {
  ABSENT_CHECKSUM_REASON_CODES,
  INVALIDITY_REASON_CODES,
  type ReasonCode,
} from "../../../src/domain/reason-code.js";
import { ARITHMETIC, LIMITS } from "../limits.js";
import { codePointsOf, utf8ByteLength } from "../../../src/runtime/text.js";
import { invalid, isKnownEnumValue, reasonCodeName, type ResolvedNode } from "./diagnostics.js";

/** Applies the bounds of `ir.md` section 8 to one node. */
export function checkArithmetic(
  where: string,
  entry: ResolvedNode,
  nodes: readonly ResolvedNode[],
): void {
  switch (entry.operationCase) {
    case "stringOperation":
      checkStringOperation(where, entry);
      return;
    case "integerOperation":
      checkIntegerOperation(where, entry, nodes);
      return;
    case "predicateOperation":
      checkPredicateOperation(where, entry);
      return;
    case "canonicalizationOperation":
      checkCanonicalizationOperation(where, entry);
      return;
    case "assertionOperation":
      checkAssertionOperation(where, entry);
      return;
    case "checksumOperation":
      checkChecksumOperation(where, entry);
      return;
    default:
      return;
  }
}

function checkStringOperation(where: string, entry: ResolvedNode): void {
  const message = entry.message as { text?: string; start?: number; end?: number };
  checkConstantString(where, "text", message.text);
  checkIndex(where, "start", message.start);
  checkIndex(where, "end", message.end);
}

function checkIntegerOperation(
  where: string,
  entry: ResolvedNode,
  nodes: readonly ResolvedNode[],
): void {
  const message = entry.message as {
    kind: IntegerOpKind;
    modulus?: bigint;
    weights: bigint[];
    mapping?: number;
    alignment?: number;
    remainderValues: bigint[];
    alphabet?: string;
  };

  if (message.modulus !== undefined) {
    if (message.modulus < ARITHMETIC.modulus.min || message.modulus > ARITHMETIC.modulus.max) {
      invalid(13, `${where} modulus ${String(message.modulus)} is out of range`);
    }
  }
  checkWeights(where, message.weights);
  if (message.remainderValues.length > ARITHMETIC.remainderCount.max) {
    invalid(13, `${where} remainder map holds too many entries`);
  }
  // Decoding kept an unrecognised enum value as its number, so an alignment or
  // a mapping outside the enumeration is refused here, by the check that owns
  // the field, rather than having failed the decode.
  if (message.alignment !== undefined && !isKnownEnumValue(WeightAlignment, message.alignment)) {
    invalid(13, `${where} declares an unknown weight alignment`);
  }
  if (message.alignment === WeightAlignment.UNSPECIFIED) {
    invalid(13, `${where} declares an unspecified weight alignment`);
  }
  if (message.mapping !== undefined && !isKnownEnumValue(CharMapping, message.mapping)) {
    invalid(13, `${where} declares an unknown character mapping`);
  }
  if (message.mapping === CharMapping.UNSPECIFIED) {
    invalid(13, `${where} declares an unspecified character mapping`);
  }
  checkAlphabet(where, message.mapping, message.alphabet);

  if (message.kind === IntegerOpKind.DIGITS_TO_INTEGER) {
    checkDigitsToInteger(where, entry, nodes);
  }
}

function checkWeights(where: string, weights: readonly bigint[]): void {
  if (weights.length === 0) {
    return;
  }
  if (weights.length < ARITHMETIC.weightCount.min || weights.length > ARITHMETIC.weightCount.max) {
    invalid(13, `${where} declares ${String(weights.length)} weights`);
  }
  for (const weight of weights) {
    const magnitude = weight < 0n ? -weight : weight;
    if (magnitude > ARITHMETIC.weightAbsolute.max) {
      invalid(13, `${where} weight ${String(weight)} is out of range`);
    }
  }
}

function checkDigitsToInteger(
  where: string,
  entry: ResolvedNode,
  nodes: readonly ResolvedNode[],
): void {
  const operand = entry.node.inputNodes[0];
  const digits = operand === undefined ? undefined : staticMaxLength(operand, nodes);
  if (
    digits === undefined ||
    digits < ARITHMETIC.digitsToInteger.min ||
    digits > ARITHMETIC.digitsToInteger.max
  ) {
    invalid(
      13,
      `${where} converts an operand of ${digits === undefined ? "unprovable" : String(digits)} digits to an integer`,
    );
  }
}

function checkPredicateOperation(where: string, entry: ResolvedNode): void {
  const message = entry.message as {
    text?: string;
    values: string[];
    lengths: number[];
    length?: number;
    minLength?: number;
    maxLength?: number;
    index?: number;
    constant?: bigint;
  };
  checkConstantString(where, "text", message.text);
  for (const value of message.values) {
    checkConstantString(where, "values", value);
  }
  for (const length of message.lengths) {
    checkIndex(where, "lengths", length);
  }
  checkIndex(where, "length", message.length);
  checkIndex(where, "min_length", message.minLength);
  checkIndex(where, "max_length", message.maxLength);
  checkIndex(where, "index", message.index);
  checkComparisonConstant(where, message.constant);
}

function checkCanonicalizationOperation(where: string, entry: ResolvedNode): void {
  const message = entry.message as {
    text?: string;
    replacement?: string;
    index?: number;
    length?: number;
  };
  checkConstantString(where, "text", message.text);
  checkConstantString(where, "replacement", message.replacement);
  checkIndex(where, "index", message.index);
  // A pad longer than the slice bound would let a bundle size a buffer past
  // every other static maximum of the IR.
  checkIndex(where, "length", message.length);
}

function checkAssertionOperation(where: string, entry: ResolvedNode): void {
  const message = entry.message as {
    kind: AssertionOpKind;
    reasonCode?: number;
    messageKey?: string;
  };
  checkMessageKey(where, message.messageKey);
  if (message.kind === AssertionOpKind.REQUIRE) {
    // REQUIRE is the only construct that produces a format invalidity, so it
    // only accepts a reason that proves one. Anything else would let a rule
    // report `invalid` with a reason the contract pairs with `unsupported`.
    checkReasonCode(where, "REQUIRE", message.reasonCode, INVALIDITY_REASON_CODES);
  }
}

function checkChecksumOperation(where: string, entry: ResolvedNode): void {
  const message = entry.message as {
    kind: ChecksumOpKind;
    index?: number;
    start?: number;
    end?: number;
    reasonCode?: number;
    messageKey?: string;
    constant?: bigint;
  };
  if (message.kind === ChecksumOpKind.UNSUPPORTED) {
    checkReasonCode(where, "UNSUPPORTED", message.reasonCode, ABSENT_CHECKSUM_REASON_CODES);
  }
  checkIndex(where, "index", message.index);
  checkIndex(where, "start", message.start);
  checkIndex(where, "end", message.end);
  checkMessageKey(where, message.messageKey);
  checkComparisonConstant(where, message.constant);
}

/* -------------------------------------------------------------------------- */

function checkIndex(where: string, label: string, value: number | undefined): void {
  if (value === undefined) {
    return;
  }
  if (value < ARITHMETIC.index.min || value > ARITHMETIC.index.max) {
    invalid(
      13,
      `${where} ${label} is ${String(value)}, outside 0..${String(ARITHMETIC.index.max)}`,
    );
  }
}

function checkConstantString(where: string, label: string, value: string | undefined): void {
  if (value !== undefined && utf8ByteLength(value) > LIMITS.constantBytes) {
    invalid(13, `${where} ${label} exceeds ${String(LIMITS.constantBytes)} UTF-8 bytes`);
  }
}

function checkComparisonConstant(where: string, value: bigint | undefined): void {
  if (value === undefined) {
    return;
  }
  if (value < ARITHMETIC.comparisonConstant.min || value > ARITHMETIC.comparisonConstant.max) {
    invalid(13, `${where} compares against ${String(value)}, outside the accepted range`);
  }
}

/**
 * A declared message key is never empty.
 *
 * A present but empty key cannot be told apart from an absent one in an
 * idiomatic API, so two engines could then report differently on the same
 * bundle. Absence is expressed by omitting the field.
 */
function checkMessageKey(where: string, value: string | undefined): void {
  if (value === "") {
    invalid(13, `${where} declares an empty message key`);
  }
  checkConstantString(where, "message_key", value);
}

/**
 * A reason code an operation declares must resolve and belong to the set that
 * operation may report.
 */
function checkReasonCode(
  where: string,
  operation: string,
  value: number | undefined,
  allowed: readonly ReasonCode[],
): void {
  const reason = reasonCodeName(value);
  if (reason === undefined) {
    invalid(13, `${where} declares an unusable reason code for ${operation}`);
  }
  if (!allowed.some((code) => code === reason)) {
    invalid(13, `${where} declares reason ${reason}, which ${operation} may not report`);
  }
}

function checkAlphabet(
  where: string,
  mapping: number | undefined,
  alphabet: string | undefined,
): void {
  if (mapping === CharMapping.CUSTOM_ALPHABET) {
    if (alphabet === undefined) {
      invalid(13, `${where} uses a custom alphabet mapping without declaring an alphabet`);
    }
    const points = codePointsOf(alphabet);
    if (
      points.length < ARITHMETIC.alphabetCodePoints.min ||
      points.length > ARITHMETIC.alphabetCodePoints.max
    ) {
      invalid(13, `${where} declares an alphabet of ${String(points.length)} code points`);
    }
    if (new Set(points).size !== points.length) {
      // A repeated code point would carry two values, and which one an engine
      // returned would depend on how it searched. That is how two conformant
      // engines disagree without either being wrong.
      invalid(13, `${where} declares an alphabet listing a code point twice`);
    }
    return;
  }
  if (alphabet !== undefined) {
    invalid(13, `${where} declares an alphabet its mapping never reads`);
  }
}

/**
 * A conservative upper bound on the code point length a string node produces.
 *
 * `undefined` means the length cannot be proven, which is what makes
 * `DIGITS_TO_INTEGER` refuse the bundle: converting an unbounded run of digits
 * cannot be shown to stay inside `INT64_MAX`, and such a rule must use the
 * digit by digit `MOD_DIGITS` family instead.
 */
function staticMaxLength(index: number, nodes: readonly ResolvedNode[]): number | undefined {
  const entry = nodes[index];
  if (entry?.operationCase !== "stringOperation") {
    return undefined;
  }
  const message = entry.message as {
    kind: StringOpKind;
    text?: string;
    start?: number;
    end?: number;
  };
  const operand = entry.node.inputNodes[0];
  const inner = operand === undefined ? undefined : staticMaxLength(operand, nodes);

  switch (message.kind) {
    case StringOpKind.CONSTANT:
      return codePointsOf(message.text ?? "").length;
    case StringOpKind.COUNTRY_CODE:
      return 2;
    case StringOpKind.SLICE: {
      const start = message.start ?? 0;
      const end = message.end ?? 0;
      return end > start ? end - start : 0;
    }
    case StringOpKind.SLICE_TO:
      return inner === undefined ? message.end : Math.min(inner, message.end ?? inner);

    case StringOpKind.SLICE_FROM:
      return inner === undefined ? undefined : Math.max(0, inner - (message.start ?? 0));
    case StringOpKind.BEFORE_FIRST:
    case StringOpKind.AFTER_FIRST:
    case StringOpKind.STRIP_PREFIX:
      return inner;
    case StringOpKind.CONCAT: {
      let total = 0;
      for (const input of entry.node.inputNodes) {
        const part = staticMaxLength(input, nodes);
        if (part === undefined) {
          return undefined;
        }
        total += part;
      }
      return total;
    }
    default:
      // VALUE and SUBJECT depend on the identifier under validation, whose
      // canonical form a canonicalization program may grow.
      return undefined;
  }
}
