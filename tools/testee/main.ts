/**
 * The conformance testee.
 *
 * Reads one `TesteeRequest` from standard input, calls the public API, writes
 * one `TesteeResponse` to standard output, and repeats. Each message is
 * preceded by its length as a 32 bit unsigned integer in little endian order.
 *
 * This program never reads the corpus and never sees an expected result. It
 * cannot tell a positive case from a negative one, which is what makes the
 * absence of cheating verifiable. It also never branches on `case_id`: the
 * identifier exists only so that a desynchronized exchange is detected rather
 * than silently scoring the wrong case.
 *
 * The engine interprets nothing, so `OPERATION_LOAD_RULESET` is answered by the
 * generator, exactly as the comment on field 7 of `testee.proto` describes: the
 * twenty four load time checks live there, and a bundle it refuses is a bundle
 * no engine would ever have been built from.
 */
import { fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  Operation,
  StepStatus,
} from "../../generated/libbusinessid/conformance/v1/conformance_pb.js";
import { ReasonCode } from "../../generated/libbusinessid/ir/v1/rules_pb.js";
import {
  FailureKind,
  type TesteeRequest,
  TesteeRequestSchema,
  type TesteeResponse,
  TesteeResponseSchema,
} from "../../generated/libbusinessid/testee/v1/testee_pb.js";
import { BusinessIdEngine } from "../../src/index.js";
import { BundleError } from "../generator/errors.js";
import { generate } from "../generator/generate.js";
import type { ValidationOptions } from "../../src/domain/input.js";
import type { ReasonCode as ReasonCodeName } from "../../src/domain/reason-code.js";
import type { StepStatus as StepStatusName } from "../../src/domain/status.js";
import { VALIDATION_PROFILES } from "../../src/domain/profile.js";

const STATUS_BY_NAME: Readonly<Record<StepStatusName, StepStatus>> = {
  valid: StepStatus.VALID,
  invalid: StepStatus.INVALID,
  unsupported: StepStatus.UNSUPPORTED,
  not_run: StepStatus.NOT_RUN,
};

function reasonOf(name: ReasonCodeName): ReasonCode {
  const value = ReasonCode[name.toUpperCase() as keyof typeof ReasonCode];
  if (typeof value !== "number") {
    throw new Error(`no wire value for reason code ${name}`);
  }
  return value;
}

function optionsOf(request: TesteeRequest): ValidationOptions | undefined {
  const profile = request.profile;
  if (profile === undefined) {
    return undefined;
  }
  const known = VALIDATION_PROFILES.find((candidate) => candidate === profile);
  return known === undefined ? undefined : { profile: known };
}

function answer(request: TesteeRequest): TesteeResponse {
  const engine = BusinessIdEngine.default;

  if (request.operation === Operation.LOAD_RULESET) {
    try {
      generate(request.rulesPayload ?? new Uint8Array());
      return response(request, {
        case: "load",
        value: { $typeName: LOAD, accepted: true, engineError: "" },
      });
    } catch (error) {
      if (!(error instanceof BundleError)) {
        throw error;
      }
      return response(request, {
        case: "load",
        value: { $typeName: LOAD, accepted: false, engineError: error.reason },
      });
    }
  }

  const input = {
    kind: request.kind ?? "",
    value: request.input,
    ...(request.countryCode === undefined ? {} : { countryCode: request.countryCode }),
  };
  const options = optionsOf(request);

  if (request.operation === Operation.CANONICALIZE) {
    const result = engine.canonicalize(input, options);
    return response(request, {
      case: "canonicalization",
      value: {
        $typeName: CANONICALIZATION,
        kind: result.kind,
        canonicalValue: result.canonicalValue,
        ...(result.countryCode === undefined ? {} : { countryCode: result.countryCode }),
        status: STATUS_BY_NAME[result.status],
        reasonCode: reasonOf(result.reasonCode),
      },
    });
  }

  const report =
    request.operation === Operation.VALIDATE_FORMAT
      ? engine.validateFormat(input, options)
      : request.operation === Operation.VALIDATE_CHECKSUM
        ? engine.validateChecksum(input, options)
        : engine.validate(input, options);

  return response(request, {
    case: "validationReport",
    value: {
      $typeName: REPORT,
      kind: report.kind,
      canonicalValue: report.canonicalValue,
      ...(report.countryCode === undefined ? {} : { countryCode: report.countryCode }),
      format: observedStep(report.format),
      checksum: observedStep(report.checksum),
    },
  });
}

/**
 * One validation level as the engine resolved it.
 *
 * The message key is reported when the rule carries one, and omitted when the
 * result was produced before any rule assertion ran.
 */
function observedStep(step: {
  status: StepStatusName;
  reasonCode: ReasonCodeName;
  messageKey?: string;
}): { $typeName: typeof STEP; status: StepStatus; reasonCode: ReasonCode; messageKey?: string } {
  return {
    $typeName: STEP,
    status: STATUS_BY_NAME[step.status],
    reasonCode: reasonOf(step.reasonCode),
    ...(step.messageKey === undefined ? {} : { messageKey: step.messageKey }),
  };
}

const LOAD = "libbusinessid.testee.v1.ObservedLoad" as const;
const CANONICALIZATION = "libbusinessid.testee.v1.ObservedCanonicalization" as const;
const REPORT = "libbusinessid.testee.v1.ObservedValidationReport" as const;
const STEP = "libbusinessid.testee.v1.ObservedStep" as const;

function response(request: TesteeRequest, result: TesteeResponse["result"]): TesteeResponse {
  return { $typeName: "libbusinessid.testee.v1.TesteeResponse", caseId: request.caseId, result };
}

function failure(caseId: string, detail: string): TesteeResponse {
  return {
    $typeName: "libbusinessid.testee.v1.TesteeResponse",
    caseId,
    result: {
      case: "failure",
      value: {
        $typeName: "libbusinessid.testee.v1.TesteeFailure",
        kind: FailureKind.INTERNAL_ERROR,
        detail,
      },
    },
  };
}

function main(): void {
  let pending = Buffer.alloc(0);

  const write = (message: TesteeResponse): void => {
    const body = toBinary(TesteeResponseSchema, message);
    const frame = Buffer.alloc(4 + body.length);
    frame.writeUInt32LE(body.length, 0);
    Buffer.from(body).copy(frame, 4);
    process.stdout.write(frame);
  };

  process.stdin.on("data", (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
    for (;;) {
      if (pending.length < 4) {
        return;
      }
      const length = pending.readUInt32LE(0);
      if (pending.length < 4 + length) {
        return;
      }
      const body = pending.subarray(4, 4 + length);
      pending = pending.subarray(4 + length);

      const request = fromBinary(TesteeRequestSchema, body);
      try {
        write(answer(request));
      } catch (error) {
        write(failure(request.caseId, error instanceof Error ? error.message : "unknown error"));
      }
    }
  });

  process.stdin.on("end", () => {
    process.exit(0);
  });
}

main();
