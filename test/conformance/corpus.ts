import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fromBinary } from "@bufbuild/protobuf";
import {
  type ConformanceBundle,
  ConformanceBundleSchema,
} from "../../generated/libbusinessid/conformance/v1/conformance_pb.js";

/**
 * Reads the conformance corpus published by the spec repository.
 *
 * Only the runner side of the conformance harness uses this. The testee is a
 * separate process that receives one request at a time and never sees an
 * expectation, which is what makes the absence of cheating verifiable.
 */
const CORPUS_PATH = new URL("../../spec/entid-conformance.binpb", import.meta.url);
const LOCK_PATH = new URL("../../rules.lock", import.meta.url);

function attestedDigest(key: string): string {
  const text = readFileSync(LOCK_PATH, "utf8");
  const match = new RegExp(`^${key}\\s*=\\s*"([0-9a-f]{64})"`, "m").exec(text);
  if (match?.[1] === undefined) {
    throw new Error(`rules.lock does not attest ${key}`);
  }
  return match[1];
}

let cached: ConformanceBundle | undefined;

/** The corpus, verified against the digest `rules.lock` attests. */
export function loadCorpus(): ConformanceBundle {
  if (cached !== undefined) {
    return cached;
  }
  const bytes = readFileSync(CORPUS_PATH);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const expected = attestedDigest("conformance_sha256");
  if (digest !== expected) {
    throw new Error(`conformance corpus digest ${digest} does not match rules.lock ${expected}`);
  }
  cached = fromBinary(ConformanceBundleSchema, bytes);
  return cached;
}
