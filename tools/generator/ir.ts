/**
 * The validated internal representation the engine executes.
 *
 * Built only once every load time check has passed. Protobuf messages are
 * mutable and carry presence in a shape the interpreter should not have to
 * re-examine, so nothing beyond the loader ever sees them: the interpreter
 * reads these frozen structures, where every value is already proven to be in
 * range.
 */
import type {
  AssertionOpKind,
  CallOpKind,
  CanonicalizationOpKind,
  ChecksumOpKind,
  CharMapping,
  IntegerOpKind,
  PredicateOpKind,
  ProgramKind,
  StringOpKind,
  ValueType,
  WeightAlignment,
} from "../../generated/entid/ir/v1/rules_pb.js";
import type { ReasonCode } from "../../src/domain/reason-code.js";
import type { ValidationProfile } from "../../src/domain/profile.js";

/** A string operation node. */
export type IrStringOperation = Readonly<{
  family: "string";
  kind: StringOpKind;
  text?: string;
  /** `text` decomposed once, so the interpreter never re-scans a constant. */
  textCodePoints?: readonly number[];
  start?: number;
  end?: number;
}>;

/** An integer operation node. */
export type IrIntegerOperation = Readonly<{
  family: "integer";
  kind: IntegerOpKind;
  modulus?: bigint;
  weights?: readonly bigint[];
  alignment?: WeightAlignment;
  mapping?: CharMapping;
  remainderValues?: readonly bigint[];
  /** The custom alphabet as a code point to index map, built once at load. */
  alphabet?: ReadonlyMap<number, number>;
}>;

/** A predicate node. */
export type IrPredicateOperation = Readonly<{
  family: "predicate";
  kind: PredicateOpKind;
  text?: string;
  textCodePoints?: readonly number[];
  /** The accepted code points of `ASCII_CHARSET` and `CHAR_AT_IN`. */
  charset?: ReadonlySet<number>;
  values?: readonly string[];
  lengths?: readonly number[];
  length?: number;
  minLength?: number;
  maxLength?: number;
  index?: number;
  constant?: bigint;
  /** The profile `PROFILE_IS` compares against. */
  profile?: ValidationProfile;
}>;

/** A canonicalization step node. */
export type IrCanonicalizationOperation = Readonly<{
  family: "canonicalization";
  kind: CanonicalizationOpKind;
  text?: string;
  textCodePoints?: readonly number[];
  /** The removed code points of `REMOVE_CHARS`. */
  charset?: ReadonlySet<number>;
  replacement?: string;
  index?: number;
  length?: number;
}>;

/** An assertion node. */
export type IrAssertionOperation = Readonly<{
  family: "assertion";
  kind: AssertionOpKind;
  reasonCode?: ReasonCode;
  messageKey?: string;
}>;

/** A checksum node. */
export type IrChecksumOperation = Readonly<{
  family: "checksum";
  kind: ChecksumOpKind;
  index?: number;
  start?: number;
  end?: number;
  reasonCode?: ReasonCode;
  messageKey?: string;
  constant?: bigint;
}>;

/** A call node. */
export type IrCallOperation = Readonly<{
  family: "call";
  kind: CallOpKind;
  programId: number;
}>;

/** Any operation a node may carry. */
export type IrOperation =
  | IrStringOperation
  | IrIntegerOperation
  | IrPredicateOperation
  | IrCanonicalizationOperation
  | IrAssertionOperation
  | IrChecksumOperation
  | IrCallOperation;

/** One node of a program. */
export type IrNode = Readonly<{
  outputType: ValueType;
  /** Indices of operands, always strictly lower than this node's own index. */
  inputs: readonly number[];
  operation: IrOperation;
}>;

/** A typed acyclic program in topological order. */
export type IrProgram = Readonly<{
  id: number;
  kind: ProgramKind;
  nodes: readonly IrNode[];
  rootNode: number;
  /** The node producing `subject()` for a top level invocation, when declared. */
  subjectNode?: number;
}>;

/** One routing entry of a dispatcher. */
export type IrTarget = Readonly<{
  /** Absent for the GLOBAL target. */
  countryCode?: string;
  acceptedPrefixes: readonly string[];
  canonicalPrefix?: string;
  definitionId: number;
  allowUnprefixedWithoutCountry: boolean;
}>;

/** A dispatcher, indexed for the selection algorithm of `ir.md` section 5. */
export type IrDispatcher = Readonly<{
  kind: string;
  preCanonicalizationProgram: number;
  countryAliases: ReadonlyMap<string, string>;
  targets: readonly IrTarget[];
  targetsByCountry: ReadonlyMap<string, IrTarget>;
  /** Every accepted prefix, mapped to the single target that claims it. */
  targetsByPrefix: ReadonlyMap<string, IrTarget>;
  /** Longest accepted prefix of this dispatcher, in code points. */
  longestPrefix: number;
  globalTarget?: IrTarget;
  /** The one target selectable with neither country nor prefix, when declared. */
  implicitTarget?: IrTarget;
}>;

/** A canonicalizer, format and checksum bound to a kind and a country. */
export type IrDefinition = Readonly<{
  id: number;
  kind: string;
  /** Absent for a GLOBAL definition. */
  countryCode?: string;
  canonicalizationProgram: number;
  formatProgram: number;
  checksumProgram?: number;
  defaultProfile: ValidationProfile;
  /** The reason reported when no checksum program is declared. */
  absentChecksumReason?: ReasonCode;
}>;

/** A bundle that passed every load time check. */
export type LoadedBundle = Readonly<{
  formatVersion: number;
  rulesVersion: string;
  capabilities: ReadonlySet<number>;
  programs: ReadonlyMap<number, IrProgram>;
  definitions: ReadonlyMap<number, IrDefinition>;
  /** Dispatchers by canonical kind. */
  dispatchers: ReadonlyMap<string, IrDispatcher>;
  /** Canonical kinds and their aliases, mapped to the dispatcher they select. */
  kindIndex: ReadonlyMap<string, IrDispatcher>;
}>;
