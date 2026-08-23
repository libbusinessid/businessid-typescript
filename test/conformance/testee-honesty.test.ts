import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { Operation } from "../../generated/libbusinessid/conformance/v1/conformance_pb.js";
import type { TesteeRequest } from "../../generated/libbusinessid/testee/v1/testee_pb.js";
import { alwaysValidFormat, singleKindBundle } from "../helpers/bundle.js";
import { TesteeClient } from "./testee-client.js";

/**
 * The testee does not cheat.
 *
 * The verdict on conformance belongs to the runner from `spec`, which this
 * repository does not and must not reimplement. What it owes instead is the
 * evidence that its testee is worth judging: that it never reads the corpus,
 * never interprets an expected result, and answers the same whatever case it is
 * told it is answering.
 *
 * `engine.md` section 11.3 requires exactly these. They are what makes the
 * absence of cheating relisible rather than asserted, and none of them opens
 * the corpus: every request below is synthesised here.
 */
const TESTEE = fileURLToPath(new URL("../../build/tools/testee/main.js", import.meta.url));
const ROOT = fileURLToPath(new URL("../..", import.meta.url));

if (!existsSync(TESTEE)) {
  execFileSync("npx", ["tsc", "-p", "tsconfig.testee.json"], { cwd: ROOT, stdio: "inherit" });
}

const client = new TesteeClient(process.execPath, [TESTEE]);

afterAll(async () => {
  await client.close();
});

const request = (caseId: string, over: Partial<TesteeRequest>): TesteeRequest => ({
  $typeName: "libbusinessid.testee.v1.TesteeRequest",
  caseId,
  operation: Operation.VALIDATE,
  input: "",
  ...over,
});

/** A handful of requests covering every operation, invented here. */
const probes = (caseId: string): TesteeRequest[] => [
  request(caseId, { operation: Operation.VALIDATE, kind: "vat", input: "BE 0123.456.749" }),
  request(caseId, { operation: Operation.VALIDATE, kind: "vat", input: "BE0123456740" }),
  request(caseId, { operation: Operation.VALIDATE_FORMAT, kind: "siren", input: "552100554" }),
  request(caseId, { operation: Operation.VALIDATE_CHECKSUM, kind: "siren", input: "552100555" }),
  request(caseId, { operation: Operation.CANONICALIZE, kind: "vat", input: "  be 0123 456 749 " }),
  request(caseId, { operation: Operation.VALIDATE, kind: "no-such-kind", input: "1" }),
  request(caseId, {
    operation: Operation.LOAD_RULESET,
    rulesPayload: singleKindBundle({ format: alwaysValidFormat() }),
  }),
  request(caseId, {
    operation: Operation.LOAD_RULESET,
    rulesPayload: new Uint8Array([0x08, 0x63]),
  }),
];

/** The observation, with the echoed identifier removed. */
async function observe(entry: TesteeRequest): Promise<string> {
  const answer = await client.exchange(entry);
  expect(answer.caseId, "the testee answered another case").toBe(entry.caseId);
  return JSON.stringify(answer.result, (_key, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value,
  );
}

describe("the testee never reads the corpus", () => {
  it("names neither the corpus nor anything that reads one", () => {
    // Static rather than behavioural: a testee that opened the corpus would
    // have to name it. `conformance_pb` is the protocol, not the corpus, and
    // the testee legitimately imports the operation enum from it.
    const code = readFileSync(TESTEE, "utf8").replace(/\/\*[^]*?\*\/|\/\/[^\n]*/g, "");

    expect(code).not.toMatch(/businessid-conformance/);
    expect(code).not.toMatch(/loadCorpus|Expected(Outcome|ValidationReport|Canonicalization)/);
    expect(code).not.toMatch(/expectedEngineError/);
  });

  it("reaches no filesystem at all", () => {
    // The corpus is a file. A testee that opens no file cannot read it, and
    // reads nothing else either.
    const code = readFileSync(TESTEE, "utf8").replace(/\/\*[^]*?\*\/|\/\/[^\n]*/g, "");

    expect(code).not.toMatch(/node:fs|require\(["']fs["']\)|readFile|openSync/);
  });
});

describe("the case identifier is inert", () => {
  it("answers the same whatever case it is told it is answering", async () => {
    // A testee that recognised a case could answer it specially. The
    // identifier exists so a desynchronized exchange is detected, and for
    // nothing else.
    for (const [index, entry] of probes("real-looking-id-001").entries()) {
      const asDeclared = await observe(entry);
      const asNonsense = await observe({ ...entry, caseId: `zzz-${String(index)}-unknown` });
      const asEmpty = await observe({ ...entry, caseId: "" });

      expect(asNonsense).toBe(asDeclared);
      expect(asEmpty).toBe(asDeclared);
    }
  });
});

describe("the order of the exchange is inert", () => {
  it("answers each request the same whichever came before it", async () => {
    const forwards = probes("forwards");
    const first = new Map<number, string>();
    for (const [index, entry] of forwards.entries()) {
      first.set(index, await observe(entry));
    }

    const backwards = [...probes("backwards").entries()].reverse();
    for (const [index, entry] of backwards) {
      expect(await observe(entry)).toBe(first.get(index));
    }
  });
});

describe("the testee is deterministic", () => {
  it("answers a repeated request identically", async () => {
    for (const entry of probes("repeat")) {
      expect(await observe(entry)).toBe(await observe(entry));
    }
  });
});
