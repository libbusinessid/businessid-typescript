/**
 * Evaluation of the IR.
 *
 * Nodes are re-evaluated at every reference: no memoization is observable. That
 * matters inside a canonicalization program, where `value()` designates the
 * value current at the moment the enclosing step runs, and it is also what the
 * step budget bills.
 *
 * Two rules run through everything here. Absence propagates: every string
 * constructor applied to an absent operand yields an absent result, and every
 * predicate reading an absent operand yields false except `IS_ABSENT`. An
 * indeterminate integer propagates through every integer operation and makes
 * the enclosing checksum `unsupported`, never `invalid` — refusing a valid
 * identifier is the most serious defect this project recognises.
 */
import {
  AssertionOpKind,
  CallOpKind,
  CanonicalizationOpKind,
  CharMapping,
  ChecksumOpKind,
  IntegerOpKind,
  PredicateOpKind,
  ProgramKind,
  StringOpKind,
  WeightAlignment,
} from "../generated/libbusinessid/ir/v1/rules_pb.js";
import { EngineError } from "../domain/errors.js";
import type { ValidationProfile } from "../domain/profile.js";
import type { Budget } from "./budget.js";
import type {
  IrCanonicalizationOperation,
  IrChecksumOperation,
  IrDefinition,
  IrIntegerOperation,
  IrNode,
  IrPredicateOperation,
  IrProgram,
  IrStringOperation,
  IrTarget,
  LoadedBundle,
} from "./ir.js";
import {
  codePointsOf,
  isAsciiAlphanumericCodePoint,
  isAsciiDigit,
  isAsciiLowerLetter,
  isAsciiUpperLetter,
  isWhitespaceV1,
} from "./text.js";
import {
  ASSERTION_PASSED,
  type AssertionResult,
  CHECKSUM_UNSUPPORTED,
  type ChecksumOutcome,
  type ChecksumResult,
  type IntegerValue,
  NOT_APPLICABLE,
  type StringValue,
} from "./values.js";

/** What a program may read while it runs. */
export type EvaluationContext = Readonly<{
  bundle: LoadedBundle;
  budget: Budget;
  /** The effective profile, resolved per `ir.md` section 5.2. */
  profile: ValidationProfile;
  /** The canonical country code of the selected target, absent for GLOBAL. */
  countryCode: string | undefined;
  /** The selected target, read by `PREPEND_COUNTRY_IF_MISSING`. */
  target: IrTarget | undefined;
  /** The selected definition, when one has been chosen. */
  definition: IrDefinition | undefined;
}>;

/** The mutable state of one program invocation. */
interface Frame {
  readonly program: IrProgram;
  /** The canonical value `value()` yields; mutable inside canonicalization. */
  current: readonly number[];
  /** The view `subject()` yields, when the caller supplied one. */
  readonly suppliedSubject: StringValue | undefined;
}

function nodeAt(frame: Frame, index: number): IrNode {
  const node = frame.program.nodes[index];
  if (node === undefined) {
    throw new EngineError(
      `program ${String(frame.program.id)} references node ${String(index)}, which load time validation should have refused`,
    );
  }
  return node;
}

/* -------------------------------------------------------------------------- */
/* Strings                                                                    */
/* -------------------------------------------------------------------------- */

function evaluateString(context: EvaluationContext, frame: Frame, index: number): StringValue {
  context.budget.step();
  const node = nodeAt(frame, index);
  const operation = node.operation;
  if (operation.family !== "string") {
    throw new EngineError(`node ${String(index)} does not produce a string`);
  }
  const value = applyString(context, frame, node, operation);
  context.budget.produced(value?.length ?? 0);
  return value;
}

function applyString(
  context: EvaluationContext,
  frame: Frame,
  node: IrNode,
  operation: IrStringOperation,
): StringValue {
  const operandOf = (position: number): StringValue => {
    const input = node.inputs[position];
    if (input === undefined) {
      throw new EngineError("missing string operand");
    }
    return evaluateString(context, frame, input);
  };

  switch (operation.kind) {
    case StringOpKind.CONSTANT:
      return operation.textCodePoints ?? [];

    case StringOpKind.VALUE:
      return frame.current;

    case StringOpKind.SUBJECT: {
      if (frame.suppliedSubject !== undefined) {
        return frame.suppliedSubject;
      }
      const subjectNode = frame.program.subjectNode;
      return subjectNode === undefined
        ? frame.current
        : evaluateString(context, frame, subjectNode);
    }

    case StringOpKind.COUNTRY_CODE:
      return context.countryCode === undefined ? undefined : codePointsOf(context.countryCode);

    case StringOpKind.SLICE:
    case StringOpKind.SLICE_FROM:
    case StringOpKind.SLICE_TO:
      return sliced(operandOf(0), operation);

    case StringOpKind.BEFORE_FIRST: {
      const expr = operandOf(0);
      const at = indexOfSequence(expr, operation.textCodePoints);
      return expr === undefined || at < 0 ? undefined : expr.slice(0, at);
    }

    case StringOpKind.AFTER_FIRST: {
      const expr = operandOf(0);
      const needle = operation.textCodePoints ?? [];
      const at = indexOfSequence(expr, needle);
      return expr === undefined || at < 0 ? undefined : expr.slice(at + needle.length);
    }

    case StringOpKind.STRIP_PREFIX: {
      const expr = operandOf(0);
      const prefix = operation.textCodePoints ?? [];
      return expr === undefined || !startsWith(expr, prefix)
        ? undefined
        : expr.slice(prefix.length);
    }

    default: {
      const parts: number[] = [];
      for (let position = 0; position < node.inputs.length; position += 1) {
        const part = operandOf(position);
        if (part === undefined) {
          return undefined;
        }
        parts.push(...part);
      }
      return parts;
    }
  }
}

/**
 * The three slice constructors.
 *
 * A bound outside the value yields an absent view rather than a shorter one:
 * silently clamping would let a rule read a different substring than the one it
 * asked for, and absence is what the IR defines for a view that cannot be
 * taken.
 */
function sliced(expr: StringValue, operation: IrStringOperation): StringValue {
  if (expr === undefined) {
    return undefined;
  }
  if (operation.kind === StringOpKind.SLICE_FROM) {
    const start = operation.start ?? 0;
    return start > expr.length ? undefined : expr.slice(start);
  }
  if (operation.kind === StringOpKind.SLICE_TO) {
    const end = operation.end ?? 0;
    return end > expr.length ? undefined : expr.slice(0, end);
  }
  const start = operation.start ?? 0;
  const end = operation.end ?? 0;
  return start > end || end > expr.length ? undefined : expr.slice(start, end);
}

function startsWith(value: readonly number[], prefix: readonly number[]): boolean {
  if (prefix.length > value.length) {
    return false;
  }
  return prefix.every((point, index) => value[index] === point);
}

function endsWith(value: readonly number[], suffix: readonly number[]): boolean {
  if (suffix.length > value.length) {
    return false;
  }
  const offset = value.length - suffix.length;
  return suffix.every((point, index) => value[offset + index] === point);
}

function indexOfSequence(value: StringValue, needle: readonly number[] | undefined): number {
  if (value === undefined || needle === undefined || needle.length === 0) {
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
/* Integers                                                                   */
/* -------------------------------------------------------------------------- */

function evaluateInteger(context: EvaluationContext, frame: Frame, index: number): IntegerValue {
  context.budget.step();
  const node = nodeAt(frame, index);
  const operation = node.operation;
  if (operation.family !== "integer") {
    throw new EngineError(`node ${String(index)} does not produce an integer`);
  }
  return applyInteger(context, frame, node, operation);
}

function applyInteger(
  context: EvaluationContext,
  frame: Frame,
  node: IrNode,
  operation: IrIntegerOperation,
): IntegerValue {
  const input = node.inputs[0];
  if (input === undefined) {
    throw new EngineError("missing integer operand");
  }

  switch (operation.kind) {
    case IntegerOpKind.DIGITS_TO_INTEGER: {
      const digits = evaluateString(context, frame, input);
      if (digits === undefined || digits.length === 0 || !digits.every(isAsciiDigit)) {
        return undefined;
      }
      // Load time validation proved at most 18 digits, so this stays exact.
      return digits.reduce((total, point) => total * 10n + BigInt(point - 0x30), 0n);
    }

    case IntegerOpKind.MOD_DIGITS: {
      const digits = evaluateString(context, frame, input);
      const modulus = operation.modulus;
      if (
        digits === undefined ||
        digits.length === 0 ||
        modulus === undefined ||
        !digits.every(isAsciiDigit)
      ) {
        return undefined;
      }
      // Digit by digit, so an identifier longer than any integer type stays exact.
      let remainder = 0n;
      for (const point of digits) {
        remainder = (remainder * 10n + BigInt(point - 0x30)) % modulus;
      }
      return remainder;
    }

    case IntegerOpKind.WEIGHTED_SUM:
      return weightedSum(evaluateString(context, frame, input), operation);

    case IntegerOpKind.MODULO: {
      const value = evaluateInteger(context, frame, input);
      const modulus = operation.modulus;
      if (value === undefined || modulus === undefined) {
        return undefined;
      }
      // Euclidean: the result always lies in [0, modulus).
      const remainder = value % modulus;
      return remainder < 0n ? remainder + modulus : remainder;
    }

    case IntegerOpKind.COMPLEMENT: {
      const value = evaluateInteger(context, frame, input);
      const modulus = operation.modulus;
      if (value === undefined || modulus === undefined || value < 0n || value > modulus) {
        return undefined;
      }
      return modulus - value;
    }

    default: {
      const value = evaluateInteger(context, frame, input);
      const table = operation.remainderValues;
      if (value === undefined || table === undefined) {
        return undefined;
      }
      if (value < 0n || value >= BigInt(table.length)) {
        return undefined;
      }
      return table[Number(value)];
    }
  }
}

/** The numeric contribution of one code point under a mapping. */
function mappedValue(point: number, operation: IrIntegerOperation): bigint | undefined {
  switch (operation.mapping) {
    case CharMapping.DIGIT_VALUE:
      return isAsciiDigit(point) ? BigInt(point - 0x30) : undefined;
    case CharMapping.ALNUM_BASE36:
      if (isAsciiDigit(point)) {
        return BigInt(point - 0x30);
      }
      return isAsciiUpperLetter(point) ? BigInt(point - 0x41 + 10) : undefined;
    case CharMapping.CUSTOM_ALPHABET: {
      const index = operation.alphabet?.get(point);
      return index === undefined ? undefined : BigInt(index);
    }
    default:
      return undefined;
  }
}

function weightedSum(expr: StringValue, operation: IrIntegerOperation): IntegerValue {
  const weights = operation.weights;
  if (expr === undefined || expr.length === 0 || weights === undefined) {
    return undefined;
  }

  // A code point outside the mapping domain makes the sum indeterminate even at
  // a position no weight pairs with: the value cannot be read, so no conclusion
  // about it is available.
  const mapped: bigint[] = [];
  for (const point of expr) {
    const value = mappedValue(point, operation);
    if (value === undefined) {
      return undefined;
    }
    mapped.push(value);
  }

  let total = 0n;
  switch (operation.alignment) {
    case WeightAlignment.LEFT: {
      const paired = Math.min(mapped.length, weights.length);
      for (let index = 0; index < paired; index += 1) {
        total += (mapped[index] ?? 0n) * (weights[index] ?? 0n);
      }
      return total;
    }
    case WeightAlignment.RIGHT: {
      const paired = Math.min(mapped.length, weights.length);
      for (let offset = 1; offset <= paired; offset += 1) {
        total += (mapped[mapped.length - offset] ?? 0n) * (weights[weights.length - offset] ?? 0n);
      }
      return total;
    }
    case WeightAlignment.CYCLE: {
      for (let index = 0; index < mapped.length; index += 1) {
        total += (mapped[index] ?? 0n) * (weights[index % weights.length] ?? 0n);
      }
      return total;
    }
    default:
      return undefined;
  }
}

/* -------------------------------------------------------------------------- */
/* Predicates                                                                 */
/* -------------------------------------------------------------------------- */

function evaluatePredicate(context: EvaluationContext, frame: Frame, index: number): boolean {
  context.budget.step();
  const node = nodeAt(frame, index);
  const operation = node.operation;
  if (operation.family !== "predicate") {
    throw new EngineError(`node ${String(index)} does not produce a boolean`);
  }
  return applyPredicate(context, frame, node, operation);
}

function applyPredicate(
  context: EvaluationContext,
  frame: Frame,
  node: IrNode,
  operation: IrPredicateOperation,
): boolean {
  const stringOperand = (position: number): StringValue => {
    const input = node.inputs[position];
    if (input === undefined) {
      throw new EngineError("missing predicate operand");
    }
    return evaluateString(context, frame, input);
  };

  switch (operation.kind) {
    case PredicateOpKind.ALL:
      // Evaluation stops at the first false operand.
      return node.inputs.every((input) => evaluatePredicate(context, frame, input));

    case PredicateOpKind.ANY:
      // Evaluation stops at the first true operand.
      return node.inputs.some((input) => evaluatePredicate(context, frame, input));

    case PredicateOpKind.NOT: {
      const input = node.inputs[0];
      if (input === undefined) {
        throw new EngineError("missing predicate operand");
      }
      return !evaluatePredicate(context, frame, input);
    }

    case PredicateOpKind.PROFILE_IS:
      return operation.profile === context.profile;

    case PredicateOpKind.INTEGER_IS: {
      const input = node.inputs[0];
      if (input === undefined) {
        throw new EngineError("missing integer operand");
      }
      // An indeterminate operand yields false, so the branch does not apply and
      // the enclosing CHOOSE falls through.
      const value = evaluateInteger(context, frame, input);
      return value !== undefined && value === operation.constant;
    }

    case PredicateOpKind.EQUALS: {
      const left = stringOperand(0);
      const right = stringOperand(1);
      if (left === undefined || right?.length !== left.length) {
        return false;
      }
      return left.every((point, index) => right[index] === point);
    }

    default:
      return applyStringPredicate(stringOperand(0), operation);
  }
}

/**
 * The predicates that read one string view.
 *
 * Every one of them yields false on an absent operand. `IS_ABSENT` is the sole
 * exception and observes absence as true, which is why it is the only way a
 * rule can distinguish a view that could not be taken from an empty one.
 */
function applyStringPredicate(value: StringValue, operation: IrPredicateOperation): boolean {
  switch (operation.kind) {
    case PredicateOpKind.IS_ABSENT:
      return value === undefined;

    case PredicateOpKind.IS_EMPTY:
      return value?.length === 0;

    case PredicateOpKind.LENGTH_EQ:
    case PredicateOpKind.LENGTH_IN:
    case PredicateOpKind.LENGTH_BETWEEN:
      return matchesLength(value, operation);

    case PredicateOpKind.ASCII_DIGITS:
    case PredicateOpKind.ASCII_UPPER_LETTERS:
    case PredicateOpKind.ASCII_ALPHANUMERIC:
    case PredicateOpKind.ASCII_CHARSET:
    case PredicateOpKind.CHAR_AT_IN:
      return matchesCharacterClass(value, operation);

    default:
      return matchesText(value, operation);
  }
}

/** The three predicates that read only the code point length of a view. */
function matchesLength(value: StringValue, operation: IrPredicateOperation): boolean {
  if (value === undefined) {
    return false;
  }
  if (operation.kind === PredicateOpKind.LENGTH_EQ) {
    return value.length === operation.length;
  }
  if (operation.kind === PredicateOpKind.LENGTH_IN) {
    return operation.lengths?.includes(value.length) ?? false;
  }
  return value.length >= (operation.minLength ?? 0) && value.length <= (operation.maxLength ?? 0);
}

/**
 * The predicates that test code points against a class.
 *
 * The V1 classes are ASCII only, and `ASCII_ALPHANUMERIC` covers digits and
 * upper letters alone. Canonicalization is what upper cases a value before such
 * a check runs; no class here ever consults a locale.
 */
function matchesCharacterClass(value: StringValue, operation: IrPredicateOperation): boolean {
  if (operation.kind === PredicateOpKind.CHAR_AT_IN) {
    const point = value?.[operation.index ?? 0];
    return point === undefined ? false : (operation.charset?.has(point) ?? false);
  }
  if (operation.kind === PredicateOpKind.ASCII_DIGITS) {
    return nonEmptyEvery(value, isAsciiDigit);
  }
  if (operation.kind === PredicateOpKind.ASCII_UPPER_LETTERS) {
    return nonEmptyEvery(value, isAsciiUpperLetter);
  }
  if (operation.kind === PredicateOpKind.ASCII_ALPHANUMERIC) {
    return nonEmptyEvery(value, isAsciiAlphanumericCodePoint);
  }
  return nonEmptyEvery(value, (point) => operation.charset?.has(point) ?? false);
}

/** The predicates that compare a view against constant text. */
function matchesText(value: StringValue, operation: IrPredicateOperation): boolean {
  if (operation.kind === PredicateOpKind.CONTAINS) {
    return indexOfSequence(value, operation.textCodePoints) >= 0;
  }
  if (value === undefined) {
    return false;
  }
  if (operation.kind === PredicateOpKind.STARTS_WITH) {
    return startsWith(value, operation.textCodePoints ?? []);
  }
  if (operation.kind === PredicateOpKind.ENDS_WITH) {
    return endsWith(value, operation.textCodePoints ?? []);
  }
  return (operation.values ?? []).some((candidate) => startsWith(value, codePointsOf(candidate)));
}

function nonEmptyEvery(value: StringValue, accepts: (point: number) => boolean): boolean {
  return value !== undefined && value.length > 0 && value.every(accepts);
}

/* -------------------------------------------------------------------------- */
/* Canonicalization                                                           */
/* -------------------------------------------------------------------------- */

function applyStep(context: EvaluationContext, frame: Frame, index: number): void {
  context.budget.step();
  const node = nodeAt(frame, index);
  const operation = node.operation;
  if (operation.family !== "canonicalization") {
    throw new EngineError(`node ${String(index)} is not a canonicalization step`);
  }
  applyCanonicalization(context, frame, node, operation);
  context.budget.produced(frame.current.length);
}

function applyCanonicalization(
  context: EvaluationContext,
  frame: Frame,
  node: IrNode,
  operation: IrCanonicalizationOperation,
): void {
  switch (operation.kind) {
    case CanonicalizationOpKind.SEQUENCE:
      for (const input of node.inputs) {
        applyStep(context, frame, input);
      }
      return;

    case CanonicalizationOpKind.WHEN: {
      const predicateInput = node.inputs[0];
      if (predicateInput === undefined) {
        throw new EngineError("conditional step without a predicate");
      }
      // The predicate reads the value current at the moment this step runs.
      if (evaluatePredicate(context, frame, predicateInput)) {
        for (const input of node.inputs.slice(1)) {
          applyStep(context, frame, input);
        }
      }
      return;
    }

    case CanonicalizationOpKind.PREPEND_COUNTRY_IF_MISSING: {
      const target = context.target;
      if (target === undefined) {
        throw new EngineError("prepend_country_if_missing ran without a selected target");
      }
      const alreadyPrefixed = target.acceptedPrefixes.some((prefix) =>
        startsWith(frame.current, codePointsOf(prefix)),
      );
      if (!alreadyPrefixed) {
        const prefix = target.canonicalPrefix ?? target.countryCode;
        if (prefix !== undefined) {
          frame.current = [...codePointsOf(prefix), ...frame.current];
        }
      }
      return;
    }

    default:
      frame.current = transformValue(frame.current, operation);
  }
}

/**
 * The unconditional canonicalization steps.
 *
 * None of them can fail and none of them truncates: a step that cannot apply
 * leaves the value as it found it. A canonicalization program never turns user
 * input into an error.
 */
function transformValue(
  current: readonly number[],
  operation: IrCanonicalizationOperation,
): readonly number[] {
  switch (operation.kind) {
    case CanonicalizationOpKind.TRIM_WHITESPACE: {
      let start = 0;
      let end = current.length;
      while (start < end && isWhitespaceV1(current[start] ?? 0)) {
        start += 1;
      }
      while (end > start && isWhitespaceV1(current[end - 1] ?? 0)) {
        end -= 1;
      }
      return current.slice(start, end);
    }

    case CanonicalizationOpKind.REMOVE_WHITESPACE:
      return current.filter((point) => !isWhitespaceV1(point));

    case CanonicalizationOpKind.UPPERCASE_ASCII:
      return current.map((point) => (isAsciiLowerLetter(point) ? point - 32 : point));

    case CanonicalizationOpKind.REMOVE_CHARS:
      return current.filter((point) => operation.charset?.has(point) !== true);

    case CanonicalizationOpKind.REPLACE_PREFIX: {
      const prefix = operation.textCodePoints ?? [];
      if (!startsWith(current, prefix)) {
        return current;
      }
      return [...codePointsOf(operation.replacement ?? ""), ...current.slice(prefix.length)];
    }

    case CanonicalizationOpKind.PREPEND:
      return [...(operation.textCodePoints ?? []), ...current];

    case CanonicalizationOpKind.APPEND:
      return [...current, ...(operation.textCodePoints ?? [])];

    case CanonicalizationOpKind.INSERT: {
      const at = operation.index ?? 0;
      // A position past the end leaves the value unchanged rather than
      // appending, which would silently move the inserted text.
      if (at > current.length) {
        return current;
      }
      return [...current.slice(0, at), ...(operation.textCodePoints ?? []), ...current.slice(at)];
    }

    default: {
      const width = operation.length ?? 0;
      const fill = operation.textCodePoints?.[0];
      // A longer value is never truncated.
      if (fill === undefined || current.length >= width) {
        return current;
      }
      return [...new Array<number>(width - current.length).fill(fill), ...current];
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Assertions                                                                 */
/* -------------------------------------------------------------------------- */

function evaluateAssertion(
  context: EvaluationContext,
  frame: Frame,
  index: number,
): AssertionResult {
  context.budget.step();
  const node = nodeAt(frame, index);
  const operation = node.operation;

  if (operation.family === "call") {
    const input = node.inputs[0];
    if (input === undefined || operation.kind !== CallOpKind.FORMAT) {
      throw new EngineError("malformed format call");
    }
    // The callee reason code and message key propagate unchanged.
    return invokeFormat(
      context,
      frame.current,
      evaluateString(context, frame, input),
      operation.programId,
    );
  }

  if (operation.family !== "assertion") {
    throw new EngineError(`node ${String(index)} does not produce an assertion`);
  }

  if (operation.kind === AssertionOpKind.SEQUENCE) {
    for (const input of node.inputs) {
      const result = evaluateAssertion(context, frame, input);
      if (result.failed) {
        // The first failure determines the reason code and the message key.
        return result;
      }
    }
    return ASSERTION_PASSED;
  }

  const predicateInput = node.inputs[0];
  if (predicateInput === undefined || operation.reasonCode === undefined) {
    throw new EngineError("malformed require assertion");
  }
  if (evaluatePredicate(context, frame, predicateInput)) {
    return ASSERTION_PASSED;
  }
  return {
    failed: true,
    reasonCode: operation.reasonCode,
    ...(operation.messageKey === undefined ? {} : { messageKey: operation.messageKey }),
  };
}

/* -------------------------------------------------------------------------- */
/* Checksums                                                                  */
/* -------------------------------------------------------------------------- */

function evaluateChecksum(context: EvaluationContext, frame: Frame, index: number): ChecksumResult {
  context.budget.step();
  const node = nodeAt(frame, index);
  const operation = node.operation;

  if (operation.family === "call") {
    const input = node.inputs[0];
    if (input === undefined || operation.kind !== CallOpKind.CHECKSUM) {
      throw new EngineError("malformed checksum call");
    }
    return invokeChecksum(
      context,
      frame.current,
      evaluateString(context, frame, input),
      operation.programId,
    );
  }

  if (operation.family !== "checksum") {
    throw new EngineError(`node ${String(index)} does not produce a checksum outcome`);
  }
  return applyChecksum(context, frame, node, operation);
}

function applyChecksum(
  context: EvaluationContext,
  frame: Frame,
  node: IrNode,
  operation: IrChecksumOperation,
): ChecksumResult {
  const withKey = (outcome: ChecksumOutcome): ChecksumOutcome =>
    operation.messageKey === undefined ? outcome : { ...outcome, messageKey: operation.messageKey };

  const stringOperand = (position: number): StringValue => {
    const input = node.inputs[position];
    if (input === undefined) {
      throw new EngineError("missing checksum operand");
    }
    return evaluateString(context, frame, input);
  };

  const integerOperand = (position: number): IntegerValue => {
    const input = node.inputs[position];
    if (input === undefined) {
      throw new EngineError("missing checksum operand");
    }
    return evaluateInteger(context, frame, input);
  };

  const verdict = (matches: boolean | undefined): ChecksumOutcome =>
    matches === undefined
      ? withKey(CHECKSUM_UNSUPPORTED)
      : withKey(
          matches
            ? { status: "valid", reasonCode: "ok" }
            : { status: "invalid", reasonCode: "invalid_checksum" },
        );

  switch (operation.kind) {
    case ChecksumOpKind.LUHN:
      return verdict(luhn(stringOperand(0)));

    case ChecksumOpKind.ISO7064_MOD97_10:
      return verdict(iso7064Mod97(stringOperand(0)));

    case ChecksumOpKind.COMPARE_DIGIT:
      return verdict(comparedDigit(integerOperand(0), stringOperand(1), operation));

    case ChecksumOpKind.COMPARE_SLICE:
      return verdict(comparedSlice(integerOperand(0), stringOperand(1), operation));

    case ChecksumOpKind.COMPARE_CONSTANT: {
      const value = integerOperand(0);
      // An indeterminate integer never proves an identifier wrong.
      return verdict(value === undefined ? undefined : value === operation.constant);
    }

    case ChecksumOpKind.CHOOSE: {
      for (const input of node.inputs) {
        const branch = evaluateChecksum(context, frame, input);
        if (branch !== NOT_APPLICABLE) {
          return branch;
        }
      }
      // No branch applied: no published algorithm covers this value.
      return CHECKSUM_UNSUPPORTED;
    }

    case ChecksumOpKind.WHEN: {
      const predicateInput = node.inputs[0];
      const ruleInput = node.inputs[1];
      if (predicateInput === undefined || ruleInput === undefined) {
        throw new EngineError("malformed checksum branch");
      }
      if (!evaluatePredicate(context, frame, predicateInput)) {
        return NOT_APPLICABLE;
      }
      return evaluateChecksum(context, frame, ruleInput);
    }

    case ChecksumOpKind.ALL_CHECKS: {
      const outcomes = node.inputs.map((input) =>
        requireOutcome(evaluateChecksum(context, frame, input)),
      );
      return (
        outcomes.find((outcome) => outcome.status === "invalid") ??
        outcomes.find((outcome) => outcome.status === "unsupported") ?? {
          status: "valid",
          reasonCode: "ok",
        }
      );
    }

    case ChecksumOpKind.ANY_CHECK: {
      const outcomes: ChecksumOutcome[] = [];
      for (const input of node.inputs) {
        const outcome = requireOutcome(evaluateChecksum(context, frame, input));
        if (outcome.status === "valid") {
          return outcome;
        }
        outcomes.push(outcome);
      }
      return (
        outcomes.find((outcome) => outcome.status === "unsupported") ??
        outcomes[0] ??
        CHECKSUM_UNSUPPORTED
      );
    }

    default: {
      if (operation.reasonCode === undefined) {
        throw new EngineError("unsupported checksum without a reason");
      }
      return withKey({ status: "unsupported", reasonCode: operation.reasonCode });
    }
  }
}

/**
 * Compares an integer to one ASCII digit of a view.
 *
 * `undefined` means the comparison could not be made, which the caller reports
 * as `unsupported` rather than as a failed check.
 */
function comparedDigit(
  value: IntegerValue,
  text: StringValue,
  operation: IrChecksumOperation,
): boolean | undefined {
  const point = text?.[operation.index ?? 0];
  if (value === undefined || point === undefined || !isAsciiDigit(point)) {
    return undefined;
  }
  return value === BigInt(point - 0x30);
}

/** Compares an integer to the decimal value of a slice of a view. */
function comparedSlice(
  value: IntegerValue,
  text: StringValue,
  operation: IrChecksumOperation,
): boolean | undefined {
  const start = operation.start ?? 0;
  const end = operation.end ?? 0;
  if (value === undefined || text === undefined || start > end || end > text.length) {
    return undefined;
  }
  const slice = text.slice(start, end);
  if (slice.length === 0 || !slice.every(isAsciiDigit)) {
    return undefined;
  }
  return value === slice.reduce((total, point) => total * 10n + BigInt(point - 0x30), 0n);
}

function requireOutcome(result: ChecksumResult): ChecksumOutcome {
  if (result === NOT_APPLICABLE) {
    throw new EngineError("a WHEN branch was reached outside a CHOOSE");
  }
  return result;
}

/**
 * The Luhn algorithm, whose rightmost code point is the check digit.
 *
 * Returns `undefined` when the value cannot be read, which the caller reports
 * as `unsupported` rather than as a failed check.
 */
function luhn(expr: StringValue): boolean | undefined {
  if (expr === undefined || expr.length < 2 || !expr.every(isAsciiDigit)) {
    return undefined;
  }
  let total = 0;
  for (let offset = 0; offset < expr.length; offset += 1) {
    const digit = (expr[expr.length - 1 - offset] ?? 0) - 0x30;
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
 * remainder is taken digit by digit, so an identifier longer than any integer
 * type stays exact.
 */
function iso7064Mod97(expr: StringValue): boolean | undefined {
  if (expr === undefined || expr.length < 3) {
    return undefined;
  }
  let remainder = 0;
  for (const point of expr) {
    if (isAsciiDigit(point)) {
      remainder = (remainder * 10 + (point - 0x30)) % 97;
    } else if (isAsciiUpperLetter(point)) {
      const expanded = point - 0x41 + 10;
      remainder = (remainder * 100 + expanded) % 97;
    } else {
      return undefined;
    }
  }
  return remainder === 1;
}

/* -------------------------------------------------------------------------- */
/* Program invocation                                                         */
/* -------------------------------------------------------------------------- */

function programOf(context: EvaluationContext, id: number, kind: ProgramKind): IrProgram {
  const program = context.bundle.programs.get(id);
  if (program?.kind !== kind) {
    throw new EngineError(
      `program ${String(id)} of kind ${String(kind)} is missing, which load time validation should have refused`,
    );
  }
  context.budget.step();
  return program;
}

function frameFor(
  program: IrProgram,
  current: readonly number[],
  suppliedSubject: StringValue | undefined,
): Frame {
  return { program, current, suppliedSubject };
}

/**
 * Runs a canonicalization program once and yields the resulting value.
 *
 * Steps mutate the value in sequence, and `value()` inside the program always
 * designates the value current at the moment the enclosing step runs.
 */
export function runCanonicalization(
  context: EvaluationContext,
  programId: number,
  value: readonly number[],
): readonly number[] {
  const program = programOf(context, programId, ProgramKind.CANONICALIZATION);
  const frame = frameFor(program, value, undefined);
  applyStep(context, frame, program.rootNode);
  return frame.current;
}

/** Runs a format program on a canonical value. */
export function runFormat(
  context: EvaluationContext,
  programId: number,
  canonical: readonly number[],
): AssertionResult {
  return invokeFormat(context, canonical, undefined, programId);
}

/** Runs a checksum program on a canonical value. */
export function runChecksum(
  context: EvaluationContext,
  programId: number,
  canonical: readonly number[],
): ChecksumOutcome {
  return invokeChecksum(context, canonical, undefined, programId);
}

function invokeFormat(
  context: EvaluationContext,
  current: readonly number[],
  subject: StringValue | undefined,
  programId: number,
): AssertionResult {
  const program = programOf(context, programId, ProgramKind.FORMAT);
  return evaluateAssertion(context, frameFor(program, current, subject), program.rootNode);
}

function invokeChecksum(
  context: EvaluationContext,
  current: readonly number[],
  subject: StringValue | undefined,
  programId: number,
): ChecksumOutcome {
  const program = programOf(context, programId, ProgramKind.CHECKSUM);
  return requireOutcome(
    evaluateChecksum(context, frameFor(program, current, subject), program.rootNode),
  );
}
