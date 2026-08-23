import { describe, expect, it } from "vitest";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { Operation } from "../../generated/libbusinessid/conformance/v1/conformance_pb.js";
import {
  RuleBundleSchema,
  StringOpKind,
  StringOperationSchema,
} from "../../generated/libbusinessid/ir/v1/rules_pb.js";
import { BundleError } from "../../tools/generator/errors.js";
import { generate } from "../../tools/generator/generate.js";
import { loadCorpus } from "../conformance/corpus.js";

/**
 * A hostile fixture must carry the defect its case is named for, and nothing
 * else.
 *
 * A fixture with a second defect is answered by whichever check reaches it
 * first, so an engine missing the rule the case exists to test still passes.
 * Both `program_expansion.binpb` and `subject_node_circular.binpb` shipped that
 * way once, and this engine reported check 25 on the second rather than the
 * circularity it was written for.
 *
 * Repairing is what proves isolation, and erasing is not repairing: removing
 * the `subject_node` outright would take the circular read away along with the
 * declaration that makes the fixture interesting, and the bundle would load for
 * a reason the fixture never claimed.
 */
function payloadOf(id: string): Uint8Array {
  const entry = loadCorpus().cases.find((one) => one.id === id);
  expect(entry?.operation, `${id} is not a load_ruleset case`).toBe(Operation.LOAD_RULESET);
  return entry?.rulesPayload ?? new Uint8Array();
}

function refusalOf(payload: Uint8Array): BundleError {
  try {
    generate(payload);
  } catch (error) {
    if (error instanceof BundleError) {
      return error;
    }
    throw error;
  }
  throw new Error("the bundle was accepted");
}

describe("loader-program-expansion-036", () => {
  const payload = payloadOf("loader-program-expansion-036");

  it("is refused by check 14, for the expansion", () => {
    const refusal = refusalOf(payload);

    expect(refusal).toMatchObject({ reason: "invalid_ruleset", check: 14 });
    expect(refusal.message).toContain("operation instances");
  });

  it("still carries a second defect, so it does not isolate its own", () => {
    // Repairing the expansion alone: every CONCAT of the chain reads the same
    // node twice, and reading it once makes the growth linear while leaving
    // every node, index and type in place.
    //
    // The bundle still does not load. Its program 3 roots at that CONCAT, a
    // string node, where a checksum program must root at a checksum outcome —
    // a defect check 15 owns and the case never claimed.
    //
    // `ir.md` lets an engine run 15 before 14, so an engine with no check 14 at
    // all answers this case correctly, which is what the fixture was corrected
    // to prevent. Reported upstream; when the fixture is repaired this test
    // fails, which is exactly when it should.
    const bundle = fromBinary(RuleBundleSchema, payload);
    let rewired = 0;
    for (const program of bundle.programs) {
      for (const node of program.nodes) {
        const inputs = node.inputNodes;
        if (inputs.length === 2 && inputs[0] === inputs[1]) {
          node.inputNodes = [inputs[0] ?? 0];
          rewired += 1;
        }
      }
    }

    expect(rewired, "the chain no longer reads any operand twice").toBeGreaterThan(0);
    expect(refusalOf(toBinary(RuleBundleSchema, bundle))).toMatchObject({
      check: 15,
      reason: "invalid_ruleset",
    });
  });
});

describe("loader-subject-node-circular-037", () => {
  const payload = payloadOf("loader-subject-node-circular-037");

  it("is refused by check 15, for the circular subject", () => {
    const refusal = refusalOf(payload);

    expect(refusal).toMatchObject({ reason: "invalid_ruleset", check: 15 });
    expect(refusal.message).toContain("subject");
  });

  it("declares the capability its subject node requires", () => {
    // `features.md` section 11 freezes `Program.subject_node` into
    // CAPTURES_AND_CALLS_V1. Without the declaration the fixture also fails
    // check 25, and an engine with no circularity rule passes the case.
    const bundle = fromBinary(RuleBundleSchema, payload);

    expect(bundle.requiredFeatureIds).toContain(11);
  });

  it("loads once the circular read alone is repaired", () => {
    // The subject subtree reads `subject()`. Pointing that one node at
    // `value()` instead makes the subject well founded — the canonical value
    // exists before any subject does — and changes nothing else: the node keeps
    // its index, its type and every reader it had.
    const bundle = fromBinary(RuleBundleSchema, payload);
    let repaired = 0;
    for (const program of bundle.programs) {
      if (program.subjectNode === undefined) {
        continue;
      }
      for (const node of program.nodes) {
        if (
          node.operation.case === "stringOperation" &&
          node.operation.value.kind === StringOpKind.SUBJECT
        ) {
          node.operation.value = create(StringOperationSchema, { kind: StringOpKind.VALUE });
          repaired += 1;
        }
      }
    }

    expect(repaired, "the fixture no longer reads subject() anywhere").toBeGreaterThan(0);
    expect(() => generate(toBinary(RuleBundleSchema, bundle))).not.toThrow();
  });
});
