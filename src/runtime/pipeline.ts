/**
 * Dispatch and the normative validation pipeline.
 *
 * Dispatch follows the ten step algorithm of `ir.md` section 5. Its order
 * matters in one place that is easy to get wrong: the pre-canonicalization
 * program runs as soon as the dispatcher is resolved, **before** any country
 * decision, so a result that stops on an unusable country still reports the
 * pre-canonical value rather than the raw one.
 *
 * Everything the rules themselves decide lives in the generated module. What is
 * here is the frame around them: the input bound, the selection of a
 * definition, and the order in which the two steps run.
 */
import type { IdentifierInput, ValidationOptions } from "../domain/input.js";
import { DISPATCH_DEFAULT_PROFILE, type ValidationProfile } from "../domain/profile.js";
import type { ReasonCode } from "../domain/reason-code.js";
import type { CanonicalizationResult, StepResult, ValidationReport } from "../domain/result.js";
import type { StepStatus } from "../domain/status.js";
import type { RuleSet } from "./ruleset.js";
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

/** The maximum size of a user supplied value, in UTF-8 bytes. */
const MAX_INPUT_BYTES = 1024;

const COUNTRY_PATTERN = /^[A-Z]{2}$/;

/** How far dispatch got, and what it produced. */
interface Dispatch {
  kind: string;
  canonicalValue: readonly number[];
  countryCode: string | undefined;
  profile: ValidationProfile;
  /** -1 when no definition was selected. */
  definition: number;
  /** Absent when a definition was selected. */
  failure: ReasonCode | undefined;
}

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
  rules: RuleSet,
  input: IdentifierInput,
  requested: ValidationProfile | undefined,
): Dispatch {
  const dispatchProfile = requested ?? DISPATCH_DEFAULT_PROFILE;
  // An empty token behaves like an absent context.
  const rawCountry =
    input.countryCode === undefined || trimAsciiSpace(input.countryCode) === ""
      ? undefined
      : input.countryCode;
  const requestedKind = lowerCaseAscii(trimAsciiSpace(input.kind));

  const stalled = (failure: ReasonCode): Dispatch => ({
    kind: requestedKind,
    canonicalValue: codePointsOf(input.value),
    countryCode: rawCountry,
    profile: dispatchProfile,
    definition: -1,
    failure,
  });

  /* 1. refuse an input that is not valid UTF-8, reporting the value verbatim */
  if (hasLoneSurrogate(input.value)) {
    return stalled("invalid_encoding");
  }

  /* 2 and 3. normalize the kind and resolve a dispatcher */
  const dispatcher = rules.dispatcherOf(requestedKind);
  if (dispatcher < 0) {
    return stalled("unsupported_kind");
  }

  /* 4. run the pre-canonicalization program exactly once on the raw value */
  const preCanonical = rules.preCanonicalize(dispatcher, codePointsOf(input.value));
  const canonicalKind = rules.canonicalKindOf(dispatcher);

  const halted = (failure: ReasonCode, country: string | undefined): Dispatch => ({
    kind: canonicalKind,
    canonicalValue: preCanonical,
    countryCode: country,
    profile: dispatchProfile,
    definition: -1,
    failure,
  });

  const globalDefinition = rules.globalDefinitionOf(dispatcher);

  /* 5. normalize an explicit country */
  let country: string | undefined;
  let countryDefinition = -1;
  if (rawCountry !== undefined) {
    const token = upperCaseAscii(trimAsciiSpace(rawCountry));
    if (!COUNTRY_PATTERN.test(token)) {
      return halted("unsupported_country", rawCountry);
    }
    country = rules.aliasCountry(dispatcher, token);
    countryDefinition = rules.definitionForCountry(dispatcher, country);
    // A GLOBAL dispatcher ignores a well formed country for routing and keeps
    // it in the result; a country specific one has nothing to route to.
    if (countryDefinition < 0 && globalDefinition < 0) {
      return halted("unsupported_country", country);
    }
  }

  /* 6. select the target owning the longest exactly matching accepted prefix */
  const prefixDefinition = rules.definitionForPrefix(dispatcher, preCanonical);

  /* 7. an explicit country and a recognized prefix designating two targets */
  if (countryDefinition >= 0 && prefixDefinition >= 0 && countryDefinition !== prefixDefinition) {
    return halted("country_mismatch", country);
  }

  /* 8 and 9. select, in order, the country, prefix, GLOBAL then implicit target */
  const definition =
    countryDefinition >= 0
      ? countryDefinition
      : prefixDefinition >= 0
        ? prefixDefinition
        : globalDefinition >= 0
          ? globalDefinition
          : rules.implicitDefinitionOf(dispatcher);
  if (definition < 0) {
    return halted("missing_country_code", country);
  }

  /*
   * Once a definition is selected, its default profile applies when, and only
   * when, the caller supplied none.
   */
  const profile = requested ?? rules.profileOf(definition);

  /*
   * A GLOBAL target keeps a well formed country context in the result without
   * using it for routing; a country target reports its own ISO code, which may
   * differ from its business prefix.
   */
  const reportedCountry = rules.countryOf(definition) ?? country;

  /* 10. run the canonicalization program of the selected definition once */
  return {
    kind: canonicalKind,
    canonicalValue: rules.canonicalizeWith(definition, preCanonical, profile),
    countryCode: reportedCountry,
    profile,
    definition,
    failure: undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* The pipeline                                                               */
/* -------------------------------------------------------------------------- */

/** The identity every result carries, whatever the operation. */
interface Identity {
  kind: string;
  inputValue: string;
  canonicalValue: string;
  countryCode?: string;
  profile: ValidationProfile;
  rulesVersion: string;
  formatVersion: number;
  engineVersion: string;
}

function identityOf(
  rules: RuleSet,
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
    rulesVersion: rules.RULES_VERSION,
    formatVersion: rules.FORMAT_VERSION,
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
    definition: -1,
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
  rules: RuleSet,
  engineVersion: string,
  operation: OperationName,
  input: IdentifierInput,
  options: ValidationOptions | undefined,
): ValidationReport | CanonicalizationResult {
  const requested = options?.profile;

  /* 1. an input above the byte limit is refused without being processed */
  const outcome =
    utf8ByteLength(input.value) > MAX_INPUT_BYTES
      ? tooLong(input, requested)
      : dispatch(rules, input, requested);

  const identity = identityOf(rules, engineVersion, input, outcome);

  if (operation === "canonicalize") {
    return canonicalizationOf(identity, outcome);
  }
  return reportOf(rules, identity, outcome, operation);
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
  rules: RuleSet,
  identity: Identity,
  outcome: Dispatch,
  operation: OperationName,
): ValidationReport {
  /* 3 and 4. dispatch did not reach a definition */
  if (outcome.failure !== undefined || outcome.definition < 0) {
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

  /* 5. run the format rule on the canonical value */
  const assertion = rules.checkFormat(outcome.definition, outcome.canonicalValue, outcome.profile);

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

  /* 8 and 9. run the checksum rule, or report why no algorithm applies */
  const checksum = rules.checkChecksum(outcome.definition, outcome.canonicalValue, outcome.profile);
  return {
    ...identity,
    format,
    checksum: step("checksum", checksum.status, checksum.reasonCode, checksum.messageKey),
  };
}
