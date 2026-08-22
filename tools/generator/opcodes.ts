/**
 * The operand, parameter and capability table of every V1 operation.
 *
 * Transcribed from `ir.md` section 3, which is the normative source. The table
 * drives load checks 10 to 13: an operation absent from it is unknown, its
 * operand list fixes arity and types, and its parameter sets decide which
 * fields the message may carry.
 *
 * `test/unit/opcodes.test.ts` re-parses `ir.md` and compares it against this
 * table, so a transcription slip fails a test rather than silently accepting a
 * bundle no other engine would.
 */
import {
  AssertionOpKind,
  CallOpKind,
  CanonicalizationOpKind,
  ChecksumOpKind,
  IntegerOpKind,
  PredicateOpKind,
  StringOpKind,
  ValueType,
} from "../../generated/libbusinessid/ir/v1/rules_pb.js";
import { CAPABILITY } from "./capabilities.js";
import { ARITHMETIC } from "./limits.js";

/** One parameter of an operation message. */
export type ParameterDefinition = Readonly<{
  /** The field name as `ir.md` and `rules.proto` spell it. */
  name: string;
  /** The property the decoded message carries it under. */
  key: string;
  /** True when the field is repeated, whose presence is a non empty list. */
  repeated: boolean;
}>;

/** What a node's `input_nodes` must look like. */
export type OperandSpec = Readonly<{
  /** Operands at fixed positions, in order. */
  fixed: readonly ValueType[];
  /** A repeated tail after the fixed operands. */
  tail?: Readonly<{ type: ValueType; min: number; max: number }>;
}>;

/** Everything the loader needs to accept or refuse one operation. */
export type OpcodeSpec = Readonly<{
  name: string;
  output: ValueType;
  operands: OperandSpec;
  required: readonly string[];
  optional: readonly string[];
  capabilities: readonly number[];
}>;

const UNBOUNDED = Number.POSITIVE_INFINITY;

const none: OperandSpec = { fixed: [] };
const oneString: OperandSpec = { fixed: [ValueType.STRING] };
const oneInteger: OperandSpec = { fixed: [ValueType.INTEGER] };
const oneBoolean: OperandSpec = { fixed: [ValueType.BOOLEAN] };

const CORE = CAPABILITY.CORE_GRAPH_V1;

/* -------------------------------------------------------------------------- */
/* Parameter sets, one per operation message                                  */
/* -------------------------------------------------------------------------- */

const param = (name: string, key: string, repeated = false): ParameterDefinition => ({
  name,
  key,
  repeated,
});

export const STRING_PARAMETERS: readonly ParameterDefinition[] = [
  param("text", "text"),
  param("start", "start"),
  param("end", "end"),
];

export const INTEGER_PARAMETERS: readonly ParameterDefinition[] = [
  param("modulus", "modulus"),
  param("weights", "weights", true),
  param("alignment", "alignment"),
  param("mapping", "mapping"),
  param("remainder_values", "remainderValues", true),
  param("alphabet", "alphabet"),
];

export const PREDICATE_PARAMETERS: readonly ParameterDefinition[] = [
  param("text", "text"),
  param("values", "values", true),
  param("lengths", "lengths", true),
  param("length", "length"),
  param("min_length", "minLength"),
  param("max_length", "maxLength"),
  param("index", "index"),
  param("constant", "constant"),
];

export const CANONICALIZATION_PARAMETERS: readonly ParameterDefinition[] = [
  param("text", "text"),
  param("replacement", "replacement"),
  param("index", "index"),
  param("length", "length"),
];

export const ASSERTION_PARAMETERS: readonly ParameterDefinition[] = [
  param("reason_code", "reasonCode"),
  param("message_key", "messageKey"),
];

export const CHECKSUM_PARAMETERS: readonly ParameterDefinition[] = [
  param("index", "index"),
  param("start", "start"),
  param("end", "end"),
  param("reason_code", "reasonCode"),
  param("message_key", "messageKey"),
  param("constant", "constant"),
];

/**
 * `CallOperation.program_id` is not `optional` in the schema, so it carries no
 * presence: a call always states one, and check 24 is what proves it resolves.
 */
export const CALL_PARAMETERS: readonly ParameterDefinition[] = [];

/* -------------------------------------------------------------------------- */
/* Operation tables                                                           */
/* -------------------------------------------------------------------------- */

export const STRING_OPCODES: ReadonlyMap<number, OpcodeSpec> = new Map([
  [
    StringOpKind.CONSTANT,
    {
      name: "STRING_OP_KIND_CONSTANT",
      output: ValueType.STRING,
      operands: none,
      required: ["text"],
      optional: [],
      capabilities: [CORE],
    },
  ],
  [
    StringOpKind.VALUE,
    {
      name: "STRING_OP_KIND_VALUE",
      output: ValueType.STRING,
      operands: none,
      required: [],
      optional: [],
      capabilities: [CORE],
    },
  ],
  [
    StringOpKind.SUBJECT,
    {
      name: "STRING_OP_KIND_SUBJECT",
      output: ValueType.STRING,
      operands: none,
      required: [],
      optional: [],
      capabilities: [CORE],
    },
  ],
  [
    StringOpKind.COUNTRY_CODE,
    {
      name: "STRING_OP_KIND_COUNTRY_CODE",
      output: ValueType.STRING,
      operands: none,
      required: [],
      optional: [],
      capabilities: [CORE, CAPABILITY.IDENTIFIER_DISPATCH_V1],
    },
  ],
  [
    StringOpKind.SLICE,
    {
      name: "STRING_OP_KIND_SLICE",
      output: ValueType.STRING,
      operands: oneString,
      required: ["start", "end"],
      optional: [],
      capabilities: [CORE, CAPABILITY.STRING_VIEWS_V1],
    },
  ],
  [
    StringOpKind.SLICE_FROM,
    {
      name: "STRING_OP_KIND_SLICE_FROM",
      output: ValueType.STRING,
      operands: oneString,
      required: ["start"],
      optional: [],
      capabilities: [CORE, CAPABILITY.STRING_VIEWS_V1],
    },
  ],
  [
    StringOpKind.SLICE_TO,
    {
      name: "STRING_OP_KIND_SLICE_TO",
      output: ValueType.STRING,
      operands: oneString,
      required: ["end"],
      optional: [],
      capabilities: [CORE, CAPABILITY.STRING_VIEWS_V1],
    },
  ],
  [
    StringOpKind.BEFORE_FIRST,
    {
      name: "STRING_OP_KIND_BEFORE_FIRST",
      output: ValueType.STRING,
      operands: oneString,
      required: ["text"],
      optional: [],
      capabilities: [CORE, CAPABILITY.STRING_VIEWS_V1],
    },
  ],
  [
    StringOpKind.AFTER_FIRST,
    {
      name: "STRING_OP_KIND_AFTER_FIRST",
      output: ValueType.STRING,
      operands: oneString,
      required: ["text"],
      optional: [],
      capabilities: [CORE, CAPABILITY.STRING_VIEWS_V1],
    },
  ],
  [
    StringOpKind.STRIP_PREFIX,
    {
      name: "STRING_OP_KIND_STRIP_PREFIX",
      output: ValueType.STRING,
      operands: oneString,
      required: ["text"],
      optional: [],
      capabilities: [CORE, CAPABILITY.STRING_VIEWS_V1],
    },
  ],
  [
    StringOpKind.CONCAT,
    {
      name: "STRING_OP_KIND_CONCAT",
      output: ValueType.STRING,
      operands: {
        fixed: [],
        tail: {
          type: ValueType.STRING,
          min: ARITHMETIC.concatOperands.min,
          max: ARITHMETIC.concatOperands.max,
        },
      },
      required: [],
      optional: [],
      capabilities: [CORE, CAPABILITY.STRING_VIEWS_V1],
    },
  ],
]);

export const INTEGER_OPCODES: ReadonlyMap<number, OpcodeSpec> = new Map([
  [
    IntegerOpKind.DIGITS_TO_INTEGER,
    {
      name: "INTEGER_OP_KIND_DIGITS_TO_INTEGER",
      output: ValueType.INTEGER,
      operands: oneString,
      required: [],
      optional: [],
      capabilities: [CORE, CAPABILITY.CHECKSUM_TRISTATE_V1],
    },
  ],
  [
    IntegerOpKind.MOD_DIGITS,
    {
      name: "INTEGER_OP_KIND_MOD_DIGITS",
      output: ValueType.INTEGER,
      operands: oneString,
      required: ["modulus"],
      optional: [],
      capabilities: [CORE, CAPABILITY.CHECKSUM_TRISTATE_V1],
    },
  ],
  [
    IntegerOpKind.WEIGHTED_SUM,
    {
      name: "INTEGER_OP_KIND_WEIGHTED_SUM",
      output: ValueType.INTEGER,
      operands: oneString,
      required: ["weights", "alignment", "mapping"],
      optional: ["alphabet"],
      capabilities: [CORE, CAPABILITY.CHECKSUM_TRISTATE_V1, CAPABILITY.CHECKSUM_WEIGHTED_V1],
    },
  ],
  [
    IntegerOpKind.MODULO,
    {
      name: "INTEGER_OP_KIND_MODULO",
      output: ValueType.INTEGER,
      operands: oneInteger,
      required: ["modulus"],
      optional: [],
      capabilities: [CORE, CAPABILITY.CHECKSUM_TRISTATE_V1],
    },
  ],
  [
    IntegerOpKind.COMPLEMENT,
    {
      name: "INTEGER_OP_KIND_COMPLEMENT",
      output: ValueType.INTEGER,
      operands: oneInteger,
      required: ["modulus"],
      optional: [],
      capabilities: [CORE, CAPABILITY.CHECKSUM_TRISTATE_V1],
    },
  ],
  [
    IntegerOpKind.REMAINDER_MAP,
    {
      name: "INTEGER_OP_KIND_REMAINDER_MAP",
      output: ValueType.INTEGER,
      operands: oneInteger,
      required: ["remainder_values"],
      optional: [],
      capabilities: [CORE, CAPABILITY.CHECKSUM_TRISTATE_V1],
    },
  ],
]);

const predicate = (
  kind: PredicateOpKind,
  name: string,
  operands: OperandSpec,
  required: readonly string[],
  capabilities: readonly number[],
): readonly [number, OpcodeSpec] => [
  kind,
  { name, output: ValueType.BOOLEAN, operands, required, optional: [], capabilities },
];

const ASCII = CAPABILITY.ASCII_AND_WHITESPACE_V1;
const ASSERTIONS = CAPABILITY.FORMAT_ASSERTIONS_V1;
const TRISTATE = CAPABILITY.CHECKSUM_TRISTATE_V1;

export const PREDICATE_OPCODES: ReadonlyMap<number, OpcodeSpec> = new Map([
  predicate(
    PredicateOpKind.IS_EMPTY,
    "PREDICATE_OP_KIND_IS_EMPTY",
    oneString,
    [],
    [CORE, ASSERTIONS],
  ),
  predicate(
    PredicateOpKind.IS_ABSENT,
    "PREDICATE_OP_KIND_IS_ABSENT",
    oneString,
    [],
    [CORE, CAPABILITY.STRING_VIEWS_V1],
  ),
  predicate(
    PredicateOpKind.EQUALS,
    "PREDICATE_OP_KIND_EQUALS",
    { fixed: [ValueType.STRING, ValueType.STRING] },
    [],
    [CORE, ASSERTIONS],
  ),
  predicate(
    PredicateOpKind.LENGTH_EQ,
    "PREDICATE_OP_KIND_LENGTH_EQ",
    oneString,
    ["length"],
    [CORE, ASSERTIONS],
  ),
  predicate(
    PredicateOpKind.LENGTH_IN,
    "PREDICATE_OP_KIND_LENGTH_IN",
    oneString,
    ["lengths"],
    [CORE, ASSERTIONS],
  ),
  predicate(
    PredicateOpKind.LENGTH_BETWEEN,
    "PREDICATE_OP_KIND_LENGTH_BETWEEN",
    oneString,
    ["min_length", "max_length"],
    [CORE, ASSERTIONS],
  ),
  predicate(
    PredicateOpKind.ASCII_DIGITS,
    "PREDICATE_OP_KIND_ASCII_DIGITS",
    oneString,
    [],
    [CORE, ASCII],
  ),
  predicate(
    PredicateOpKind.ASCII_UPPER_LETTERS,
    "PREDICATE_OP_KIND_ASCII_UPPER_LETTERS",
    oneString,
    [],
    [CORE, ASCII],
  ),
  predicate(
    PredicateOpKind.ASCII_ALPHANUMERIC,
    "PREDICATE_OP_KIND_ASCII_ALPHANUMERIC",
    oneString,
    [],
    [CORE, ASCII],
  ),
  predicate(
    PredicateOpKind.ASCII_CHARSET,
    "PREDICATE_OP_KIND_ASCII_CHARSET",
    oneString,
    ["text"],
    [CORE, ASCII],
  ),
  predicate(
    PredicateOpKind.STARTS_WITH,
    "PREDICATE_OP_KIND_STARTS_WITH",
    oneString,
    ["text"],
    [CORE, ASSERTIONS],
  ),
  predicate(
    PredicateOpKind.ENDS_WITH,
    "PREDICATE_OP_KIND_ENDS_WITH",
    oneString,
    ["text"],
    [CORE, ASSERTIONS],
  ),
  predicate(
    PredicateOpKind.PREFIX_IN,
    "PREDICATE_OP_KIND_PREFIX_IN",
    oneString,
    ["values"],
    [CORE, ASSERTIONS],
  ),
  predicate(
    PredicateOpKind.CHAR_AT_IN,
    "PREDICATE_OP_KIND_CHAR_AT_IN",
    oneString,
    ["index", "text"],
    [CORE, ASSERTIONS],
  ),
  predicate(
    PredicateOpKind.CONTAINS,
    "PREDICATE_OP_KIND_CONTAINS",
    oneString,
    ["text"],
    [CORE, ASSERTIONS],
  ),
  predicate(
    PredicateOpKind.ALL,
    "PREDICATE_OP_KIND_ALL",
    { fixed: [], tail: { type: ValueType.BOOLEAN, min: 1, max: UNBOUNDED } },
    [],
    [CORE, ASSERTIONS],
  ),
  predicate(
    PredicateOpKind.ANY,
    "PREDICATE_OP_KIND_ANY",
    { fixed: [], tail: { type: ValueType.BOOLEAN, min: 1, max: UNBOUNDED } },
    [],
    [CORE, ASSERTIONS],
  ),
  predicate(PredicateOpKind.NOT, "PREDICATE_OP_KIND_NOT", oneBoolean, [], [CORE, ASSERTIONS]),
  predicate(
    PredicateOpKind.PROFILE_IS,
    "PREDICATE_OP_KIND_PROFILE_IS",
    none,
    ["text"],
    [CORE, CAPABILITY.PROFILES_V1],
  ),
  predicate(
    PredicateOpKind.INTEGER_IS,
    "PREDICATE_OP_KIND_INTEGER_IS",
    oneInteger,
    ["constant"],
    [CORE, TRISTATE, CAPABILITY.CHECKSUM_INTEGER_PREDICATE_V1],
  ),
]);

const canonicalization = (
  kind: CanonicalizationOpKind,
  name: string,
  operands: OperandSpec,
  required: readonly string[],
  capabilities: readonly number[],
): readonly [number, OpcodeSpec] => [
  kind,
  {
    name,
    output: ValueType.CANONICALIZATION_STEP,
    operands,
    required,
    optional: [],
    capabilities,
  },
];

const BASIC = CAPABILITY.CANONICALIZATION_BASIC_V1;

export const CANONICALIZATION_OPCODES: ReadonlyMap<number, OpcodeSpec> = new Map([
  canonicalization(
    CanonicalizationOpKind.SEQUENCE,
    "CANONICALIZATION_OP_KIND_SEQUENCE",
    { fixed: [], tail: { type: ValueType.CANONICALIZATION_STEP, min: 0, max: UNBOUNDED } },
    [],
    [CORE, BASIC],
  ),
  canonicalization(
    CanonicalizationOpKind.TRIM_WHITESPACE,
    "CANONICALIZATION_OP_KIND_TRIM_WHITESPACE",
    none,
    [],
    [CORE, ASCII, BASIC],
  ),
  canonicalization(
    CanonicalizationOpKind.REMOVE_WHITESPACE,
    "CANONICALIZATION_OP_KIND_REMOVE_WHITESPACE",
    none,
    [],
    [CORE, ASCII, BASIC],
  ),
  canonicalization(
    CanonicalizationOpKind.UPPERCASE_ASCII,
    "CANONICALIZATION_OP_KIND_UPPERCASE_ASCII",
    none,
    [],
    [CORE, ASCII, BASIC],
  ),
  canonicalization(
    CanonicalizationOpKind.REMOVE_CHARS,
    "CANONICALIZATION_OP_KIND_REMOVE_CHARS",
    none,
    ["text"],
    [CORE, BASIC],
  ),
  canonicalization(
    CanonicalizationOpKind.REPLACE_PREFIX,
    "CANONICALIZATION_OP_KIND_REPLACE_PREFIX",
    none,
    ["text", "replacement"],
    [CORE, BASIC],
  ),
  canonicalization(
    CanonicalizationOpKind.PREPEND,
    "CANONICALIZATION_OP_KIND_PREPEND",
    none,
    ["text"],
    [CORE, BASIC],
  ),
  canonicalization(
    CanonicalizationOpKind.APPEND,
    "CANONICALIZATION_OP_KIND_APPEND",
    none,
    ["text"],
    [CORE, BASIC],
  ),
  canonicalization(
    CanonicalizationOpKind.INSERT,
    "CANONICALIZATION_OP_KIND_INSERT",
    none,
    ["index", "text"],
    [CORE, BASIC],
  ),
  canonicalization(
    CanonicalizationOpKind.LEFT_PAD,
    "CANONICALIZATION_OP_KIND_LEFT_PAD",
    none,
    ["length", "text"],
    [CORE, BASIC],
  ),
  canonicalization(
    CanonicalizationOpKind.PREPEND_COUNTRY_IF_MISSING,
    "CANONICALIZATION_OP_KIND_PREPEND_COUNTRY_IF_MISSING",
    none,
    [],
    [CORE, BASIC, CAPABILITY.IDENTIFIER_DISPATCH_V1],
  ),
  canonicalization(
    CanonicalizationOpKind.WHEN,
    "CANONICALIZATION_OP_KIND_WHEN",
    {
      fixed: [ValueType.BOOLEAN],
      tail: { type: ValueType.CANONICALIZATION_STEP, min: 1, max: UNBOUNDED },
    },
    [],
    [CORE, CAPABILITY.CANONICALIZATION_CONDITIONAL_V1],
  ),
]);

export const ASSERTION_OPCODES: ReadonlyMap<number, OpcodeSpec> = new Map([
  [
    AssertionOpKind.SEQUENCE,
    {
      name: "ASSERTION_OP_KIND_SEQUENCE",
      output: ValueType.ASSERTION,
      operands: { fixed: [], tail: { type: ValueType.ASSERTION, min: 1, max: UNBOUNDED } },
      required: [],
      optional: [],
      capabilities: [CORE, ASSERTIONS],
    },
  ],
  [
    AssertionOpKind.REQUIRE,
    {
      name: "ASSERTION_OP_KIND_REQUIRE",
      output: ValueType.ASSERTION,
      operands: oneBoolean,
      required: ["reason_code"],
      optional: ["message_key"],
      capabilities: [CORE, ASSERTIONS],
    },
  ],
]);

const checksum = (
  kind: ChecksumOpKind,
  name: string,
  operands: OperandSpec,
  required: readonly string[],
  optional: readonly string[],
  capabilities: readonly number[],
): readonly [number, OpcodeSpec] => [
  kind,
  { name, output: ValueType.CHECKSUM_OUTCOME, operands, required, optional, capabilities },
];

const outcomeTail: OperandSpec = {
  fixed: [],
  tail: { type: ValueType.CHECKSUM_OUTCOME, min: 1, max: UNBOUNDED },
};

export const CHECKSUM_OPCODES: ReadonlyMap<number, OpcodeSpec> = new Map([
  checksum(
    ChecksumOpKind.LUHN,
    "CHECKSUM_OP_KIND_LUHN",
    oneString,
    [],
    ["message_key"],
    [CORE, TRISTATE, CAPABILITY.CHECKSUM_LUHN_V1],
  ),
  checksum(
    ChecksumOpKind.ISO7064_MOD97_10,
    "CHECKSUM_OP_KIND_ISO7064_MOD97_10",
    oneString,
    [],
    ["message_key"],
    [CORE, TRISTATE, CAPABILITY.CHECKSUM_MOD97_V1],
  ),
  checksum(
    ChecksumOpKind.COMPARE_DIGIT,
    "CHECKSUM_OP_KIND_COMPARE_DIGIT",
    { fixed: [ValueType.INTEGER, ValueType.STRING] },
    ["index"],
    ["message_key"],
    [CORE, TRISTATE],
  ),
  checksum(
    ChecksumOpKind.COMPARE_SLICE,
    "CHECKSUM_OP_KIND_COMPARE_SLICE",
    { fixed: [ValueType.INTEGER, ValueType.STRING] },
    ["start", "end"],
    ["message_key"],
    [CORE, TRISTATE],
  ),
  checksum(ChecksumOpKind.CHOOSE, "CHECKSUM_OP_KIND_CHOOSE", outcomeTail, [], [], [CORE, TRISTATE]),
  checksum(
    ChecksumOpKind.WHEN,
    "CHECKSUM_OP_KIND_WHEN",
    { fixed: [ValueType.BOOLEAN, ValueType.CHECKSUM_OUTCOME] },
    [],
    [],
    [CORE, TRISTATE],
  ),
  checksum(
    ChecksumOpKind.ALL_CHECKS,
    "CHECKSUM_OP_KIND_ALL_CHECKS",
    outcomeTail,
    [],
    [],
    [CORE, TRISTATE],
  ),
  checksum(
    ChecksumOpKind.ANY_CHECK,
    "CHECKSUM_OP_KIND_ANY_CHECK",
    outcomeTail,
    [],
    [],
    [CORE, TRISTATE],
  ),
  checksum(
    ChecksumOpKind.UNSUPPORTED,
    "CHECKSUM_OP_KIND_UNSUPPORTED",
    none,
    ["reason_code"],
    ["message_key"],
    [CORE, TRISTATE],
  ),
  checksum(
    ChecksumOpKind.COMPARE_CONSTANT,
    "CHECKSUM_OP_KIND_COMPARE_CONSTANT",
    oneInteger,
    ["constant"],
    ["message_key"],
    [CORE, TRISTATE, CAPABILITY.CHECKSUM_COMPARE_CONSTANT_V1],
  ),
]);

export const CALL_OPCODES: ReadonlyMap<number, OpcodeSpec> = new Map([
  [
    CallOpKind.FORMAT,
    {
      name: "CALL_OP_KIND_FORMAT",
      output: ValueType.ASSERTION,
      operands: oneString,
      required: ["program_id"],
      optional: [],
      capabilities: [CORE, CAPABILITY.CAPTURES_AND_CALLS_V1, ASSERTIONS],
    },
  ],
  [
    CallOpKind.CHECKSUM,
    {
      name: "CALL_OP_KIND_CHECKSUM",
      output: ValueType.CHECKSUM_OUTCOME,
      operands: oneString,
      required: ["program_id"],
      optional: [],
      capabilities: [CORE, CAPABILITY.CAPTURES_AND_CALLS_V1, TRISTATE],
    },
  ],
]);

/**
 * Every operation family, keyed by the `Node.operation` oneof case.
 *
 * The keys are the case names Protobuf-ES reports, which are the camel cased
 * field names of the oneof.
 */
export const OPCODE_TABLES = {
  stringOperation: { family: "string", table: STRING_OPCODES, parameters: STRING_PARAMETERS },
  integerOperation: { family: "integer", table: INTEGER_OPCODES, parameters: INTEGER_PARAMETERS },
  predicateOperation: {
    family: "predicate",
    table: PREDICATE_OPCODES,
    parameters: PREDICATE_PARAMETERS,
  },
  canonicalizationOperation: {
    family: "canonicalization",
    table: CANONICALIZATION_OPCODES,
    parameters: CANONICALIZATION_PARAMETERS,
  },
  assertionOperation: {
    family: "assertion",
    table: ASSERTION_OPCODES,
    parameters: ASSERTION_PARAMETERS,
  },
  checksumOperation: {
    family: "checksum",
    table: CHECKSUM_OPCODES,
    parameters: CHECKSUM_PARAMETERS,
  },
  callOperation: { family: "call", table: CALL_OPCODES, parameters: CALL_PARAMETERS },
} as const;

/** The `Node.operation` case names, as Protobuf-ES reports them. */
export type OperationCase = keyof typeof OPCODE_TABLES;
