/**
 * What each program reads from its environment.
 *
 * A program is emitted as a function, and a function that declares a parameter
 * it never uses does not compile under this project's settings. So the emitter
 * asks first: does this program read the canonical value, a caller supplied
 * subject, the selected definition, or the effective profile?
 *
 * Needs propagate along calls, except the subject: a callee's subject is the
 * view its caller passes, so it is the caller's operand and not its own
 * environment.
 */
import {
  CanonicalizationOpKind,
  PredicateOpKind,
  StringOpKind,
} from "../../../generated/entid/ir/v1/rules_pb.js";
import type { IrProgram, LoadedBundle } from "../ir.js";

/** What one program reads. */
export interface ProgramNeeds {
  /** Reads `value()`, the canonical value of the identifier under validation. */
  value: boolean;
  /** Reads `subject()`. */
  subject: boolean;
  /** Reads the selected definition: its country, or the prefixes of its target. */
  definition: boolean;
  /** Reads the effective profile. */
  profile: boolean;
}

/**
 * The nodes a program actually evaluates.
 *
 * A node no root reaches is dead: the emitter never walks it, so counting its
 * needs would declare a parameter the emitted function never uses.
 */
function reachable(program: IrProgram): Set<number> {
  const seen = new Set<number>();
  const visit = (index: number): void => {
    if (seen.has(index)) {
      return;
    }
    seen.add(index);
    for (const input of program.nodes[index]?.inputs ?? []) {
      visit(input);
    }
  };
  visit(program.rootNode);
  if (program.subjectNode !== undefined) {
    visit(program.subjectNode);
  }
  return seen;
}

function direct(program: IrProgram): ProgramNeeds {
  const needs: ProgramNeeds = {
    value: false,
    subject: false,
    definition: false,
    profile: false,
  };
  const live = reachable(program);
  for (const index of live) {
    const node = program.nodes[index];
    if (node === undefined) {
      continue;
    }
    const operation = node.operation;
    if (operation.family === "string") {
      if (operation.kind === StringOpKind.VALUE) {
        needs.value = true;
      } else if (operation.kind === StringOpKind.SUBJECT) {
        needs.subject = true;
      } else if (operation.kind === StringOpKind.COUNTRY_CODE) {
        needs.definition = true;
      }
    } else if (
      operation.family === "canonicalization" &&
      operation.kind === CanonicalizationOpKind.PREPEND_COUNTRY_IF_MISSING
    ) {
      needs.definition = true;
    } else if (operation.family === "predicate" && operation.kind === PredicateOpKind.PROFILE_IS) {
      needs.profile = true;
    }
  }
  return needs;
}

/**
 * The needs of every program, with calls resolved.
 *
 * The call graph is acyclic and of bounded depth, both proved by check 24, so
 * the recursion terminates without a visited set.
 */
export function analyseNeeds(bundle: LoadedBundle): ReadonlyMap<number, ProgramNeeds> {
  const resolved = new Map<number, ProgramNeeds>();

  const of = (program: IrProgram): ProgramNeeds => {
    const known = resolved.get(program.id);
    if (known !== undefined) {
      return known;
    }
    const needs = direct(program);
    resolved.set(program.id, needs);
    for (const index of reachable(program)) {
      const node = program.nodes[index];
      if (node?.operation.family !== "call") {
        continue;
      }
      const callee = bundle.programs.get(node.operation.programId);
      if (callee === undefined) {
        continue;
      }
      const inner = of(callee);
      needs.value ||= inner.value;
      needs.definition ||= inner.definition;
      needs.profile ||= inner.profile;
      // Not `subject`: the callee's subject is the view this caller passes.
    }
    return needs;
  };

  for (const program of bundle.programs.values()) {
    of(program);
  }
  return resolved;
}
