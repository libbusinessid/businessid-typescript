/**
 * Builds the representation the engine executes.
 *
 * Runs only once every check has passed. Constants are decomposed into code
 * points and character sets are turned into lookups here, so the interpreter
 * never re-scans a value the loader already read, and so nothing is constructed
 * while a validation is in flight.
 */
import {
  type AssertionOpKind,
  type CallOpKind,
  CanonicalizationOpKind,
  type ChecksumOpKind,
  type IdentifierDefinition,
  type IntegerOpKind,
  PredicateOpKind,
  type RuleBundle,
  type StringOpKind,
} from "../../../generated/libbusinessid/ir/v1/rules_pb.js";
import { VALIDATION_PROFILES, type ValidationProfile } from "../../../src/domain/profile.js";
import type {
  IrDefinition,
  IrDispatcher,
  IrNode,
  IrOperation,
  IrProgram,
  LoadedBundle,
} from "../ir.js";
import { codePointsOf } from "../../../src/runtime/text.js";
import { reasonCodeName, type ResolvedNode } from "./diagnostics.js";
import type { ResolvedPrograms } from "./operations.js";

/** Assembles the validated bundle. */
export function build(
  bundle: RuleBundle,
  resolved: ResolvedPrograms,
  definitions: ReadonlyMap<number, IdentifierDefinition>,
  dispatchers: ReadonlyMap<string, IrDispatcher>,
): LoadedBundle {
  return {
    formatVersion: bundle.formatVersion,
    rulesVersion: bundle.rulesVersion,
    capabilities: new Set(bundle.requiredFeatureIds),
    programs: buildPrograms(bundle, resolved),
    definitions: buildDefinitions(definitions),
    dispatchers,
    kindIndex: buildKindIndex(bundle, dispatchers),
  };
}

function buildPrograms(
  bundle: RuleBundle,
  resolved: ResolvedPrograms,
): ReadonlyMap<number, IrProgram> {
  const programs = new Map<number, IrProgram>();
  for (const program of bundle.programs) {
    const nodes: IrNode[] = (resolved.get(program) ?? []).map((entry) => ({
      outputType: entry.node.outputType,
      inputs: Object.freeze([...entry.node.inputNodes]),
      operation: buildOperation(entry),
    }));
    programs.set(program.id, {
      id: program.id,
      kind: program.kind,
      nodes: Object.freeze(nodes),
      rootNode: program.rootNode,
      ...(program.subjectNode === undefined ? {} : { subjectNode: program.subjectNode }),
    });
  }
  return programs;
}

function buildDefinitions(
  definitions: ReadonlyMap<number, IdentifierDefinition>,
): ReadonlyMap<number, IrDefinition> {
  const built = new Map<number, IrDefinition>();
  for (const [id, definition] of definitions) {
    const absentChecksumReason = reasonCodeName(definition.absentChecksumReason);
    built.set(id, {
      id,
      kind: definition.kind,
      ...(definition.countryCode === undefined ? {} : { countryCode: definition.countryCode }),
      canonicalizationProgram: definition.canonicalizationProgram,
      formatProgram: definition.formatProgram,
      ...(definition.checksumProgram === undefined
        ? {}
        : { checksumProgram: definition.checksumProgram }),
      defaultProfile: asProfile(definition.defaultProfile),
      ...(absentChecksumReason === undefined ? {} : { absentChecksumReason }),
    });
  }
  return built;
}

function buildKindIndex(
  bundle: RuleBundle,
  dispatchers: ReadonlyMap<string, IrDispatcher>,
): ReadonlyMap<string, IrDispatcher> {
  const index = new Map<string, IrDispatcher>();
  for (const dispatcher of bundle.dispatchers) {
    const built = dispatchers.get(dispatcher.kind);
    if (built === undefined) {
      continue;
    }
    index.set(dispatcher.kind, built);
    for (const alias of dispatcher.kindAliases) {
      index.set(alias, built);
    }
  }
  return index;
}

function buildOperation(entry: ResolvedNode): IrOperation {
  const message = entry.message;
  const text = optionalString("text", message)["text"];
  const withText =
    text === undefined ? {} : { text, textCodePoints: Object.freeze(codePointsOf(text)) };

  switch (entry.operationCase) {
    case "stringOperation":
      return {
        family: "string",
        kind: message["kind"] as StringOpKind,
        ...withText,
        ...optionalNumber("start", message),
        ...optionalNumber("end", message),
      };

    case "integerOperation": {
      const alphabet = optionalString("alphabet", message)["alphabet"];
      const weights = message["weights"] as bigint[];
      const remainderValues = message["remainderValues"] as bigint[];
      return {
        family: "integer",
        kind: message["kind"] as IntegerOpKind,
        ...optionalBigint("modulus", message),
        ...(weights.length === 0 ? {} : { weights: Object.freeze([...weights]) }),
        ...optionalNumber("alignment", message),
        ...optionalNumber("mapping", message),
        ...(remainderValues.length === 0
          ? {}
          : { remainderValues: Object.freeze([...remainderValues]) }),
        ...(alphabet === undefined
          ? {}
          : { alphabet: new Map(codePointsOf(alphabet).map((point, at) => [point, at])) }),
      };
    }

    case "predicateOperation": {
      const kind = message["kind"] as PredicateOpKind;
      const values = message["values"] as string[];
      const lengths = message["lengths"] as number[];
      const usesCharset =
        kind === PredicateOpKind.ASCII_CHARSET || kind === PredicateOpKind.CHAR_AT_IN;
      return {
        family: "predicate",
        kind,
        ...withText,
        ...(usesCharset && text !== undefined ? { charset: new Set(codePointsOf(text)) } : {}),
        ...(kind === PredicateOpKind.PROFILE_IS && isProfile(text) ? { profile: text } : {}),
        ...(values.length === 0 ? {} : { values: Object.freeze([...values]) }),
        ...(lengths.length === 0 ? {} : { lengths: Object.freeze([...lengths]) }),
        ...optionalNumber("length", message),
        ...optionalNumber("minLength", message),
        ...optionalNumber("maxLength", message),
        ...optionalNumber("index", message),
        ...optionalBigint("constant", message),
      };
    }

    case "canonicalizationOperation": {
      const kind = message["kind"] as CanonicalizationOpKind;
      return {
        family: "canonicalization",
        kind,
        ...withText,
        ...(kind === CanonicalizationOpKind.REMOVE_CHARS && text !== undefined
          ? { charset: new Set(codePointsOf(text)) }
          : {}),
        ...optionalString("replacement", message),
        ...optionalNumber("index", message),
        ...optionalNumber("length", message),
      };
    }

    case "assertionOperation": {
      const reasonCode = reasonCodeName(optionalNumber("reasonCode", message)["reasonCode"]);
      return {
        family: "assertion",
        kind: message["kind"] as AssertionOpKind,
        ...(reasonCode === undefined ? {} : { reasonCode }),
        ...optionalString("messageKey", message),
      };
    }

    case "checksumOperation": {
      const reasonCode = reasonCodeName(optionalNumber("reasonCode", message)["reasonCode"]);
      return {
        family: "checksum",
        kind: message["kind"] as ChecksumOpKind,
        ...optionalNumber("index", message),
        ...optionalNumber("start", message),
        ...optionalNumber("end", message),
        ...(reasonCode === undefined ? {} : { reasonCode }),
        ...optionalString("messageKey", message),
        ...optionalBigint("constant", message),
      };
    }

    default:
      return {
        family: "call",
        kind: message["kind"] as CallOpKind,
        programId: message["programId"] as number,
      };
  }
}

function isProfile(value: string | undefined): value is ValidationProfile {
  return VALIDATION_PROFILES.some((profile) => profile === value);
}

function asProfile(value: string): ValidationProfile {
  return VALIDATION_PROFILES.find((profile) => profile === value) ?? "compatible";
}

function optionalNumber(key: string, message: Record<string, unknown>): Record<string, number> {
  const value = message[key];
  return typeof value === "number" ? { [key]: value } : {};
}

function optionalBigint(key: string, message: Record<string, unknown>): Record<string, bigint> {
  const value = message[key];
  return typeof value === "bigint" ? { [key]: value } : {};
}

function optionalString(key: string, message: Record<string, unknown>): Record<string, string> {
  const value = message[key];
  return typeof value === "string" ? { [key]: value } : {};
}
