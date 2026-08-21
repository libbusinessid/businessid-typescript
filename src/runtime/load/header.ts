/**
 * Checks 1 to 9: the bundle envelope.
 *
 * The order inside this file is the order of `ir.md` section 10 and is not
 * negotiable. Decoding stays at the wire level, and the version checks run
 * before the unknown field scan so that a bundle built against a later version
 * is reported as a version gap rather than as a forgery.
 */
import { fromBinary } from "@bufbuild/protobuf";
import {
  ProgramKind,
  type Program as ProtoProgram,
  type RuleBundle,
  RuleBundleSchema,
} from "../../generated/libbusinessid/ir/v1/rules_pb.js";
import { SUPPORTED_CAPABILITIES } from "../capabilities.js";
import { LIMITS, SUPPORTED_FORMAT_VERSIONS } from "../limits.js";
import { utf8ByteLength } from "../text.js";
import { fail, findUnknownField, invalid, RULES_VERSION_PATTERN } from "./diagnostics.js";

/** What the envelope checks established. */
export interface Envelope {
  readonly bundle: RuleBundle;
  readonly declared: ReadonlySet<number>;
  readonly programsById: ReadonlyMap<number, ProtoProgram>;
}

/** Runs checks 1 to 9 and returns what the later checks need. */
export function checkEnvelope(bytes: Uint8Array): Envelope {
  /* 1. binary size at most 16 MiB */
  if (bytes.length > LIMITS.bundleBytes) {
    invalid(1, `bundle of ${String(bytes.length)} bytes exceeds ${String(LIMITS.bundleBytes)}`);
  }

  const bundle = decode(bytes);
  checkVersion(bundle);
  checkCapabilityList(bundle);

  /* 5. absence of any unknown field at any depth */
  const unknownField = findUnknownField(bundle, "");
  if (unknownField !== undefined) {
    invalid(5, unknownField);
  }

  checkRulesVersion(bundle);

  /* 7. source_digest of exactly 32 bytes */
  if (bundle.sourceDigest.length !== LIMITS.digestBytes) {
    invalid(7, `source_digest is ${String(bundle.sourceDigest.length)} bytes, expected 32`);
  }

  const programsById = checkPrograms(bundle);
  checkNodeCounts(bundle);

  return { bundle, declared: new Set(bundle.requiredFeatureIds), programsById };
}

/** Check 2: complete Protobuf decoding, at the wire level and nothing more. */
function decode(bytes: Uint8Array): RuleBundle {
  try {
    return fromBinary(RuleBundleSchema, bytes);
  } catch (error) {
    invalid(2, `bundle does not decode: ${error instanceof Error ? error.message : "unknown"}`);
  }
}

/** Check 3: supported `format_version`. */
function checkVersion(bundle: RuleBundle): void {
  if (!SUPPORTED_FORMAT_VERSIONS.has(bundle.formatVersion)) {
    fail(
      3,
      "incompatible_ruleset",
      `format version ${String(bundle.formatVersion)} is not supported`,
    );
  }
}

/** Check 4: every capability known, then strictly ascending. */
function checkCapabilityList(bundle: RuleBundle): void {
  // Knowledge is checked over the whole list before order, so a bundle that is
  // both newer and misordered reports the version gap, which is the answer that
  // tells an operator to upgrade.
  for (const id of bundle.requiredFeatureIds) {
    if (!SUPPORTED_CAPABILITIES.has(id)) {
      fail(4, "incompatible_ruleset", `capability ${String(id)} is unknown to this engine`);
    }
  }
  for (let index = 1; index < bundle.requiredFeatureIds.length; index += 1) {
    const previous = bundle.requiredFeatureIds[index - 1] ?? 0;
    const current = bundle.requiredFeatureIds[index] ?? 0;
    if (current <= previous) {
      invalid(4, "required_feature_ids is not strictly ascending");
    }
  }
}

/** Check 6: the shape of `rules_version`. */
function checkRulesVersion(bundle: RuleBundle): void {
  if (bundle.rulesVersion === "") {
    invalid(6, "rules_version is empty");
  }
  if (utf8ByteLength(bundle.rulesVersion) > LIMITS.rulesVersionBytes) {
    invalid(6, "rules_version is longer than 64 bytes");
  }
  if (!RULES_VERSION_PATTERN.test(bundle.rulesVersion)) {
    // The value reaches generated source and diagnostics, so a control
    // character in it is refused rather than carried.
    invalid(6, "rules_version holds a character outside letters, digits, dot, dash and underscore");
  }
}

/** Check 8: program ids unique and non zero, kinds specified, order respected. */
function checkPrograms(bundle: RuleBundle): ReadonlyMap<number, ProtoProgram> {
  const programsById = new Map<number, ProtoProgram>();
  for (const program of bundle.programs) {
    if (program.id === 0) {
      invalid(8, "a program declares id zero");
    }
    if (programsById.has(program.id)) {
      invalid(8, `program id ${String(program.id)} is declared twice`);
    }
    if (
      program.kind !== ProgramKind.CANONICALIZATION &&
      program.kind !== ProgramKind.FORMAT &&
      program.kind !== ProgramKind.CHECKSUM
    ) {
      invalid(8, `program ${String(program.id)} declares kind ${String(program.kind)}`);
    }
    programsById.set(program.id, program);
  }
  for (let index = 1; index < bundle.programs.length; index += 1) {
    if ((bundle.programs[index]?.id ?? 0) <= (bundle.programs[index - 1]?.id ?? 0)) {
      invalid(8, "programs are not sorted by ascending id");
    }
  }
  return programsById;
}

/** Check 9: node counts within the per program and total limits. */
function checkNodeCounts(bundle: RuleBundle): void {
  let totalNodes = 0;
  for (const program of bundle.programs) {
    if (program.nodes.length > LIMITS.nodesPerProgram) {
      invalid(9, `program ${String(program.id)} holds ${String(program.nodes.length)} nodes`);
    }
    totalNodes += program.nodes.length;
  }
  if (totalNodes > LIMITS.totalNodes) {
    invalid(9, `bundle holds ${String(totalNodes)} nodes`);
  }
}
