/**
 * Emits one IR node as a TypeScript expression.
 *
 * Nodes are inlined rather than hoisted into locals. Inlining keeps the
 * short-circuit of `ALL`, `ANY` and the assertion sequence exactly where the IR
 * puts it, and it costs little: across the shipped bundle, full inlining
 * expands 2375 nodes into 3069 expression instances, the largest program
 * reaching 118.
 *
 * Every emitted expression is total. Absence and indeterminacy are values, not
 * exceptions, so no emitted code can throw on user input.
 */
import {
  CharMapping,
  IntegerOpKind,
  PredicateOpKind,
  StringOpKind,
  WeightAlignment,
} from "../../../generated/libbusinessid/ir/v1/rules_pb.js";
import { ChecksumOpKind } from "../../../generated/libbusinessid/ir/v1/rules_pb.js";
import { codePointsOf } from "../../../src/runtime/text.js";
import { GeneratorError } from "../errors.js";
import type { IrNode, IrPredicateOperation, IrProgram } from "../ir.js";
import type { ConstantPool, HelperPool } from "./pool.js";

/** What the emitter may refer to while emitting one program. */
export interface EmitContext {
  readonly constants: ConstantPool;
  readonly helpers: HelperPool;
  readonly program: IrProgram;
  /** The expression yielding `value()`; a mutable local in canonicalization. */
  readonly value: string;
  /** The expression yielding `subject()`, absent while emitting a default subject. */
  readonly subject: string | undefined;
  /** The expression yielding the selected definition id. */
  readonly definition: string;
  /** The expression yielding the effective profile. */
  readonly profile: string;
  /** Name of the emitted function for a program id. */
  readonly nameOf: (programId: number) => string;
  /** The argument list a call to that program takes. */
  readonly argumentsOf: (programId: number, subject: string) => string;
  /** Name of the helper emitted for a `CHOOSE` node. */
  readonly chooseOf: (nodeIndex: number) => string;
  /** The argument list a call to a `CHOOSE` helper takes. */
  readonly chooseArguments: string;
}

function nodeAt(context: EmitContext, index: number): IrNode {
  const node = context.program.nodes[index];
  if (node === undefined) {
    throw new GeneratorError(
      `program ${String(context.program.id)} references node ${String(index)}, which load time validation should have refused`,
    );
  }
  return node;
}

const quote = (value: string): string => JSON.stringify(value);

/** Emits the string view a node produces. */
export function stringExpression(context: EmitContext, index: number): string {
  const node = nodeAt(context, index);
  const operation = node.operation;
  if (operation.family !== "string") {
    throw new GeneratorError(`node ${String(index)} does not produce a string`);
  }
  const operand = (position: number): string =>
    stringExpression(context, node.inputs[position] ?? -1);
  const text = (): string => context.constants.codePoints(operation.textCodePoints ?? []);

  switch (operation.kind) {
    case StringOpKind.CONSTANT:
      return text();
    case StringOpKind.VALUE:
      return context.value;
    case StringOpKind.SUBJECT:
      if (context.subject === undefined) {
        throw new GeneratorError(
          `program ${String(context.program.id)} computes its own subject from subject(), which has no value yet`,
        );
      }
      return context.subject;
    case StringOpKind.COUNTRY_CODE:
      return `countryPointsOf(${context.definition})`;
    case StringOpKind.SLICE:
      return `support.slice(${operand(0)}, ${String(operation.start ?? 0)}, ${String(operation.end ?? 0)})`;
    case StringOpKind.SLICE_FROM:
      return `support.sliceFrom(${operand(0)}, ${String(operation.start ?? 0)})`;
    case StringOpKind.SLICE_TO:
      return `support.sliceTo(${operand(0)}, ${String(operation.end ?? 0)})`;
    case StringOpKind.BEFORE_FIRST:
      return `support.beforeFirst(${operand(0)}, ${text()})`;
    case StringOpKind.AFTER_FIRST:
      return `support.afterFirst(${operand(0)}, ${text()})`;
    case StringOpKind.STRIP_PREFIX:
      return `support.stripPrefix(${operand(0)}, ${text()})`;
    default: {
      const parts = node.inputs.map((_unused, position) => operand(position));
      return `support.concat([${parts.join(", ")}])`;
    }
  }
}

/** Emits the integer a node produces. */
export function integerExpression(context: EmitContext, index: number): string {
  const node = nodeAt(context, index);
  const operation = node.operation;
  if (operation.family !== "integer") {
    throw new GeneratorError(`node ${String(index)} does not produce an integer`);
  }
  const input = node.inputs[0] ?? -1;
  const modulus = `${(operation.modulus ?? 0n).toString()}n`;

  switch (operation.kind) {
    case IntegerOpKind.DIGITS_TO_INTEGER:
      return `support.digitsToInteger(${stringExpression(context, input)})`;
    case IntegerOpKind.MOD_DIGITS:
      return `support.modDigits(${stringExpression(context, input)}, ${modulus})`;
    case IntegerOpKind.WEIGHTED_SUM:
      return weightedSum(context, node, input);
    case IntegerOpKind.MODULO:
      return `support.modulo(${integerExpression(context, input)}, ${modulus})`;
    case IntegerOpKind.COMPLEMENT:
      return `support.complement(${integerExpression(context, input)}, ${modulus})`;
    default: {
      const table = context.constants.remainders(operation.remainderValues ?? []);
      return `support.remainderMap(${integerExpression(context, input)}, ${table})`;
    }
  }
}

function weightedSum(context: EmitContext, node: IrNode, input: number): string {
  const operation = node.operation;
  if (operation.family !== "integer") {
    throw new GeneratorError("a weighted sum outside an integer operation");
  }
  const weights = context.constants.weights(operation.weights ?? []);
  const mapper = mapperOf(context, operation.mapping, operation.alphabet);
  const paired =
    operation.alignment === WeightAlignment.LEFT
      ? "weightedSumLeft"
      : operation.alignment === WeightAlignment.RIGHT
        ? "weightedSumRight"
        : "weightedSumCycle";
  return `support.${paired}(${stringExpression(context, input)}, ${weights}, ${mapper})`;
}

function mapperOf(
  context: EmitContext,
  mapping: CharMapping | undefined,
  alphabet: ReadonlyMap<number, number> | undefined,
): string {
  if (mapping === CharMapping.DIGIT_VALUE) {
    return "support.digitValue";
  }
  if (mapping === CharMapping.ALNUM_BASE36) {
    return "support.base36Value";
  }
  if (alphabet === undefined) {
    throw new GeneratorError("a custom alphabet mapping without an alphabet");
  }
  // The loader proved the alphabet lists no code point twice, so ordering the
  // entries by their index reconstructs the declared alphabet exactly.
  const points = [...alphabet.entries()]
    .sort((left, right) => left[1] - right[1])
    .map(([point]) => point);
  return context.helpers.alphabet(points);
}

/** Emits the boolean a predicate node produces. */
export function predicateExpression(context: EmitContext, index: number): string {
  const node = nodeAt(context, index);
  const operation = node.operation;
  if (operation.family !== "predicate") {
    throw new GeneratorError(`node ${String(index)} does not produce a boolean`);
  }
  const view = (position: number): string => stringExpression(context, node.inputs[position] ?? -1);
  switch (operation.kind) {
    case PredicateOpKind.IS_EMPTY:
      return `support.isEmpty(${view(0)})`;
    case PredicateOpKind.IS_ABSENT:
      return `(${view(0)} === undefined)`;
    case PredicateOpKind.EQUALS:
      return `support.equals(${view(0)}, ${view(1)})`;
    case PredicateOpKind.LENGTH_EQ:
      return `(${view(0)}?.length === ${String(operation.length ?? 0)})`;
    case PredicateOpKind.LENGTH_IN:
      return `support.lengthIn(${view(0)}, ${context.constants.lengths(operation.lengths ?? [])})`;
    case PredicateOpKind.LENGTH_BETWEEN:
      return `support.lengthBetween(${view(0)}, ${String(operation.minLength ?? 0)}, ${String(operation.maxLength ?? 0)})`;
    case PredicateOpKind.ASCII_DIGITS:
      return `support.asciiDigits(${view(0)})`;
    case PredicateOpKind.ASCII_UPPER_LETTERS:
      return `support.asciiUpperLetters(${view(0)})`;
    case PredicateOpKind.ASCII_ALPHANUMERIC:
      return `support.asciiAlphanumeric(${view(0)})`;
    case PredicateOpKind.ALL:
      // Short-circuits at the first false operand, as the IR requires.
      return `(${node.inputs.map((input) => predicateExpression(context, input)).join(" && ")})`;
    case PredicateOpKind.ANY:
      return `(${node.inputs.map((input) => predicateExpression(context, input)).join(" || ")})`;
    case PredicateOpKind.NOT:
      return `!${predicateExpression(context, node.inputs[0] ?? -1)}`;
    case PredicateOpKind.PROFILE_IS:
      return `(${context.profile} === ${quote(operation.profile ?? "compatible")})`;
    case PredicateOpKind.INTEGER_IS:
      // An indeterminate operand is `undefined`, which never equals a literal,
      // so the branch simply does not apply.
      return `(${integerExpression(context, node.inputs[0] ?? -1)} === ${(operation.constant ?? 0n).toString()}n)`;
    default:
      return textPredicate(context, node, operation);
  }
}

/** The predicates that compare a view against constant text or a set. */
function textPredicate(
  context: EmitContext,
  node: IrNode,
  operation: IrPredicateOperation,
): string {
  const view = stringExpression(context, node.inputs[0] ?? -1);
  const text = (): string => context.constants.codePoints(operation.textCodePoints ?? []);
  const charset = (): string =>
    context.helpers.charset([...(operation.charset ?? new Set<number>())]);

  switch (operation.kind) {
    case PredicateOpKind.ASCII_CHARSET:
      return `support.charsetAll(${view}, ${charset()})`;
    case PredicateOpKind.STARTS_WITH:
      return `support.startsWith(${view}, ${text()})`;
    case PredicateOpKind.ENDS_WITH:
      return `support.endsWith(${view}, ${text()})`;
    case PredicateOpKind.PREFIX_IN: {
      const values = operation.values ?? [];
      const names = values.map((value) => context.constants.codePoints(codePointsOf(value)));
      // The distinct element lengths, ascending. The search asks the list once
      // per length, so this is what keeps it logarithmic in the list rather
      // than linear: every published table holds one length, and Germany's two
      // are already split into a table each.
      const lengths = [...new Set(values.map((value) => codePointsOf(value).length))].sort(
        (left, right) => left - right,
      );
      return `support.prefixIn(${view}, ${context.constants.prefixes(names)}, ${context.constants.lengths(lengths)})`;
    }
    case PredicateOpKind.CHAR_AT_IN:
      return `support.charAtIn(${view}, ${String(operation.index ?? 0)}, ${charset()})`;
    default:
      return `support.contains(${view}, ${text()})`;
  }
}

/** Emits the checksum outcome a node produces. */
export function checksumExpression(context: EmitContext, index: number): string {
  const node = nodeAt(context, index);
  const operation = node.operation;

  if (operation.family === "call") {
    const view = stringExpression(context, node.inputs[0] ?? -1);
    return `${context.nameOf(operation.programId)}(${context.argumentsOf(operation.programId, view)})`;
  }
  if (operation.family !== "checksum") {
    throw new GeneratorError(`node ${String(index)} does not produce a checksum outcome`);
  }

  const key = operation.messageKey === undefined ? "" : `, ${quote(operation.messageKey)}`;
  const view = (position: number): string => stringExpression(context, node.inputs[position] ?? -1);
  const integer = (position: number): string =>
    integerExpression(context, node.inputs[position] ?? -1);

  switch (operation.kind) {
    case ChecksumOpKind.LUHN:
      return `support.verdict(support.luhn(${view(0)})${key})`;
    case ChecksumOpKind.ISO7064_MOD97_10:
      return `support.verdict(support.iso7064Mod97(${view(0)})${key})`;
    case ChecksumOpKind.COMPARE_DIGIT:
      return `support.verdict(support.comparedDigit(${integer(0)}, ${view(1)}, ${String(operation.index ?? 0)})${key})`;
    case ChecksumOpKind.COMPARE_SLICE:
      return `support.verdict(support.comparedSlice(${integer(0)}, ${view(1)}, ${String(operation.start ?? 0)}, ${String(operation.end ?? 0)})${key})`;
    case ChecksumOpKind.COMPARE_CONSTANT:
      return `support.verdict(support.comparedConstant(${integer(0)}, ${(operation.constant ?? 0n).toString()}n)${key})`;
    case ChecksumOpKind.ALL_CHECKS:
      return `support.allChecks([${node.inputs.map((input) => checksumExpression(context, input)).join(", ")}])`;
    case ChecksumOpKind.ANY_CHECK:
      return `support.anyCheck([${node.inputs.map((input) => checksumExpression(context, input)).join(", ")}])`;
    case ChecksumOpKind.CHOOSE:
      return `${context.chooseOf(index)}(${context.chooseArguments})`;
    case ChecksumOpKind.WHEN:
      throw new GeneratorError("a WHEN branch reached outside a CHOOSE");
    default:
      return outcomeExpression(operation.reasonCode, operation.messageKey);
  }
}

/** The literal for a checksum outcome that states no conclusion. */
export function outcomeExpression(
  reasonCode: string | undefined,
  messageKey: string | undefined,
): string {
  if (reasonCode === "unsupported_checksum" && messageKey === undefined) {
    return "support.UNSUPPORTED_CHECKSUM";
  }
  const key = messageKey === undefined ? "" : `, messageKey: ${quote(messageKey)}`;
  return `{ status: "unsupported", reasonCode: ${quote(reasonCode ?? "unsupported_checksum")}${key} }`;
}
