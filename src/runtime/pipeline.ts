/**
 * Dispatch and the normative validation pipeline.
 *
 * The dispatch algorithm is the ten step form of `ir.md` section 5. Note that
 * it runs the pre-canonicalization program as soon as the dispatcher is
 * resolved, before any country decision, so a result that stops on an
 * unusable country still reports the pre-canonical value. `engine.md` section
 * 8.0 and `spec.md` section 6.11 still describe a nine step order that
 * normalises the country first; `ir.md` is the exhaustive revision, states the
 * reason for its order, and governs here.
 */
import type { IdentifierInput, ValidationOptions } from "../domain/input.js";
import { DISPATCH_DEFAULT_PROFILE, type ValidationProfile } from "../domain/profile.js";
import type { ReasonCode } from "../domain/reason-code.js";
import type { CanonicalizationResult, StepResult, ValidationReport } from "../domain/result.js";
import type { StepStatus } from "../domain/status.js";
import { Budget } from "./budget.js";
import type { EvaluationContext } from "./interpret.js";
import { runCanonicalization, runChecksum, runFormat } from "./interpret.js";
import type { IrDefinition, IrDispatcher, IrTarget, LoadedBundle } from "./ir.js";
import { LIMITS } from "./limits.js";
import {
  codePointsOf,
  hasLoneSurrogate,
  lowerCaseAscii,
  stringOf,
  trimAsciiSpace,
  upperCaseAscii,
  utf8ByteLength,
} from "./text.js";

/** The public operation being served. */
export type OperationName = "canonicalize" | "validateFormat" | "validateChecksum" | "validate";

const COUNTRY_PATTERN = /^[A-Z]{2}$/;

/** How far dispatch got, and what it produced. */
type Dispatch = Readonly<{
  kind: string;
  canonicalValue: readonly number[];
  countryCode: string | undefined;
  profile: ValidationProfile;
  definition: IrDefinition | undefined;
  target: IrTarget | undefined;
  /** Absent when a definition was selected. */
  failure: ReasonCode | undefined;
}>;

function step(
  level: "format" | "checksum",
  status: StepStatus,
  reasonCode: ReasonCode,
  messageKey?: string,
): StepResult {
  return { level, status, reasonCode, ...(messageKey === undefined ? {} : { messageKey }) };
}

/* -------------------------------------------------------------------------- */
/* Dispatch                                                                   */
/* -------------------------------------------------------------------------- */

function dispatch(
  bundle: LoadedBundle,
  input: IdentifierInput,
  requested: ValidationProfile | undefined,
  budget: Budget,
): Dispatch {
  const dispatchProfile = requested ?? DISPATCH_DEFAULT_PROFILE;
  const rawValue = codePointsOf(input.value);
  // An empty token behaves like an absent context.
  const rawCountry =
    input.countryCode === undefined || trimAsciiSpace(input.countryCode) === ""
      ? undefined
      : input.countryCode;
  const requestedKind = lowerCaseAscii(trimAsciiSpace(input.kind));

  const stalled = (failure: ReasonCode): Dispatch => ({
    kind: requestedKind,
    canonicalValue: rawValue,
    countryCode: rawCountry,
    profile: dispatchProfile,
    definition: undefined,
    target: undefined,
    failure,
  });

  /* 1. refuse an input that is not valid UTF-8, reporting the value verbatim */
  if (hasLoneSurrogate(input.value)) {
    return stalled("invalid_encoding");
  }

  /* 2 and 3. normalize the kind and resolve a dispatcher */
  const dispatcher = bundle.kindIndex.get(requestedKind);
  if (dispatcher === undefined) {
    return stalled("unsupported_kind");
  }

  /* 4. run the pre-canonicalization program exactly once on the raw value */
  const context = baseContext(bundle, budget, dispatchProfile);
  const preCanonical = runCanonicalization(
    context,
    dispatcher.preCanonicalizationProgram,
    rawValue,
  );

  const halted = (failure: ReasonCode, country: string | undefined): Dispatch => ({
    kind: dispatcher.kind,
    canonicalValue: preCanonical,
    countryCode: country,
    profile: dispatchProfile,
    definition: undefined,
    target: undefined,
    failure,
  });

  /* 5. normalize an explicit country */
  let country: string | undefined;
  if (rawCountry !== undefined) {
    const token = upperCaseAscii(trimAsciiSpace(rawCountry));
    if (!COUNTRY_PATTERN.test(token)) {
      return halted("unsupported_country", rawCountry);
    }
    country = dispatcher.countryAliases.get(token) ?? token;
    if (dispatcher.globalTarget === undefined && !dispatcher.targetsByCountry.has(country)) {
      return halted("unsupported_country", country);
    }
  }

  /* 6. select the target owning the longest exactly matching accepted prefix */
  const prefixTarget = longestPrefixTarget(dispatcher, preCanonical);

  /* 7. an explicit country and a recognized prefix designating two targets */
  const countryTarget =
    country === undefined ? undefined : dispatcher.targetsByCountry.get(country);
  if (countryTarget !== undefined && prefixTarget !== undefined && countryTarget !== prefixTarget) {
    return halted("country_mismatch", country);
  }

  /* 8 and 9. select, in order, the country, prefix, GLOBAL then implicit target */
  const target =
    countryTarget ?? prefixTarget ?? dispatcher.globalTarget ?? dispatcher.implicitTarget;
  if (target === undefined) {
    return halted("missing_country_code", country);
  }

  const definition = bundle.definitions.get(target.definitionId);
  if (definition === undefined) {
    return halted("missing_country_code", country);
  }

  /*
   * Once a definition is selected, its default_profile applies when, and only
   * when, the caller supplied no profile.
   */
  const profile = requested ?? definition.defaultProfile;

  /*
   * A GLOBAL target keeps a well formed country context in the result without
   * using it for routing; a country target reports its own ISO code, which may
   * differ from its business prefix.
   */
  const reportedCountry = target.countryCode ?? country;

  /* 10. run the canonicalization program of the selected definition once */
  const canonical = runCanonicalization(
    {
      ...baseContext(bundle, budget, profile),
      countryCode: target.countryCode,
      target,
      definition,
    },
    definition.canonicalizationProgram,
    preCanonical,
  );

  return {
    kind: dispatcher.kind,
    canonicalValue: canonical,
    countryCode: reportedCountry,
    profile,
    definition,
    target,
    failure: undefined,
  };
}

function longestPrefixTarget(
  dispatcher: IrDispatcher,
  value: readonly number[],
): IrTarget | undefined {
  for (let length = Math.min(dispatcher.longestPrefix, value.length); length >= 1; length -= 1) {
    const candidate = dispatcher.targetsByPrefix.get(stringOf(value.slice(0, length)));
    if (candidate !== undefined) {
      return candidate;
    }
  }
  return undefined;
}

function baseContext(
  bundle: LoadedBundle,
  budget: Budget,
  profile: ValidationProfile,
): EvaluationContext {
  return {
    bundle,
    budget,
    profile,
    countryCode: undefined,
    target: undefined,
    definition: undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* The pipeline                                                               */
/* -------------------------------------------------------------------------- */

/** The identity every result carries, whatever the operation. */
type Identity = Readonly<{
  kind: string;
  inputValue: string;
  canonicalValue: string;
  countryCode?: string;
  profile: ValidationProfile;
  rulesVersion: string;
  formatVersion: number;
  engineVersion: string;
}>;

function identityOf(
  bundle: LoadedBundle,
  engineVersion: string,
  input: IdentifierInput,
  outcome: Dispatch,
): Identity {
  return {
    kind: outcome.kind,
    inputValue: input.value,
    canonicalValue: stringOf(outcome.canonicalValue),
    ...(outcome.countryCode === undefined ? {} : { countryCode: outcome.countryCode }),
    profile: outcome.profile,
    rulesVersion: bundle.rulesVersion,
    formatVersion: bundle.formatVersion,
    engineVersion,
  };
}

/** The dispatch state an input longer than the byte limit is reported with. */
function tooLong(input: IdentifierInput, profile: ValidationProfile | undefined): Dispatch {
  return {
    kind: lowerCaseAscii(trimAsciiSpace(input.kind)),
    canonicalValue: codePointsOf(input.value),
    countryCode:
      input.countryCode === undefined || trimAsciiSpace(input.countryCode) === ""
        ? undefined
        : input.countryCode,
    profile: profile ?? DISPATCH_DEFAULT_PROFILE,
    definition: undefined,
    target: undefined,
    failure: "input_too_long",
  };
}

/**
 * Runs one public operation.
 *
 * The input bound is checked first and without processing the value, then
 * dispatch, then the format step, then the checksum step. A step never runs on
 * a value the previous step did not accept.
 */
export function execute(
  bundle: LoadedBundle,
  engineVersion: string,
  operation: OperationName,
  input: IdentifierInput,
  options: ValidationOptions | undefined,
): ValidationReport | CanonicalizationResult {
  const requested = options?.profile;
  const budget = new Budget();

  /* 1. an input above the byte limit is refused without being processed */
  const outcome =
    utf8ByteLength(input.value) > LIMITS.inputBytes
      ? tooLong(input, requested)
      : dispatch(bundle, input, requested, budget);

  const identity = identityOf(bundle, engineVersion, input, outcome);

  if (operation === "canonicalize") {
    return canonicalizationOf(identity, outcome);
  }
  return reportOf(bundle, identity, outcome, operation, budget);
}

function canonicalizationOf(identity: Identity, outcome: Dispatch): CanonicalizationResult {
  if (outcome.failure === undefined) {
    return { ...identity, status: "valid", reasonCode: "ok" };
  }
  return {
    ...identity,
    // country_mismatch is the one dispatch failure that proves an invalidity;
    // every other one means no conclusion is available, not a wrong value.
    status: outcome.failure === "country_mismatch" ? "invalid" : "unsupported",
    reasonCode: outcome.failure,
  };
}

function reportOf(
  bundle: LoadedBundle,
  identity: Identity,
  outcome: Dispatch,
  operation: OperationName,
  budget: Budget,
): ValidationReport {
  /* 3 and 4. dispatch did not reach a definition */
  if (outcome.failure !== undefined || outcome.definition === undefined) {
    const failure = outcome.failure ?? "unsupported_kind";
    if (failure === "country_mismatch") {
      return {
        ...identity,
        format: step("format", "invalid", "country_mismatch"),
        checksum: step("checksum", "not_run", "not_run_format_invalid"),
      };
    }
    return {
      ...identity,
      format: step("format", "unsupported", failure),
      checksum: step("checksum", "not_run", "not_run_format_unsupported"),
    };
  }

  const definition = outcome.definition;
  const context: EvaluationContext = {
    bundle,
    budget,
    profile: outcome.profile,
    countryCode: definition.countryCode,
    target: outcome.target,
    definition,
  };

  /* 5. run the format program on the canonical value */
  const assertion = runFormat(context, definition.formatProgram, outcome.canonicalValue);

  /* 6. an invalid format stops the checksum */
  if (assertion.failed) {
    return {
      ...identity,
      format: step("format", "invalid", assertion.reasonCode, assertion.messageKey),
      checksum: step("checksum", "not_run", "not_run_format_invalid"),
    };
  }

  const format = step("format", "valid", "ok");

  /* validateFormat stops here and never requests a checksum */
  if (operation === "validateFormat") {
    return { ...identity, format, checksum: step("checksum", "not_run", "not_requested") };
  }

  /* 8. a valid format without a checksum program */
  if (definition.checksumProgram === undefined) {
    return {
      ...identity,
      format,
      checksum: step(
        "checksum",
        "unsupported",
        definition.absentChecksumReason ?? "unsupported_checksum",
      ),
    };
  }

  /* 9. a valid format with a checksum program runs it */
  const outcomeOfChecksum = runChecksum(
    context,
    definition.checksumProgram,
    outcome.canonicalValue,
  );
  return {
    ...identity,
    format,
    checksum: step(
      "checksum",
      outcomeOfChecksum.status,
      outcomeOfChecksum.reasonCode,
      outcomeOfChecksum.messageKey,
    ),
  };
}
