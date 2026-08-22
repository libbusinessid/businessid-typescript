/**
 * Checks 24 and 25: the call graph and declared capabilities.
 *
 * Check 23 is what lets a generated engine drop the step budget entirely: an
 * acyclic graph of bounded depth terminates by construction. Check 24 closes
 * the loophole check 4 leaves open — a forged bundle that uses an operation
 * without declaring the capability that introduced it would otherwise slip past
 * the version gate.
 */
import {
  CharMapping,
  type Program as ProtoProgram,
  type RuleBundle,
  SourceTier,
} from "../../../generated/libbusinessid/ir/v1/rules_pb.js";
import { CAPABILITY } from "../capabilities.js";
import { LIMITS } from "../limits.js";
import { invalid } from "./diagnostics.js";
import type { ResolvedPrograms } from "./operations.js";

/** Check 23: the call graph is acyclic, typed and of static depth at most 32. */
export function checkCallGraph(
  bundle: RuleBundle,
  resolved: ResolvedPrograms,
  programs: ReadonlyMap<number, ProtoProgram>,
): void {
  const edges = collectEdges(bundle, resolved, programs);
  const depths = new Map<number, number>();
  const onStack = new Set<number>();

  const depthOf = (id: number): number => {
    const known = depths.get(id);
    if (known !== undefined) {
      return known;
    }
    if (onStack.has(id)) {
      invalid(24, `program ${String(id)} takes part in a call cycle`);
    }
    onStack.add(id);
    let deepest = 1;
    for (const callee of edges.get(id) ?? []) {
      deepest = Math.max(deepest, 1 + depthOf(callee));
    }
    onStack.delete(id);
    depths.set(id, deepest);
    return deepest;
  };

  for (const id of edges.keys()) {
    if (depthOf(id) > LIMITS.callDepth) {
      invalid(24, `program ${String(id)} reaches a call depth above ${String(LIMITS.callDepth)}`);
    }
  }
}

function collectEdges(
  bundle: RuleBundle,
  resolved: ResolvedPrograms,
  programs: ReadonlyMap<number, ProtoProgram>,
): ReadonlyMap<number, readonly number[]> {
  const edges = new Map<number, number[]>();
  for (const program of bundle.programs) {
    const callees: number[] = [];
    for (const [index, entry] of (resolved.get(program) ?? []).entries()) {
      if (entry.operationCase !== "callOperation") {
        continue;
      }
      const where = `program ${String(program.id)} node ${String(index)}`;
      const { programId } = entry.message as { programId: number };
      const callee = programs.get(programId);
      if (callee === undefined) {
        invalid(24, `${where} calls unknown program ${String(programId)}`);
      }
      if (callee.kind !== program.kind) {
        invalid(24, `${where} calls a program of another kind`);
      }
      callees.push(programId);
    }
    edges.set(program.id, callees);
  }
  return edges;
}

/** Check 24: no capability used without being declared. */
export function checkCapabilities(
  bundle: RuleBundle,
  resolved: ResolvedPrograms,
  declared: ReadonlySet<number>,
): void {
  // Named `demand` rather than `require`: nothing in this package may ever
  // reach for the CommonJS global, and a reader grepping for it should find
  // nothing.
  const demand = (capability: number, used: string): void => {
    if (!declared.has(capability)) {
      invalid(25, `${used} requires capability ${String(capability)}, which the bundle omits`);
    }
  };

  for (const program of bundle.programs) {
    for (const entry of resolved.get(program) ?? []) {
      for (const capability of entry.spec.capabilities) {
        demand(capability, entry.spec.name);
      }
      if (entry.operationCase === "integerOperation") {
        const { mapping } = entry.message as { mapping?: number };
        if (mapping === CharMapping.CUSTOM_ALPHABET) {
          // The capability belongs to the variant, not to the operation: a
          // weighted sum over digits must not have to implement an alphabet it
          // never reads.
          demand(CAPABILITY.CHECKSUM_CUSTOM_ALPHABET_V1, "CHAR_MAPPING_CUSTOM_ALPHABET");
        }
      }
    }
    if (program.captures.length > 0 || program.subjectNode !== undefined) {
      demand(CAPABILITY.CAPTURES_AND_CALLS_V1, "Program.captures or Program.subject_node");
    }
  }

  for (const definition of bundle.identifiers) {
    // `default_profile` is not optional in the schema, so every definition
    // states one and the capability freezing the field is always required.
    demand(CAPABILITY.PROFILES_V1, "IdentifierDefinition.default_profile");
    if (definition.absentChecksumReason !== undefined) {
      demand(CAPABILITY.CHECKSUM_TRISTATE_V1, "IdentifierDefinition.absent_checksum_reason");
    }
    if (definition.sources.length > 0) {
      demand(CAPABILITY.PROVENANCE_V1, "IdentifierDefinition.sources");
    }
    for (const source of definition.sources) {
      // `tier` is not optional either, so an omitted field and an explicit
      // UNSPECIFIED are the same bytes: only a stated tier requires the
      // capability. Refusing UNSPECIFIED would make it mandatory the moment
      // PROVENANCE_V1 is, which is the opposite of the independence a separate
      // id exists to give.
      if (source.tier !== SourceTier.UNSPECIFIED) {
        demand(CAPABILITY.PROVENANCE_TIER_V1, "Source.tier");
      }
    }
  }

  if (bundle.dispatchers.length > 0) {
    demand(CAPABILITY.IDENTIFIER_DISPATCH_V1, "IdentifierDispatcher");
  }
}
