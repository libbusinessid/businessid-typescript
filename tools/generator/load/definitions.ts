/**
 * Checks 17 and 18: identifier definitions.
 *
 * Check 16 covers identity, well formedness and the normative serialization
 * order. Check 17 covers the one rule that keeps a checksum answerable: a
 * definition either declares a program or declares why none exists, never both
 * and never neither.
 */
import {
  type IdentifierDefinition,
  ProgramKind,
  type Program as ProtoProgram,
  type RuleBundle,
  type Source,
  SourceTier,
} from "../../../generated/entid/ir/v1/rules_pb.js";
import { VALIDATION_PROFILES } from "../../../src/domain/profile.js";
import { ABSENT_CHECKSUM_REASON_CODES } from "../../../src/domain/reason-code.js";
import { LIMITS } from "../limits.js";
import {
  compareUtf8,
  COUNTRY_PATTERN,
  invalid,
  isKnownEnumValue,
  KIND_PATTERN,
  reasonCodeName,
} from "./diagnostics.js";

/** Runs checks 16 and 17, returning the definitions by id. */
export function checkDefinitions(
  bundle: RuleBundle,
  programs: ReadonlyMap<number, ProtoProgram>,
): ReadonlyMap<number, IdentifierDefinition> {
  const byId = new Map<number, IdentifierDefinition>();

  if (bundle.identifiers.length > LIMITS.identifiers) {
    invalid(17, `bundle declares ${String(bundle.identifiers.length)} identifiers`);
  }
  for (const definition of bundle.identifiers) {
    checkShape(definition, byId, programs);
  }
  checkOrder(bundle.identifiers);
  for (const definition of bundle.identifiers) {
    checkChecksumDeclaration(definition);
  }
  return byId;
}

function checkShape(
  definition: IdentifierDefinition,
  seen: Map<number, IdentifierDefinition>,
  programs: ReadonlyMap<number, ProtoProgram>,
): void {
  const where = `definition ${String(definition.id)}`;
  if (definition.id === 0) {
    invalid(17, "a definition declares id zero");
  }
  if (seen.has(definition.id)) {
    invalid(17, `${where} is declared twice`);
  }
  seen.set(definition.id, definition);

  if (!KIND_PATTERN.test(definition.kind)) {
    invalid(17, `${where} declares malformed kind ${JSON.stringify(definition.kind)}`);
  }
  // An absent country means GLOBAL. The empty string and the literal "GLOBAL"
  // are invalid, so the absence carries the meaning on its own.
  if (definition.countryCode !== undefined && !COUNTRY_PATTERN.test(definition.countryCode)) {
    invalid(17, `${where} declares malformed country ${JSON.stringify(definition.countryCode)}`);
  }
  if (!VALIDATION_PROFILES.some((profile) => profile === definition.defaultProfile)) {
    invalid(17, `${where} declares unknown profile ${JSON.stringify(definition.defaultProfile)}`);
  }

  requireProgram(
    where,
    "canonicalization",
    definition.canonicalizationProgram,
    programs,
    ProgramKind.CANONICALIZATION,
  );
  requireProgram(where, "format", definition.formatProgram, programs, ProgramKind.FORMAT);
  if (definition.checksumProgram !== undefined) {
    requireProgram(where, "checksum", definition.checksumProgram, programs, ProgramKind.CHECKSUM);
  }

  for (const [index, source] of definition.sources.entries()) {
    checkSource(where, source, index === 0 ? undefined : definition.sources[index - 1]);
  }
}

function requireProgram(
  where: string,
  label: string,
  id: number,
  programs: ReadonlyMap<number, ProtoProgram>,
  kind: ProgramKind,
): void {
  const program = programs.get(id);
  if (program === undefined) {
    invalid(17, `${where} references unknown ${label} program ${String(id)}`);
  }
  if (program.kind !== kind) {
    invalid(17, `${where} references program ${String(id)}, which is not a ${label} program`);
  }
}

function checkSource(where: string, source: Source, previous: Source | undefined): void {
  if (source.id === "") {
    invalid(17, `${where} declares a source without id`);
  }
  if (previous !== undefined && compareUtf8(previous.id, source.id) >= 0) {
    invalid(17, `${where} does not sort its sources by id`);
  }
  // A tier outside the enumeration would let two engines read the same source
  // differently. UNSPECIFIED is not refused: the field is not optional, so an
  // omitted tier and an explicit UNSPECIFIED are the same bytes.
  if (!isKnownEnumValue(SourceTier, source.tier)) {
    invalid(17, `${where} declares source tier ${String(source.tier)}`);
  }
}

/** `RuleBundle.identifiers` is sorted by kind, then GLOBAL first, then country. */
function checkOrder(definitions: readonly IdentifierDefinition[]): void {
  for (let index = 1; index < definitions.length; index += 1) {
    const previous = definitions[index - 1];
    const current = definitions[index];
    if (previous === undefined || current === undefined) {
      continue;
    }
    const byKind = compareUtf8(previous.kind, current.kind);
    if (byKind > 0) {
      invalid(17, "identifiers are not sorted by kind");
    }
    if (byKind < 0) {
      continue;
    }
    const rank = (value: string | undefined): number => (value === undefined ? 0 : 1);
    const byGlobal = rank(previous.countryCode) - rank(current.countryCode);
    if (byGlobal > 0) {
      invalid(17, "identifiers do not place the GLOBAL definition first");
    }
    if (byGlobal < 0) {
      continue;
    }
    // Two equal sort keys are a rejected duplicate, never a tie broken by the
    // order the bundle happens to carry.
    if (compareUtf8(previous.countryCode ?? "", current.countryCode ?? "") >= 0) {
      invalid(17, `identifiers repeat or misorder kind ${current.kind}`);
    }
  }
}

/** Check 17: exactly one checksum program or one absence reason. */
function checkChecksumDeclaration(definition: IdentifierDefinition): void {
  const where = `definition ${String(definition.id)}`;
  const hasProgram = definition.checksumProgram !== undefined;
  const hasReason = definition.absentChecksumReason !== undefined;
  if (hasProgram === hasReason) {
    invalid(
      18,
      hasProgram
        ? `${where} declares both a checksum program and an absence reason`
        : `${where} declares neither a checksum program nor an absence reason`,
    );
  }
  if (hasReason) {
    const reason = reasonCodeName(definition.absentChecksumReason);
    if (reason === undefined || !ABSENT_CHECKSUM_REASON_CODES.some((code) => code === reason)) {
      invalid(18, `${where} declares an absence reason that cannot report a missing checksum`);
    }
  }
}
