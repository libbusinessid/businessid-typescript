import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * The bundle the generator reads, verified against the digest `rules.lock`
 * attests.
 *
 * The published package no longer carries these bytes: the rules are code by
 * the time it exists. Only the generator and its tests read them.
 */
function attested(): Uint8Array {
  const lock = readFileSync(new URL("../../rules.lock", import.meta.url), "utf8");
  const expected = /^rules_sha256\s*=\s*"([0-9a-f]{64})"/m.exec(lock)?.[1];
  const bytes = readFileSync(new URL("../../spec/entid-rules.binpb", import.meta.url));
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== expected) {
    throw new Error(`bundle digest ${digest} does not match rules.lock ${String(expected)}`);
  }
  return new Uint8Array(bytes);
}

export const RULES_BUNDLE_BYTES = attested();
