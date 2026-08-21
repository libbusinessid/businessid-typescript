import { describe, expect, it } from "vitest";
import { Operation } from "../../src/generated/libbusinessid/conformance/v1/conformance_pb.js";
import { BundleError } from "../../src/domain/errors.js";
import { loadBundle } from "../../src/runtime/load.js";
import { loadCorpus } from "../conformance/corpus.js";

/**
 * The hostile bundles of the corpus, run against the loader directly.
 *
 * `engine.md` section 11.3 requires engine specific tests of the decoder and
 * the bundle validator on top of the shared conformance run. Driving them here
 * as well gives a precise failure — which check refused, and why — where the
 * protocol level run only reports a mismatch.
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
      loadBundle(payload);
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
