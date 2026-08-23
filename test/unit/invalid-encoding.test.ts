import { describe, expect, it } from "vitest";
import { Operation } from "../../generated/libbusinessid/conformance/v1/conformance_pb.js";
import { ReasonCode } from "../../generated/libbusinessid/ir/v1/rules_pb.js";
import { BusinessIdEngine, REASON_CODES } from "../../src/index.js";
import { loadCorpus } from "../conformance/corpus.js";

/**
 * Step 1 of the dispatch algorithm, pinned natively.
 *
 * `ir.md` section 5 states that no conformance case can carry
 * `invalid_encoding`: a proto3 `string` is valid UTF-8 by definition, on the
 * wire and in the corpus, and there is no portable malformed value to carry
 * anyway — an invalid byte where strings are bytes, an unpaired surrogate where
 * they are UTF-16 code units, nothing at all where they are always well formed.
 *
 * An engine must therefore pin the step with a native test naming the malformed
 * form its own string type admits. A JavaScript `string` is a sequence of
 * UTF-16 code units and admits a surrogate that is not part of a pair, which
 * has no UTF-8 encoding and so carries no code points to evaluate.
 *
 * This is the whole of the coverage that branch can have, which is why it is
 * stated here rather than left to the shared suite.
 */
const engine = BusinessIdEngine.default;

/** A high surrogate with no low surrogate after it. */
const LONE_HIGH = String.fromCharCode(0xd83d);
/** A low surrogate with no high surrogate before it. */
const LONE_LOW = String.fromCharCode(0xde00);

describe("a value JavaScript admits but UTF-8 cannot encode", () => {
  it.each([
    ["a high surrogate alone", LONE_HIGH],
    ["a low surrogate alone", LONE_LOW],
    ["a high surrogate followed by a letter", `${LONE_HIGH}A`],
    ["a low surrogate before a high one", `${LONE_LOW}${LONE_HIGH}`],
    ["a lone surrogate inside an otherwise valid value", `BE01234${LONE_HIGH}56749`],
  ])("reports invalid_encoding for %s", (_name, value) => {
    const report = engine.validate({ kind: "vat", value });

    expect(report.format).toMatchObject({
      status: "unsupported",
      reasonCode: "invalid_encoding",
    });
    expect(report.checksum).toMatchObject({
      status: "not_run",
      reasonCode: "not_run_format_unsupported",
    });
    // The value is reported verbatim: nothing was canonicalized, because there
    // were no code points to canonicalize.
    expect(report.canonicalValue).toBe(value);
  });

  it("reports it from canonicalize too, and never as an invalidity", () => {
    const result = engine.canonicalize({ kind: "vat", value: LONE_HIGH });

    expect(result).toMatchObject({ status: "unsupported", reasonCode: "invalid_encoding" });
  });

  it("accepts a well formed surrogate pair, which is one code point", () => {
    // The same two units, correctly paired, are U+1D400 and encode fine.
    const paired = "\u{1D400}";

    expect(engine.validate({ kind: "vat", value: paired }).format.reasonCode).not.toBe(
      "invalid_encoding",
    );
  });
});

describe("the corpus", () => {
  it("carries no case claiming invalid_encoding", () => {
    // `ir.md` section 5 rules it out, and the reference compiler guards against
    // one. Checking here means a corpus that ever grew such a case would be
    // caught by this engine rather than silently expected to reproduce a value
    // its protocol cannot transport.
    const claiming = loadCorpus().cases.filter((entry) => {
      if (entry.operation === Operation.LOAD_RULESET) {
        return false;
      }
      const expected = entry.expected?.value;
      if (expected?.case === "canonicalization") {
        return expected.value.reasonCode === ReasonCode.INVALID_ENCODING;
      }
      if (expected?.case === "validationReport") {
        return (
          expected.value.format?.reasonCode === ReasonCode.INVALID_ENCODING ||
          expected.value.checksum?.reasonCode === ReasonCode.INVALID_ENCODING
        );
      }
      return false;
    });

    expect(claiming.map((entry) => entry.id)).toEqual([]);
  });

  it("keeps the reason in the frozen registry all the same", () => {
    // Unreachable through the shared suite is not the same as absent: the code
    // is part of the V1 registry and renumbering it would break the enum.
    expect(REASON_CODES).toContain("invalid_encoding");
  });
});
