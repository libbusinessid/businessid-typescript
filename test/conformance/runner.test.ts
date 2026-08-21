import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  type ConformanceCase,
  Operation,
  StepStatus,
} from "../../src/generated/libbusinessid/conformance/v1/conformance_pb.js";
import { ReasonCode } from "../../src/generated/libbusinessid/ir/v1/rules_pb.js";
import type { TesteeRequest } from "../../src/generated/libbusinessid/testee/v1/testee_pb.js";
import { loadCorpus } from "./corpus.js";
import { TesteeClient } from "./testee-client.js";

/**
 * The shared conformance suite, run over the testee protocol.
 *
 * Every case of the corpus is executed. A case is never skipped, filtered or
 * marked expected to fail: `engine.md` section 11.1 makes an incompatibility a
 * release blocker, not a test to disable.
 */
const TESTEE = fileURLToPath(new URL("../../build/tools/testee/main.js", import.meta.url));
const ROOT = fileURLToPath(new URL("../..", import.meta.url));

if (!existsSync(TESTEE)) {
  execFileSync("npx", ["tsc", "-p", "tsconfig.testee.json"], { cwd: ROOT, stdio: "inherit" });
}

const corpus = loadCorpus();
const client = new TesteeClient(process.execPath, [TESTEE]);

afterAll(async () => {
  await client.close();
});

function requestOf(entry: ConformanceCase): TesteeRequest {
  const base = {
    $typeName: "libbusinessid.testee.v1.TesteeRequest" as const,
    caseId: entry.id,
    operation: entry.operation,
    input: entry.input,
  };
  if (entry.operation === Operation.LOAD_RULESET) {
    return {
      ...base,
      ...(entry.rulesPayload === undefined ? {} : { rulesPayload: entry.rulesPayload }),
    };
  }
  return {
    ...base,
    profile: entry.profile,
    kind: entry.kind,
    ...(entry.countryCode === undefined ? {} : { countryCode: entry.countryCode }),
  };
}

const statusName = (value: StepStatus): string => StepStatus[value] ?? `UNKNOWN(${String(value)})`;
const reasonName = (value: ReasonCode): string => ReasonCode[value] ?? `UNKNOWN(${String(value)})`;

describe("conformance", () => {
  it("holds every published case", () => {
    expect(corpus.cases.length).toBe(663);
    expect(corpus.rulesVersion).toBe("2026.08.14");
  });

  it.each(corpus.cases.map((entry) => [entry.id, entry] as const))("%s", async (_id, entry) => {
    const observed = await client.exchange(requestOf(entry));
    expect(observed.caseId, "the testee answered another case").toBe(entry.id);

    if (entry.operation === Operation.LOAD_RULESET) {
      expect(observed.result.case, entry.description).toBe("load");
      if (observed.result.case !== "load") {
        return;
      }
      const expectedError = entry.expectedEngineError ?? "";
      expect(observed.result.value.accepted).toBe(expectedError === "");
      expect(observed.result.value.engineError).toBe(expectedError);
      return;
    }

    const expected = entry.expected;
    expect(expected, "case declares no expectation").toBeDefined();

    if (expected?.value.case === "canonicalization") {
      const wanted = expected.value.value;
      expect(observed.result.case, entry.description).toBe("canonicalization");
      if (observed.result.case !== "canonicalization") {
        return;
      }
      const got = observed.result.value;
      expect({
        kind: got.kind,
        canonicalValue: got.canonicalValue,
        countryCode: got.countryCode,
        status: statusName(got.status),
        reasonCode: reasonName(got.reasonCode),
      }).toEqual({
        kind: wanted.kind,
        canonicalValue: wanted.canonicalValue,
        countryCode: wanted.countryCode,
        status: statusName(wanted.status),
        reasonCode: reasonName(wanted.reasonCode),
      });
      return;
    }

    if (expected?.value.case === "validationReport") {
      const wanted = expected.value.value;
      expect(observed.result.case, entry.description).toBe("validationReport");
      if (observed.result.case !== "validationReport") {
        return;
      }
      const got = observed.result.value;
      expect({
        kind: got.kind,
        canonicalValue: got.canonicalValue,
        countryCode: got.countryCode,
        format: {
          status: statusName(got.format?.status ?? StepStatus.UNSPECIFIED),
          reasonCode: reasonName(got.format?.reasonCode ?? ReasonCode.UNSPECIFIED),
        },
        checksum: {
          status: statusName(got.checksum?.status ?? StepStatus.UNSPECIFIED),
          reasonCode: reasonName(got.checksum?.reasonCode ?? ReasonCode.UNSPECIFIED),
        },
      }).toEqual({
        kind: wanted.kind,
        canonicalValue: wanted.canonicalValue,
        countryCode: wanted.countryCode,
        format: {
          status: statusName(wanted.format?.status ?? StepStatus.UNSPECIFIED),
          reasonCode: reasonName(wanted.format?.reasonCode ?? ReasonCode.UNSPECIFIED),
        },
        checksum: {
          status: statusName(wanted.checksum?.status ?? StepStatus.UNSPECIFIED),
          reasonCode: reasonName(wanted.checksum?.reasonCode ?? ReasonCode.UNSPECIFIED),
        },
      });
    }
  });
});
