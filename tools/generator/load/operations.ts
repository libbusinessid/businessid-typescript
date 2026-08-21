/**
 * Checks 10 to 13: what each node says it does.
 *
 * Check 10 is where an unresolved opcode finally meets the table. An operation
 * absent from it is `invalid_ruleset`, never `incompatible_ruleset`: a bundle
 * legitimately using a newer operation declares the capability that introduced
 * it, so an engine too old to understand it stopped at check 4. Reaching here
 * with an unknown operation means the bundle used one without declaring it.
 */
import {
  type Program as ProtoProgram,
  type RuleBundle,
} from "../../../generated/libbusinessid/ir/v1/rules_pb.js";
import { OPCODE_TABLES, type OperationCase } from "../opcodes.js";
import { invalid, isPresent, type ResolvedNode } from "./diagnostics.js";
import { checkArithmetic } from "./arithmetic.js";

/** Every program's nodes with their operation resolved. */
export type ResolvedPrograms = ReadonlyMap<ProtoProgram, readonly ResolvedNode[]>;

/** Runs checks 10 to 13 over every program. */
export function checkOperations(bundle: RuleBundle): ResolvedPrograms {
  const resolved = new Map<ProtoProgram, readonly ResolvedNode[]>();
  for (const program of bundle.programs) {
    resolved.set(program, resolveProgram(program));
  }
  for (const program of bundle.programs) {
    const nodes = resolved.get(program) ?? [];
    checkOperands(program, nodes);
    checkParameters(program, nodes);
    for (const [index, entry] of nodes.entries()) {
      checkArithmetic(`program ${String(program.id)} node ${String(index)}`, entry, nodes);
    }
  }
  return resolved;
}

/** Check 10: every operation known, with its declared output type. */
function resolveProgram(program: ProtoProgram): readonly ResolvedNode[] {
  const nodes: ResolvedNode[] = [];
  for (const [index, node] of program.nodes.entries()) {
    const where = `program ${String(program.id)} node ${String(index)}`;
    const operationCase: OperationCase | undefined = node.operation.case;
    if (operationCase === undefined) {
      invalid(10, `${where} carries no operation`);
    }
    const family = OPCODE_TABLES[operationCase];
    const message = node.operation.value as unknown as Record<string, unknown>;
    const kind = message["kind"];
    if (typeof kind !== "number") {
      invalid(10, `${where} carries no operation kind`);
    }
    const spec = family.table.get(kind);
    if (spec === undefined) {
      invalid(10, `${where} uses unknown ${operationCase} kind ${String(kind)}`);
    }
    if (node.outputType !== spec.output) {
      invalid(
        10,
        `${where} declares output type ${String(node.outputType)}, ${spec.name} produces ${String(spec.output)}`,
      );
    }
    nodes.push({ node, spec, operationCase, message });
  }
  return nodes;
}

/** Check 11: operand count, operand types and strictly lower operand indices. */
function checkOperands(program: ProtoProgram, nodes: readonly ResolvedNode[]): void {
  for (const [index, entry] of nodes.entries()) {
    const where = `program ${String(program.id)} node ${String(index)}`;
    const inputs = entry.node.inputNodes;
    for (const operand of inputs) {
      if (operand >= index) {
        invalid(11, `${where} references node ${String(operand)}, which is not a lower index`);
      }
    }
    const { fixed, tail } = entry.spec.operands;
    if (tail === undefined) {
      if (inputs.length !== fixed.length) {
        invalid(
          11,
          `${where} passes ${String(inputs.length)} operands to ${entry.spec.name}, which takes ${String(fixed.length)}`,
        );
      }
    } else {
      const extra = inputs.length - fixed.length;
      if (extra < tail.min || extra > tail.max) {
        invalid(
          11,
          `${where} passes ${String(extra)} repeated operands to ${entry.spec.name}, outside its bounds`,
        );
      }
    }
    for (const [position, operand] of inputs.entries()) {
      const expected = position < fixed.length ? fixed[position] : tail?.type;
      const actual = nodes[operand]?.node.outputType;
      if (expected !== actual) {
        invalid(
          11,
          `${where} operand ${String(position)} has type ${String(actual)}, ${entry.spec.name} expects ${String(expected)}`,
        );
      }
    }
  }
}

/** Check 12: only the parameters the operation declares, and every required one. */
function checkParameters(program: ProtoProgram, nodes: readonly ResolvedNode[]): void {
  for (const [index, entry] of nodes.entries()) {
    const where = `program ${String(program.id)} node ${String(index)}`;
    const allowed = new Set([...entry.spec.required, ...entry.spec.optional]);
    for (const parameter of OPCODE_TABLES[entry.operationCase].parameters) {
      const present = isPresent(entry.message, parameter.key, parameter.repeated);
      if (present && !allowed.has(parameter.name)) {
        invalid(12, `${where} carries ${parameter.name}, foreign to ${entry.spec.name}`);
      }
      if (!present && entry.spec.required.includes(parameter.name)) {
        invalid(12, `${where} omits ${parameter.name}, required by ${entry.spec.name}`);
      }
    }
  }
}
