import { describe, expect, it } from "vitest";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { Operation } from "../../generated/libbusinessid/conformance/v1/conformance_pb.js";
import {
  CanonicalizationOpKind,
  ChecksumOpKind,
  ChecksumOperationSchema,
  NodeSchema,
  ProgramKind,
  RuleBundleSchema,
  StringOpKind,
  StringOperationSchema,
  ValueType,
} from "../../generated/libbusinessid/ir/v1/rules_pb.js";
import { BundleError } from "../../tools/generator/errors.js";
import { generate } from "../../tools/generator/generate.js";
import { loadCorpus } from "../conformance/corpus.js";

/**
 * A hostile fixture must carry the defect its case is named for, and nothing
 * else.
 *
 * The runner cannot see the difference. A `load_ruleset` case declares
 * `expected_engine_error` alone — `invalid_ruleset` or `incompatible_ruleset`,
 * never a check number — so every one of the twenty five checks produces the
 * same observable answer. A fixture with a second defect is therefore answered
 * by whichever check reaches it first, and an engine that does not implement
 * the rule the case exists to test still passes it. Nothing in the shared
 * harness reports that; only decoding the bytes does.
 *
 * Three fixtures shipped that way and have since been repaired upstream:
 * `program_expansion.binpb`, `subject_node_circular.binpb` and
 * `left_pad_length.binpb`. `when_unreferenced.binpb` was published already
 * isolated, and is covered here on the same terms. Each test below repairs the named defect and nothing
 * else, then asserts the bundle loads — which is the only way to state that the
 * fixture holds one defect rather than two.
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

  it("roots its checksum program at a checksum outcome", () => {
    // The doubling chain is a string chain, and a checksum program roots at a
    // checksum outcome. The chain used to be the root, so the bundle failed
    // check 15 as well and an engine with no check 14 answered the case
    // correctly. The chain now feeds a checksum node appended after it.
    const bundle = fromBinary(RuleBundleSchema, payload);
    const checksum = bundle.programs.find((program) => program.kind === ProgramKind.CHECKSUM);

    expect(checksum, "the fixture has no checksum program").toBeDefined();
    expect(checksum?.nodes[checksum.rootNode]?.operation.case).toBe("checksumOperation");
  });

  it("loads once the expansion alone is repaired", () => {
    // Every CONCAT of the chain reads the same node twice. Reading it once
    // makes the growth linear while leaving every node, index and type in
    // place — and the chain still reaches the checksum root.
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
    expect(() => generate(toBinary(RuleBundleSchema, bundle))).not.toThrow();
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

describe("loader-left-pad-length-026", () => {
  const payload = payloadOf("loader-left-pad-length-026");

  it("is refused by check 13, for the pad length", () => {
    const refusal = refusalOf(payload);

    expect(refusal).toMatchObject({ reason: "invalid_ruleset", check: 13 });
    expect(refusal.message).toContain("4097");
  });

  it("puts its LEFT_PAD in a canonicalization program", () => {
    // The pad used to be the root of the format program, where `ir.md` section
    // 3 accepts string, predicate, assertion and CALL_OP_KIND_FORMAT and no
    // canonicalization at all. Check 16 owns that, the case never claimed it,
    // and an engine running 16 before 13 never looked at the length. It now
    // lives in a canonicalization program of its own.
    const bundle = fromBinary(RuleBundleSchema, payload);
    const holder = bundle.programs.find((program) =>
      program.nodes.some(
        (node) =>
          node.operation.case === "canonicalizationOperation" &&
          node.operation.value.kind === CanonicalizationOpKind.LEFT_PAD,
      ),
    );

    expect(holder, "the fixture has no LEFT_PAD").toBeDefined();
    expect(holder?.kind).toBe(ProgramKind.CANONICALIZATION);
  });

  it("loads once the length alone is brought inside the bound", () => {
    // 4097 is one past the node limit the slice bound shares. Clamping it to
    // the bound leaves the node where it is, in the program that accepts it.
    const bundle = fromBinary(RuleBundleSchema, payload);
    let clamped = 0;
    for (const program of bundle.programs) {
      for (const node of program.nodes) {
        if (
          node.operation.case === "canonicalizationOperation" &&
          node.operation.value.length === 4097
        ) {
          node.operation.value.length = 4096;
          clamped += 1;
        }
      }
    }

    expect(clamped, "the fixture no longer declares a length of 4097").toBe(1);
    expect(() => generate(toBinary(RuleBundleSchema, bundle))).not.toThrow();
  });
});

describe("loader-when-unreferenced-038", () => {
  const payload = payloadOf("loader-when-unreferenced-038");

  /**
   * Published in rules 2026.09.0, after this engine reported that the clause
   * forbidding an unreferenced `WHEN` had no case behind it — the thirty five
   * answers were identical across two rules versions, so nothing exercised it.
   */
  it("is refused by check 16, for the unreferenced branch", () => {
    const refusal = refusalOf(payload);

    expect(refusal).toMatchObject({ reason: "invalid_ruleset", check: 16 });
    expect(refusal.message).toContain("is a WHEN branch outside a CHOOSE");
  });

  it("keeps the checksum program rooted where it was", () => {
    // The root is what makes the fixture isolated: a program rooted at the
    // WHEN would fail check 16 for a different reason and never reach the one
    // the case is named for.
    const bundle = fromBinary(RuleBundleSchema, payload);
    const checksum = bundle.programs.find((program) => program.kind === ProgramKind.CHECKSUM);
    const root = checksum?.nodes[checksum.rootNode];

    expect(root?.operation.case).toBe("checksumOperation");
    expect(
      root?.operation.case === "checksumOperation" ? root.operation.value.kind : undefined,
    ).not.toBe(ChecksumOpKind.WHEN);
  });

  it("loads once the branch alone is given the CHOOSE it lacked", () => {
    // The minimal repair is a parent, not a deletion: removing the WHEN would
    // take the fixture's subject away with its defect. The added CHOOSE is
    // itself unreferenced, which the IR permits, and the root does not move.
    const bundle = fromBinary(RuleBundleSchema, payload);
    const checksum = bundle.programs.find((program) => program.kind === ProgramKind.CHECKSUM);
    expect(checksum, "the fixture has no checksum program").toBeDefined();
    const rootBefore = checksum?.rootNode;
    const whenAt = (checksum?.nodes ?? []).findIndex(
      (one) =>
        one.operation.case === "checksumOperation" &&
        one.operation.value.kind === ChecksumOpKind.WHEN,
    );

    expect(whenAt, "the fixture holds no WHEN").toBeGreaterThanOrEqual(0);
    checksum?.nodes.push(
      create(NodeSchema, {
        outputType: ValueType.CHECKSUM_OUTCOME,
        inputNodes: [whenAt],
        operation: {
          case: "checksumOperation",
          value: create(ChecksumOperationSchema, { kind: ChecksumOpKind.CHOOSE }),
        },
      }),
    );

    expect(checksum?.rootNode, "the repair moved the root").toBe(rootBefore);
    expect(() => generate(toBinary(RuleBundleSchema, bundle))).not.toThrow();
  });
});
