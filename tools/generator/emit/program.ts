/**
 * Emits a program as a TypeScript function.
 *
 * Canonicalization is a sequence of statements over a mutable local, because
 * `value()` designates the value current at the moment the enclosing step runs.
 * A format rule is a sequence of guarded returns, so the first failing
 * assertion is what the function reports. A `CHOOSE` becomes its own function
 * whose branches are `if` statements, which is exactly what "returns the
 * outcome of the first applicable branch" means once a `WHEN` predicate is a
 * condition rather than a value.
 */
import {
  AssertionOpKind,
  CanonicalizationOpKind,
  ChecksumOpKind,
  ProgramKind,
} from "../../../generated/libbusinessid/ir/v1/rules_pb.js";
import { codePointsOf } from "../../../src/runtime/text.js";
import { GeneratorError } from "../errors.js";
import type { IrProgram } from "../ir.js";
import {
  checksumExpression,
  type EmitContext,
  predicateExpression,
  stringExpression,
} from "./expression.js";

const quote = (value: string): string => JSON.stringify(value);
const indent = (lines: readonly string[], depth: number): string[] =>
  lines.map((line) => (line === "" ? line : `${"  ".repeat(depth)}${line}`));

/** Emits the statements of a canonicalization step. */
function canonicalizationStatements(context: EmitContext, index: number, local: string): string[] {
  const node = context.program.nodes[index];
  if (node?.operation.family !== "canonicalization") {
    throw new GeneratorError(`node ${String(index)} is not a canonicalization step`);
  }
  const operation = node.operation;
  const text = (): string => context.constants.codePoints(operation.textCodePoints ?? []);
  const assign = (expression: string): string[] => [`${local} = ${expression};`];

  switch (operation.kind) {
    case CanonicalizationOpKind.SEQUENCE:
      return node.inputs.flatMap((input) => canonicalizationStatements(context, input, local));

    case CanonicalizationOpKind.WHEN: {
      const predicate = predicateExpression(context, node.inputs[0] ?? -1);
      const body = node.inputs
        .slice(1)
        .flatMap((input) => canonicalizationStatements(context, input, local));
      return [`if (${predicate}) {`, ...indent(body, 1), `}`];
    }

    case CanonicalizationOpKind.TRIM_WHITESPACE:
      return assign(`support.trimWhitespace(${local})`);
    case CanonicalizationOpKind.REMOVE_WHITESPACE:
      return assign(`support.removeWhitespace(${local})`);
    case CanonicalizationOpKind.UPPERCASE_ASCII:
      return assign(`support.upperCaseAscii(${local})`);
    case CanonicalizationOpKind.REMOVE_CHARS:
      return assign(
        `support.removeChars(${local}, ${context.helpers.charset([...(operation.charset ?? new Set<number>())])})`,
      );
    case CanonicalizationOpKind.REPLACE_PREFIX: {
      const replacement = context.constants.codePoints(codePointsOf(operation.replacement ?? ""));
      return assign(`support.replacePrefix(${local}, ${text()}, ${replacement})`);
    }
    case CanonicalizationOpKind.PREPEND:
      return assign(`support.prepend(${local}, ${text()})`);
    case CanonicalizationOpKind.APPEND:
      return assign(`support.append(${local}, ${text()})`);
    case CanonicalizationOpKind.INSERT:
      return assign(`support.insert(${local}, ${String(operation.index ?? 0)}, ${text()})`);
    case CanonicalizationOpKind.LEFT_PAD: {
      const fill = operation.textCodePoints?.[0];
      if (fill === undefined) {
        throw new GeneratorError("a left pad without a fill code point");
      }
      return assign(`support.leftPad(${local}, ${String(operation.length ?? 0)}, ${String(fill)})`);
    }
    default:
      return assign(
        `support.prependIfMissing(${local}, acceptedPrefixesOf(${context.definition}), prependedPrefixOf(${context.definition}))`,
      );
  }
}

/** Emits the statements of a format assertion. */
function assertionStatements(
  context: EmitContext,
  index: number,
  counter: { next: number },
): string[] {
  const node = context.program.nodes[index];
  if (node === undefined) {
    throw new GeneratorError(`node ${String(index)} is missing`);
  }

  if (node.operation.family === "call") {
    const view = stringExpression(context, node.inputs[0] ?? -1);
    const local = `called${String(counter.next)}`;
    counter.next += 1;
    // The callee's reason code and message key propagate unchanged.
    return [
      `const ${local} = ${context.nameOf(node.operation.programId)}(${context.argumentsOf(node.operation.programId, view)});`,
      `if (${local}.failed) {`,
      `  return ${local};`,
      `}`,
    ];
  }

  if (node.operation.family !== "assertion") {
    throw new GeneratorError(`node ${String(index)} does not produce an assertion`);
  }

  if (node.operation.kind === AssertionOpKind.SEQUENCE) {
    return node.inputs.flatMap((input) => assertionStatements(context, input, counter));
  }

  const operation = node.operation;
  if (operation.reasonCode === undefined) {
    throw new GeneratorError("a require without a reason code");
  }
  const key =
    operation.messageKey === undefined ? "" : `, messageKey: ${quote(operation.messageKey)}`;
  return [
    `if (${negate(predicateExpression(context, node.inputs[0] ?? -1))}) {`,
    `  return { failed: true, reasonCode: ${quote(operation.reasonCode)}${key} };`,
    `}`,
  ];
}

/**
 * The condition under which an assertion fails.
 *
 * A rule usually reads `require(not(...))`, and emitting the negation of a
 * negation would leave `!!` in the output for no reason.
 */
function negate(expression: string): string {
  return expression.startsWith("!") ? expression.slice(1) : `!${wrap(expression)}`;
}

function wrap(expression: string): string {
  return expression.startsWith("(") ? expression : `(${expression})`;
}

/** Emits the body of a `CHOOSE`, whose branches are conditions. */
export function chooseBody(context: EmitContext, index: number): string[] {
  const node = context.program.nodes[index];
  if (node?.operation.family !== "checksum" || node.operation.kind !== ChecksumOpKind.CHOOSE) {
    throw new GeneratorError(`node ${String(index)} is not a choose`);
  }
  const lines: string[] = [];
  for (const input of node.inputs) {
    const branch = context.program.nodes[input];
    if (branch?.operation.family === "checksum" && branch.operation.kind === ChecksumOpKind.WHEN) {
      const predicate = predicateExpression(context, branch.inputs[0] ?? -1);
      const rule = checksumExpression(context, branch.inputs[1] ?? -1);
      lines.push(`if (${wrap(predicate)}) {`, `  return ${rule};`, `}`);
      continue;
    }
    // Any branch that is not a WHEN always applies, so nothing after it can be
    // reached.
    lines.push(`return ${checksumExpression(context, input)};`);
    return lines;
  }
  // No branch applied: no published algorithm covers this value.
  lines.push(`return support.UNSUPPORTED_CHECKSUM;`);
  return lines;
}

/** Emits the body of a whole program. */
export function programBody(context: EmitContext, program: IrProgram, local: string): string[] {
  if (program.kind === ProgramKind.CANONICALIZATION) {
    const steps = canonicalizationStatements(context, program.rootNode, local);
    return [`let ${local} = value;`, ...steps, `return ${local};`];
  }
  if (program.kind === ProgramKind.FORMAT) {
    return [
      ...assertionStatements(context, program.rootNode, { next: 0 }),
      `return support.PASSED;`,
    ];
  }
  const root = program.nodes[program.rootNode];
  if (root?.operation.family === "checksum" && root.operation.kind === ChecksumOpKind.CHOOSE) {
    return chooseBody(context, program.rootNode);
  }
  return [`return ${checksumExpression(context, program.rootNode)};`];
}
