import { describe, expect, it } from "vitest";
import { Operation } from "../../generated/libbusinessid/conformance/v1/conformance_pb.js";
import { BundleError } from "../../tools/generator/errors.js";
import { generate } from "../../tools/generator/generate.js";
import { LOAD_CHECK_COUNT } from "../../tools/generator/load.js";
import { loadCorpus } from "../conformance/corpus.js";

/**
 * The hostile bundles of the corpus, run against the generator directly.
 *
 * Whether each of them is refused *correctly* is the runner's verdict, not
 * this repository's: the comparator comes from `spec` and nothing here
 * reimplements it. What these tests add is what the protocol cannot carry — the
 * check that refused, by number — so a bundle refused for the right reason by
 * the wrong check is visible here rather than nowhere.
 *
 * No expected result is read.
 */
const cases = loadCorpus().cases.filter((entry) => entry.operation === Operation.LOAD_RULESET);

/**
 * Which check answers each published fixture.
 *
 * The protocol carries `expected_engine_error` and nothing else, so the runner
 * sees `invalid_ruleset` for every one of these and cannot tell check 14 from
 * check 15. That is what let three fixtures ship carrying a second defect: the
 * answer stayed the same while the rule the case exists to test stopped being
 * the one that fired.
 *
 * This table is the missing half. It does not prove a fixture is
 * single-faulted — `left_pad_length.binpb` carried two faults and still
 * answered 13, the check it is named for — but it does catch the dangerous
 * direction, where a fixture gains a fault *earlier* in the order and so never
 * reaches its own rule. `subject_node_circular.binpb` did exactly that,
 * answering 25 instead of 15, and a table like this one is what would have said
 * so on the day it appeared.
 *
 * `loader-when-unreferenced-038` is here because this engine reported that the
 * clause forbidding an unreferenced `WHEN` had no case behind it: the thirty
 * five answers were identical across two rules versions, so the table was
 * pinning nothing for it. The fixture exists now, and the entry below is the
 * first one it earns.
 */
const ANSWERING_CHECK = new Map<string, number>([
  ["loader-alphabet-empty-031", 13],
  ["loader-alphabet-missing-033", 13],
  ["loader-alphabet-repeated-030", 13],
  ["loader-alphabet-too-many-032", 13],
  ["loader-alphabet-unread-034", 13],
  ["loader-call-cycle-014", 24],
  ["loader-duplicate-prefix-017", 21],
  ["loader-empty-002", 3],
  ["loader-empty-message-key-027", 13],
  ["loader-empty-rules-version-008", 6],
  ["loader-forbidden-reason-code-018", 13],
  ["loader-global-target-with-prefix-023", 22],
  ["loader-left-pad-length-026", 13],
  ["loader-missing-operation-009", 10],
  ["loader-modulus-out-of-range-021", 13],
  ["loader-node-forward-reference-010", 11],
  ["loader-node-out-of-range-011", 15],
  ["loader-prefix-in-mixed-lengths-040", 13],
  ["loader-prefix-in-unsorted-039", 13],
  ["loader-orphan-definition-016", 23],
  ["loader-predicate-constant-028", 13],
  ["loader-program-expansion-036", 14],
  ["loader-rules-version-shape-029", 6],
  ["loader-short-digest-007", 7],
  ["loader-source-tier-unknown-035", 17],
  ["loader-stray-parameter-019", 12],
  ["loader-stray-when-branch-022", 16],
  ["loader-subject-node-circular-037", 15],
  ["loader-truncated-001", 2],
  ["loader-type-mismatch-012", 10],
  ["loader-unbounded-digits-to-integer-020", 13],
  ["loader-undeclared-feature-006", 25],
  ["loader-unknown-call-target-015", 24],
  ["loader-unknown-feature-005", 4],
  ["loader-unknown-field-root-003", 5],
  ["loader-unspecified-enum-013", 8],
  ["loader-when-unreferenced-038", 16],
  ["loader-unsupported-format-version-004", 3],
]);

describe("load_ruleset corpus", () => {
  it("holds the 38 published cases", () => {
    expect(cases.length).toBe(38);
  });

  it("names a check for every published case, and no case the corpus dropped", () => {
    expect([...ANSWERING_CHECK.keys()].sort()).toEqual(cases.map((entry) => entry.id).sort());
  });

  it.each(cases.map((entry) => [entry.id, entry] as const))(
    "%s is answered by the check it has always been answered by",
    (_id, entry) => {
      const payload = entry.rulesPayload;
      expect(payload, "case declares no payload").toBeDefined();
      if (payload === undefined) {
        return;
      }

      let refusal: BundleError | undefined;
      try {
        generate(payload);
      } catch (error) {
        if (!(error instanceof BundleError)) {
          throw error;
        }
        refusal = error;
      }

      // Every published fixture is hostile, so the generator must refuse it,
      // name a reason the contract knows and name the check that decided.
      expect(refusal, entry.description).toBeDefined();
      expect(["invalid_ruleset", "incompatible_ruleset"]).toContain(refusal?.reason);
      expect(refusal?.check).toBeGreaterThanOrEqual(1);
      expect(refusal?.check).toBeLessThanOrEqual(LOAD_CHECK_COUNT);
      expect(refusal?.check, `${entry.id}: ${refusal?.message ?? ""}`).toBe(
        ANSWERING_CHECK.get(entry.id),
      );
    },
  );
});
