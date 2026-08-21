import { describe, expect, it } from "vitest";
import { Operation } from "../../generated/libbusinessid/conformance/v1/conformance_pb.js";
import { BundleError } from "../../tools/generator/errors.js";
import { generate } from "../../tools/generator/generate.js";
import { loadCorpus } from "../conformance/corpus.js";

/**
 * The hostile bundles of the corpus, run against the generator directly.
 *
 * `engine.md` section 1.1 puts the twenty four load time checks in the
 * generator, and the `load_ruleset` cases exercise them there: a testee that
 * generates code ahead of time answers them by calling its generator. Driving
 * them here as well gives a precise failure — which check refused, and why —
 * where the protocol level run only reports a mismatch.
 */
const cases = loadCorpus().cases.filter((entry) => entry.operation === Operation.LOAD_RULESET);

describe("load_ruleset corpus", () => {
  it("holds the 33 published cases", () => {
    expect(cases.length).toBe(33);
  });

  it.each(cases.map((entry) => [entry.id, entry] as const))("%s", (_id, entry) => {
    const payload = entry.rulesPayload;
    expect(payload, "case declares no payload").toBeDefined();
    if (payload === undefined) {
      return;
    }

    let observed: string;
    try {
      generate(payload);
      observed = "accepted";
    } catch (error) {
      if (!(error instanceof BundleError)) {
        throw error;
      }
      observed = error.reason;
    }

    expect(observed, entry.description).toBe(entry.expectedEngineError ?? "accepted");
  });
});
