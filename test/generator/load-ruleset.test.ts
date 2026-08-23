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

describe("load_ruleset corpus", () => {
  it("holds the 35 published cases", () => {
    expect(cases.length).toBe(35);
  });

  it.each(cases.map((entry) => [entry.id, entry] as const))(
    "%s is answered by one of the twenty five checks",
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
    },
  );
});
