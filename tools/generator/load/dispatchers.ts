/**
 * Checks 18 to 22: routing.
 *
 * Kind aliases, country aliases and prefixes are three separate spaces, and
 * every ambiguity between them is resolved here rather than at validation time.
 * That is what lets the dispatch algorithm be a lookup: no selection depends on
 * the order the bundle happens to carry.
 */
import {
  type IdentifierDefinition,
  type IdentifierDispatcher,
  ProgramKind,
  type Program as ProtoProgram,
  type RuleBundle,
} from "../../../generated/libbusinessid/ir/v1/rules_pb.js";
import type { IrDispatcher, IrTarget } from "../ir.js";
import { codePointsOf } from "../../../src/runtime/text.js";
import {
  compareUtf8,
  COUNTRY_PATTERN,
  invalid,
  KIND_PATTERN,
  PREFIX_PATTERN,
} from "./diagnostics.js";

/** Runs checks 18 to 22 and indexes every dispatcher for selection. */
export function checkDispatchers(
  bundle: RuleBundle,
  definitions: ReadonlyMap<number, IdentifierDefinition>,
  programs: ReadonlyMap<number, ProtoProgram>,
): ReadonlyMap<string, IrDispatcher> {
  checkKindSpace(bundle, programs);

  const dispatchers = new Map<string, IrDispatcher>();
  const claimed = new Map<number, string>();
  for (const dispatcher of bundle.dispatchers) {
    dispatchers.set(dispatcher.kind, buildDispatcher(dispatcher, definitions, claimed));
  }

  /* 22. every definition referenced by exactly one dispatch target */
  for (const id of definitions.keys()) {
    if (!claimed.has(id)) {
      invalid(22, `definition ${String(id)} is referenced by no dispatch target`);
    }
  }
  return dispatchers;
}

/** Check 18: dispatcher kinds and aliases globally unique, sorted, unambiguous. */
function checkKindSpace(bundle: RuleBundle, programs: ReadonlyMap<number, ProtoProgram>): void {
  const kindSpace = new Set<string>();
  for (const [index, dispatcher] of bundle.dispatchers.entries()) {
    const where = `dispatcher ${JSON.stringify(dispatcher.kind)}`;
    if (!KIND_PATTERN.test(dispatcher.kind)) {
      invalid(18, `${where} declares a malformed kind`);
    }
    if (index > 0 && compareUtf8(bundle.dispatchers[index - 1]?.kind ?? "", dispatcher.kind) >= 0) {
      invalid(18, "dispatchers are not sorted by the UTF-8 bytes of their kind");
    }
    if (kindSpace.has(dispatcher.kind)) {
      invalid(18, `${where} collides with another kind or alias`);
    }
    kindSpace.add(dispatcher.kind);

    for (const [aliasIndex, alias] of dispatcher.kindAliases.entries()) {
      if (!KIND_PATTERN.test(alias)) {
        invalid(18, `${where} declares malformed alias ${JSON.stringify(alias)}`);
      }
      if (aliasIndex > 0 && compareUtf8(dispatcher.kindAliases[aliasIndex - 1] ?? "", alias) >= 0) {
        invalid(18, `${where} does not sort its kind aliases`);
      }
      if (kindSpace.has(alias)) {
        invalid(18, `${where} alias ${JSON.stringify(alias)} collides with another kind or alias`);
      }
      kindSpace.add(alias);
    }

    const program = programs.get(dispatcher.preCanonicalizationProgram);
    if (program?.kind !== ProgramKind.CANONICALIZATION) {
      invalid(18, `${where} references an unusable pre-canonicalization program`);
    }
  }
}

interface TargetIndex {
  readonly targets: IrTarget[];
  readonly byCountry: Map<string, IrTarget>;
  readonly byPrefix: Map<string, IrTarget>;
  longestPrefix: number;
  globalTarget: IrTarget | undefined;
  implicitTarget: IrTarget | undefined;
}

function buildDispatcher(
  dispatcher: IdentifierDispatcher,
  definitions: ReadonlyMap<number, IdentifierDefinition>,
  claimed: Map<number, string>,
): IrDispatcher {
  const where = `dispatcher ${JSON.stringify(dispatcher.kind)}`;
  if (dispatcher.targets.length === 0) {
    invalid(20, `${where} declares no target`);
  }

  const index: TargetIndex = {
    targets: [],
    byCountry: new Map(),
    byPrefix: new Map(),
    longestPrefix: 0,
    globalTarget: undefined,
    implicitTarget: undefined,
  };

  for (const [position, target] of dispatcher.targets.entries()) {
    checkTargetOrder(where, dispatcher.targets[position - 1], target);
    const definition = resolveDefinition(where, dispatcher, target, definitions, claimed);
    checkTargetShape(where, dispatcher, target);
    addTarget(where, index, target, definition.id);
  }

  return {
    kind: dispatcher.kind,
    preCanonicalizationProgram: dispatcher.preCanonicalizationProgram,
    countryAliases: checkCountryAliases(where, dispatcher, index.byCountry),
    targets: index.targets,
    targetsByCountry: index.byCountry,
    targetsByPrefix: index.byPrefix,
    longestPrefix: index.longestPrefix,
    ...(index.globalTarget === undefined ? {} : { globalTarget: index.globalTarget }),
    ...(index.implicitTarget === undefined ? {} : { implicitTarget: index.implicitTarget }),
  };
}

/** Check 20: targets sorted, GLOBAL first, then ascending country code. */
function checkTargetOrder(
  where: string,
  previous: IdentifierDispatcher["targets"][number] | undefined,
  target: IdentifierDispatcher["targets"][number],
): void {
  if (previous === undefined) {
    return;
  }
  if (previous.countryCode === undefined && target.countryCode === undefined) {
    invalid(20, `${where} declares two GLOBAL targets`);
  }
  if (previous.countryCode !== undefined && target.countryCode === undefined) {
    invalid(20, `${where} does not place its GLOBAL target first`);
  }
  if (
    previous.countryCode !== undefined &&
    target.countryCode !== undefined &&
    compareUtf8(previous.countryCode, target.countryCode) >= 0
  ) {
    invalid(20, `${where} does not sort its targets by country code`);
  }
}

/** Check 22: the target and the definition agree, and nobody claims it twice. */
function resolveDefinition(
  where: string,
  dispatcher: IdentifierDispatcher,
  target: IdentifierDispatcher["targets"][number],
  definitions: ReadonlyMap<number, IdentifierDefinition>,
  claimed: Map<number, string>,
): IdentifierDefinition {
  const definition = definitions.get(target.identifierDefinitionId);
  if (definition === undefined) {
    invalid(22, `${where} references unknown definition ${String(target.identifierDefinitionId)}`);
  }
  if (definition.kind !== dispatcher.kind) {
    invalid(22, `${where} references a definition of kind ${JSON.stringify(definition.kind)}`);
  }
  if (definition.countryCode !== target.countryCode) {
    invalid(22, `${where} target and definition disagree on the country`);
  }
  const owner = claimed.get(target.identifierDefinitionId);
  if (owner !== undefined) {
    invalid(22, `definition ${String(target.identifierDefinitionId)} is claimed by ${owner} too`);
  }
  claimed.set(target.identifierDefinitionId, where);
  return definition;
}

/** Checks 20 and 21: a target's country, prefixes and GLOBAL exclusivity. */
function checkTargetShape(
  where: string,
  dispatcher: IdentifierDispatcher,
  target: IdentifierDispatcher["targets"][number],
): void {
  if (target.countryCode === undefined) {
    /* 21. a GLOBAL target stands alone, without prefix and without alias */
    if (dispatcher.targets.length !== 1) {
      invalid(21, `${where} mixes a GLOBAL target with country targets`);
    }
    if (target.acceptedPrefixes.length > 0 || target.canonicalPrefix !== undefined) {
      invalid(21, `${where} declares a prefix on its GLOBAL target`);
    }
    if (dispatcher.countryAliases.length > 0) {
      invalid(21, `${where} declares country aliases alongside a GLOBAL target`);
    }
  } else if (!COUNTRY_PATTERN.test(target.countryCode)) {
    invalid(20, `${where} declares malformed country ${JSON.stringify(target.countryCode)}`);
  }

  for (const [position, prefix] of target.acceptedPrefixes.entries()) {
    if (!PREFIX_PATTERN.test(prefix)) {
      invalid(20, `${where} declares malformed prefix ${JSON.stringify(prefix)}`);
    }
    const before = target.acceptedPrefixes[position - 1];
    if (before !== undefined && compareUtf8(before, prefix) >= 0) {
      invalid(20, `${where} does not sort the accepted prefixes of a target`);
    }
  }
  if (
    target.canonicalPrefix !== undefined &&
    !target.acceptedPrefixes.includes(target.canonicalPrefix)
  ) {
    invalid(20, `${where} declares a canonical prefix it does not accept`);
  }
}

/** Check 20: a prefix belongs to at most one target, and so does a country. */
function addTarget(
  where: string,
  index: TargetIndex,
  target: IdentifierDispatcher["targets"][number],
  definitionId: number,
): void {
  const entry: IrTarget = {
    ...(target.countryCode === undefined ? {} : { countryCode: target.countryCode }),
    acceptedPrefixes: target.acceptedPrefixes,
    ...(target.canonicalPrefix === undefined ? {} : { canonicalPrefix: target.canonicalPrefix }),
    definitionId,
    allowUnprefixedWithoutCountry: target.allowUnprefixedWithoutCountry,
  };
  index.targets.push(entry);

  for (const prefix of target.acceptedPrefixes) {
    if (index.byPrefix.has(prefix)) {
      invalid(20, `${where} lets two targets claim prefix ${JSON.stringify(prefix)}`);
    }
    index.byPrefix.set(prefix, entry);
    index.longestPrefix = Math.max(index.longestPrefix, codePointsOf(prefix).length);
  }

  if (target.countryCode === undefined) {
    index.globalTarget = entry;
  } else {
    if (index.byCountry.has(target.countryCode)) {
      invalid(20, `${where} declares two targets for ${target.countryCode}`);
    }
    index.byCountry.set(target.countryCode, entry);
  }

  if (target.allowUnprefixedWithoutCountry) {
    if (index.implicitTarget !== undefined) {
      invalid(20, `${where} declares two targets selectable without country or prefix`);
    }
    index.implicitTarget = entry;
  }
}

/** Check 19: country aliases sorted, unique, never self mapping or shadowing. */
function checkCountryAliases(
  where: string,
  dispatcher: IdentifierDispatcher,
  byCountry: ReadonlyMap<string, IrTarget>,
): ReadonlyMap<string, string> {
  const aliases = new Map<string, string>();
  for (const [index, alias] of dispatcher.countryAliases.entries()) {
    if (!COUNTRY_PATTERN.test(alias.alias) || !COUNTRY_PATTERN.test(alias.countryCode)) {
      invalid(19, `${where} declares a malformed country alias`);
    }
    if (alias.alias === alias.countryCode) {
      invalid(19, `${where} maps ${alias.alias} to itself`);
    }
    if (byCountry.has(alias.alias)) {
      invalid(19, `${where} aliases ${alias.alias}, which already names a target`);
    }
    const before = dispatcher.countryAliases[index - 1];
    if (before !== undefined && compareUtf8(before.alias, alias.alias) >= 0) {
      invalid(19, `${where} does not sort its country aliases`);
    }
    aliases.set(alias.alias, alias.countryCode);
  }
  return aliases;
}
