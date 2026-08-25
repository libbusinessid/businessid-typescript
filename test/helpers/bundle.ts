import { create, type MessageInitShape, toBinary } from "@bufbuild/protobuf";
import {
  type AssertionOperation,
  AssertionOpKind,
  type CallOperation,
  type CanonicalizationOperation,
  CanonicalizationOpKind,
  type ChecksumOperation,
  type IdentifierDefinitionSchema,
  type IdentifierDispatcherSchema,
  type IntegerOperation,
  type Node as ProtoNode,
  NodeSchema,
  type PredicateOperation,
  PredicateOpKind,
  type Program,
  ProgramKind,
  ProgramSchema,
  ReasonCode,
  type RuleBundle,
  RuleBundleSchema,
  type StringOperation,
  StringOpKind,
  ValueType,
} from "../../generated/entid/ir/v1/rules_pb.js";

/**
 * Builds well formed bundles for tests.
 *
 * Unit tests of the IR need a bundle exercising one operation and nothing else.
 * Writing those at the wire level would be unreadable, so they are built from
 * the generated types here and serialized once. Tests that need a *malformed*
 * encoding — an unknown field, a forward reference — use `helpers/wire.ts`
 * instead, because such a bundle cannot be expressed through these types.
 */

/** The capability set the helpers declare, wide enough for any built bundle. */
export const ALL_CAPABILITIES = [
  1, 2, 3, 4, 5, 10, 11, 20, 21, 30, 31, 32, 33, 34, 35, 40, 41, 42,
] as const;

type Operation =
  | { case: "stringOperation"; value: Partial<StringOperation> }
  | { case: "integerOperation"; value: Partial<IntegerOperation> }
  | { case: "predicateOperation"; value: Partial<PredicateOperation> }
  | { case: "canonicalizationOperation"; value: Partial<CanonicalizationOperation> }
  | { case: "assertionOperation"; value: Partial<AssertionOperation> }
  | { case: "checksumOperation"; value: Partial<ChecksumOperation> }
  | { case: "callOperation"; value: Partial<CallOperation> };

/** One node, before it is placed in a program. */
export interface NodeSpec {
  type: ValueType;
  inputs?: number[];
  operation: Operation;
}

export function node(type: ValueType, operation: Operation, inputs: number[] = []): NodeSpec {
  return { type, operation, ...(inputs.length === 0 ? {} : { inputs }) };
}

/* Shorthands for the nodes nearly every test needs. */

export const valueNode = (): NodeSpec =>
  node(ValueType.STRING, {
    case: "stringOperation",
    value: { kind: StringOpKind.VALUE },
  });

export const subjectNode = (): NodeSpec =>
  node(ValueType.STRING, {
    case: "stringOperation",
    value: { kind: StringOpKind.SUBJECT },
  });

export const constantNode = (text: string): NodeSpec =>
  node(ValueType.STRING, {
    case: "stringOperation",
    value: { kind: StringOpKind.CONSTANT, text },
  });

export const requireNode = (
  predicate: number,
  reasonCode: ReasonCode = ReasonCode.INVALID_FORMAT,
  messageKey?: string,
): NodeSpec =>
  node(
    ValueType.ASSERTION,
    {
      case: "assertionOperation",
      value: {
        kind: AssertionOpKind.REQUIRE,
        reasonCode,
        ...(messageKey === undefined ? {} : { messageKey }),
      },
    },
    [predicate],
  );

export const assertionSequence = (inputs: number[]): NodeSpec =>
  node(
    ValueType.ASSERTION,
    { case: "assertionOperation", value: { kind: AssertionOpKind.SEQUENCE } },
    inputs,
  );

export const canonicalizationSequence = (inputs: number[] = []): NodeSpec =>
  node(
    ValueType.CANONICALIZATION_STEP,
    { case: "canonicalizationOperation", value: { kind: CanonicalizationOpKind.SEQUENCE } },
    inputs,
  );

function toNode(spec: NodeSpec): ProtoNode {
  return create(NodeSchema, {
    outputType: spec.type,
    inputNodes: spec.inputs ?? [],
    operation: spec.operation as ProtoNode["operation"],
  });
}

/** Assembles one program. */
export function program(
  id: number,
  kind: ProgramKind,
  nodes: NodeSpec[],
  rootNode: number = nodes.length - 1,
  extras: { subjectNode?: number; captures?: { name: string; node: number }[] } = {},
): Program {
  return create(ProgramSchema, {
    id,
    kind,
    nodes: nodes.map(toNode),
    rootNode,
    ...(extras.subjectNode === undefined ? {} : { subjectNode: extras.subjectNode }),
    captures: extras.captures ?? [],
  });
}

/** Everything a bundle needs, with sensible defaults for a single kind. */
type DefinitionInit = MessageInitShape<typeof IdentifierDefinitionSchema>;
type DispatcherInit = MessageInitShape<typeof IdentifierDispatcherSchema>;

export interface BundleSpec {
  formatVersion?: number;
  rulesVersion?: string;
  capabilities?: readonly number[];
  programs: Program[];
  definitions: DefinitionInit[];
  dispatchers: DispatcherInit[];
}

export function bundle(spec: BundleSpec): RuleBundle {
  return create(RuleBundleSchema, {
    formatVersion: spec.formatVersion ?? 1,
    rulesVersion: spec.rulesVersion ?? "2026.08.38",
    requiredFeatureIds: [...(spec.capabilities ?? ALL_CAPABILITIES)],
    sourceDigest: new Uint8Array(32),
    programs: spec.programs,
    identifiers: spec.definitions,
    dispatchers: spec.dispatchers,
  });
}

export function encode(value: RuleBundle): Uint8Array {
  return toBinary(RuleBundleSchema, value);
}

/**
 * A bundle with one kind, one country target and the given programs.
 *
 * The canonicalization program defaults to an empty sequence, so a test that
 * only cares about a format or checksum rule sees the raw value.
 */
export function singleKindBundle(options: {
  kind?: string;
  countryCode?: string | undefined;
  acceptedPrefixes?: string[];
  canonicalPrefix?: string;
  allowUnprefixedWithoutCountry?: boolean;
  defaultProfile?: string;
  preCanonicalization?: NodeSpec[];
  canonicalization?: NodeSpec[];
  format: NodeSpec[];
  checksum?: NodeSpec[];
  checksumSubjectNode?: number;
  formatSubjectNode?: number;
  absentChecksumReason?: ReasonCode;
  capabilities?: readonly number[];
  extraPrograms?: Program[];
}): Uint8Array {
  const kind = options.kind ?? "test";
  const country = "countryCode" in options ? options.countryCode : "FR";
  const programs: Program[] = [
    program(
      1,
      ProgramKind.CANONICALIZATION,
      options.preCanonicalization ?? [canonicalizationSequence()],
    ),
    program(
      2,
      ProgramKind.CANONICALIZATION,
      options.canonicalization ?? [canonicalizationSequence()],
    ),
    program(3, ProgramKind.FORMAT, options.format, options.format.length - 1, {
      ...(options.formatSubjectNode === undefined
        ? {}
        : { subjectNode: options.formatSubjectNode }),
    }),
  ];
  if (options.checksum !== undefined) {
    programs.push(
      program(4, ProgramKind.CHECKSUM, options.checksum, options.checksum.length - 1, {
        ...(options.checksumSubjectNode === undefined
          ? {}
          : { subjectNode: options.checksumSubjectNode }),
      }),
    );
  }
  programs.push(...(options.extraPrograms ?? []));
  programs.sort((left, right) => left.id - right.id);

  return encode(
    bundle({
      ...(options.capabilities === undefined ? {} : { capabilities: options.capabilities }),
      programs,
      definitions: [
        {
          id: 1,
          kind,
          ...(country === undefined ? {} : { countryCode: country }),
          canonicalizationProgram: 2,
          formatProgram: 3,
          ...(options.checksum === undefined
            ? {
                absentChecksumReason:
                  options.absentChecksumReason ?? ReasonCode.UNSUPPORTED_CHECKSUM,
              }
            : { checksumProgram: 4 }),
          defaultProfile: options.defaultProfile ?? "compatible",
          sources: [],
        },
      ],
      dispatchers: [
        {
          kind,
          kindAliases: [],
          preCanonicalizationProgram: 1,
          countryAliases: [],
          targets: [
            {
              ...(country === undefined ? {} : { countryCode: country }),
              acceptedPrefixes: options.acceptedPrefixes ?? [],
              ...(options.canonicalPrefix === undefined
                ? {}
                : { canonicalPrefix: options.canonicalPrefix }),
              identifierDefinitionId: 1,
              allowUnprefixedWithoutCountry: options.allowUnprefixedWithoutCountry ?? true,
            },
          ],
        },
      ],
    }),
  );
}

/**
 * A format program that accepts everything.
 *
 * Used by tests about checksums, where the format step is only a gate that must
 * not get in the way. `VALUE` is never absent, so `not(is_absent(value()))`
 * always holds.
 */
export function alwaysValidFormat(): NodeSpec[] {
  return [
    valueNode(),
    node(
      ValueType.BOOLEAN,
      { case: "predicateOperation", value: { kind: PredicateOpKind.IS_ABSENT } },
      [0],
    ),
    node(
      ValueType.BOOLEAN,
      { case: "predicateOperation", value: { kind: PredicateOpKind.NOT } },
      [1],
    ),
    requireNode(2),
    assertionSequence([3]),
  ];
}
