/**
 * Checks 15 and 16: what a program is shaped like.
 *
 * Check 14 places the root, the subject and the captures inside the program and
 * types them. Check 15 asks the different question of which operation may sit
 * where: the accepted root of each program kind, the families a kind may use,
 * `WHEN` only inside `CHOOSE`, and the five operations a pre-canonicalization
 * program is limited to.
 */
import {
  AssertionOpKind,
  CallOpKind,
  CanonicalizationOpKind,
  type Capture,
  ChecksumOpKind,
  ProgramKind,
  type Program as ProtoProgram,
  type RuleBundle,
  StringOpKind,
  ValueType,
} from "../../../generated/entid/ir/v1/rules_pb.js";
import { LIMITS } from "../limits.js";
import { OPCODE_TABLES } from "../opcodes.js";
import { invalid, type ResolvedNode } from "./diagnostics.js";
import type { ResolvedPrograms } from "./operations.js";

/** The node type each program kind must root at. */
const ROOT_TYPES: Readonly<Record<number, ValueType>> = {
  [ProgramKind.CANONICALIZATION]: ValueType.CANONICALIZATION_STEP,
  [ProgramKind.FORMAT]: ValueType.ASSERTION,
  [ProgramKind.CHECKSUM]: ValueType.CHECKSUM_OUTCOME,
};

/** The operation families each program kind accepts, per `ir.md` section 2. */
const ALLOWED_FAMILIES: Readonly<Record<number, ReadonlySet<string>>> = {
  [ProgramKind.CANONICALIZATION]: new Set(["string", "predicate", "canonicalization"]),
  [ProgramKind.FORMAT]: new Set(["string", "predicate", "assertion", "call"]),
  [ProgramKind.CHECKSUM]: new Set(["string", "predicate", "integer", "checksum", "call"]),
};

/** The five operations a pre-canonicalization program may use. */
const PRE_CANONICALIZATION_OPS: ReadonlySet<number> = new Set([
  CanonicalizationOpKind.SEQUENCE,
  CanonicalizationOpKind.TRIM_WHITESPACE,
  CanonicalizationOpKind.REMOVE_WHITESPACE,
  CanonicalizationOpKind.UPPERCASE_ASCII,
  CanonicalizationOpKind.REMOVE_CHARS,
]);

/** Runs checks 14 and 15 over every program. */
export function checkProgramShapes(bundle: RuleBundle, resolved: ResolvedPrograms): void {
  const preCanonicalization = new Set(
    bundle.dispatchers.map((dispatcher) => dispatcher.preCanonicalizationProgram),
  );
  const globalCanonicalizers = new Set(
    bundle.identifiers
      .filter((definition) => definition.countryCode === undefined)
      .map((definition) => definition.canonicalizationProgram),
  );

  for (const program of bundle.programs) {
    const nodes = resolved.get(program) ?? [];
    checkAnchors(program, nodes);
    checkFamilies(program, nodes, preCanonicalization, globalCanonicalizers);
    checkRoot(program, nodes);
    checkWhenBranches(`program ${String(program.id)}`, nodes);
  }
}

/** Check 14: root, subject and capture nodes inside the program and typed. */
function checkAnchors(program: ProtoProgram, nodes: readonly ResolvedNode[]): void {
  const where = `program ${String(program.id)}`;
  if (nodes.length === 0) {
    invalid(15, `${where} declares no node`);
  }
  if (program.rootNode >= nodes.length) {
    invalid(15, `${where} roots at node ${String(program.rootNode)}, outside the program`);
  }
  if (nodes[program.rootNode]?.node.outputType !== ROOT_TYPES[program.kind]) {
    invalid(15, `${where} roots at a node of the wrong type`);
  }
  if (program.subjectNode !== undefined) {
    if (program.kind === ProgramKind.CANONICALIZATION) {
      invalid(15, `${where} is a canonicalization program and declares a subject`);
    }
    if (program.subjectNode >= nodes.length) {
      invalid(15, `${where} declares a subject outside the program`);
    }
    if (nodes[program.subjectNode]?.node.outputType !== ValueType.STRING) {
      invalid(15, `${where} declares a subject that does not produce a string`);
    }
    checkSubjectIsNotCircular(where, program.subjectNode, nodes);
  }
  checkCaptures(where, program, nodes);
}

/**
 * A subject node may not read the subject it defines.
 *
 * `Program.subject_node` produces `subject()` for a top level invocation, so a
 * subtree that reads `subject()` asks for the value it is computing. A
 * generator emitting it recurses forever and an interpreter exhausts its
 * budget, and nothing else sees it: the node is checked for scope and for type,
 * and never walked.
 *
 * `value()` is a different matter and stays allowed. The canonical value exists
 * before any subject does, so a subject built from it is well founded.
 */
function checkSubjectIsNotCircular(
  where: string,
  subject: number,
  nodes: readonly ResolvedNode[],
): void {
  const seen = new Set<number>();
  const pending = [subject];
  while (pending.length > 0) {
    const index = pending.pop();
    if (index === undefined || seen.has(index)) {
      continue;
    }
    seen.add(index);
    const entry = nodes[index];
    if (entry === undefined) {
      continue;
    }
    if (
      entry.operationCase === "stringOperation" &&
      (entry.message as { kind: StringOpKind }).kind === StringOpKind.SUBJECT
    ) {
      invalid(
        15,
        `${where} builds its subject from subject(), the value that subject node defines`,
      );
    }
    for (const input of entry.node.inputNodes) {
      pending.push(input);
    }
  }
}

function checkCaptures(where: string, program: ProtoProgram, nodes: readonly ResolvedNode[]): void {
  if (program.captures.length === 0) {
    return;
  }
  if (program.kind !== ProgramKind.FORMAT) {
    invalid(15, `${where} declares captures but is not a format program`);
  }
  if (program.captures.length > LIMITS.capturesPerFormat) {
    invalid(15, `${where} declares ${String(program.captures.length)} captures`);
  }
  const names = new Set<string>();
  for (const capture of program.captures satisfies readonly Capture[]) {
    if (capture.name === "") {
      invalid(15, `${where} declares an unnamed capture`);
    }
    if (names.has(capture.name)) {
      invalid(15, `${where} declares capture ${capture.name} twice`);
    }
    names.add(capture.name);
    if (capture.node >= nodes.length) {
      invalid(15, `${where} capture ${capture.name} points outside the program`);
    }
    if (nodes[capture.node]?.node.outputType !== ValueType.STRING) {
      invalid(15, `${where} capture ${capture.name} does not name a string node`);
    }
  }
}

/** Check 15, first half: which operations a program kind may hold. */
function checkFamilies(
  program: ProtoProgram,
  nodes: readonly ResolvedNode[],
  preCanonicalization: ReadonlySet<number>,
  globalCanonicalizers: ReadonlySet<number>,
): void {
  const where = `program ${String(program.id)}`;
  const allowed = ALLOWED_FAMILIES[program.kind] ?? new Set<string>();
  const isPre = preCanonicalization.has(program.id);
  const isGlobal = globalCanonicalizers.has(program.id);

  for (const [index, entry] of nodes.entries()) {
    const family = OPCODE_TABLES[entry.operationCase].family;
    const at = `${where} node ${String(index)}`;
    if (!allowed.has(family)) {
      invalid(16, `${at} uses ${entry.spec.name}, foreign to its kind`);
    }
    if (family === "string" && program.kind === ProgramKind.CANONICALIZATION) {
      if ((entry.message as { kind: StringOpKind }).kind === StringOpKind.SUBJECT) {
        invalid(16, `${at} reads subject() in a canonicalization program`);
      }
    }
    if (family === "call") {
      const expected =
        program.kind === ProgramKind.FORMAT ? CallOpKind.FORMAT : CallOpKind.CHECKSUM;
      if ((entry.message as { kind: CallOpKind }).kind !== expected) {
        invalid(16, `${at} calls a program of another kind`);
      }
    }
    if (family === "canonicalization") {
      const kind = (entry.message as { kind: CanonicalizationOpKind }).kind;
      if (isPre && !PRE_CANONICALIZATION_OPS.has(kind)) {
        invalid(
          16,
          `${at} sits in a pre-canonicalization program and uses ${entry.spec.name}, which may add, replace or interpret a prefix`,
        );
      }
      if (isGlobal && kind === CanonicalizationOpKind.PREPEND_COUNTRY_IF_MISSING) {
        // A GLOBAL target has no country and no prefix, so there is nothing for
        // this step to prepend.
        invalid(16, `${at} prepends a country in a canonicalizer of a GLOBAL definition`);
      }
    }
  }
}

/** Check 15, second half: the accepted root of each program kind. */
function checkRoot(program: ProtoProgram, nodes: readonly ResolvedNode[]): void {
  const where = `program ${String(program.id)}`;
  const root = nodes[program.rootNode];
  if (root === undefined) {
    invalid(16, `${where} has no root node`);
  }
  if (program.kind === ProgramKind.CANONICALIZATION) {
    if (
      (root.message as { kind: CanonicalizationOpKind }).kind !== CanonicalizationOpKind.SEQUENCE
    ) {
      invalid(16, `${where} does not root at a canonicalization sequence`);
    }
    return;
  }
  if (program.kind === ProgramKind.FORMAT) {
    if (
      root.operationCase !== "assertionOperation" ||
      (root.message as { kind: AssertionOpKind }).kind !== AssertionOpKind.SEQUENCE
    ) {
      invalid(16, `${where} does not root at an assertion sequence`);
    }
    return;
  }
  if (
    root.operationCase === "checksumOperation" &&
    (root.message as { kind: ChecksumOpKind }).kind === ChecksumOpKind.WHEN
  ) {
    invalid(16, `${where} roots at a WHEN branch`);
  }
}

/**
 * A checksum `WHEN` is a branch, never a rule of its own.
 *
 * Outside a `CHOOSE` its non applicable state has no defined behaviour, so a
 * bundle that can reach one from anywhere else is refused.
 */
function checkWhenBranches(where: string, nodes: readonly ResolvedNode[]): void {
  const byChoose = new Set<number>();
  const byOther = new Set<number>();
  for (const entry of nodes) {
    const isChoose =
      entry.operationCase === "checksumOperation" &&
      (entry.message as { kind: ChecksumOpKind }).kind === ChecksumOpKind.CHOOSE;
    for (const operand of entry.node.inputNodes) {
      (isChoose ? byChoose : byOther).add(operand);
    }
  }
  for (const [index, entry] of nodes.entries()) {
    if (
      entry.operationCase !== "checksumOperation" ||
      (entry.message as { kind: ChecksumOpKind }).kind !== ChecksumOpKind.WHEN
    ) {
      continue;
    }
    if (byOther.has(index) || !byChoose.has(index)) {
      invalid(16, `${where} node ${String(index)} is a WHEN branch outside a CHOOSE`);
    }
  }
}
