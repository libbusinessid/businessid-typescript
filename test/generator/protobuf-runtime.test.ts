import { describe, expect, it } from "vitest";
import { fromBinary } from "@bufbuild/protobuf";
import { RuleBundleSchema } from "../../generated/entid/ir/v1/rules_pb.js";
import { bytes, fieldMessage, fieldVarint, tag, WIRE_LENGTH } from "../helpers/wire.js";

/**
 * Characterisation of the Protobuf-ES runtime the loader relies on.
 *
 * `ir.md` section 10 requires decoding to stay at the wire level: an unknown
 * field must reach check 5 and an unrecognised enum value must reach the check
 * that owns its field, rather than failing the decode itself. These tests pin
 * the runtime behaviour the loader is built on, so a dependency upgrade that
 * changed it would fail here instead of silently turning a version gap into a
 * malformed bundle.
 */
describe("protobuf-es wire level decoding", () => {
  it("keeps an unknown root field instead of rejecting it", () => {
    const raw = bytes([fieldVarint(1, 1), fieldVarint(99, 1)]);

    const bundle = fromBinary(RuleBundleSchema, raw);

    expect(bundle.formatVersion).toBe(1);
    expect(bundle.$unknown).toHaveLength(1);
    expect(bundle.$unknown?.[0]?.no).toBe(99);
  });

  it("keeps an unknown nested field instead of rejecting it", () => {
    const raw = bytes([
      fieldVarint(1, 1),
      fieldMessage(7, [fieldVarint(1, 1), fieldVarint(99, 1)]),
    ]);

    const bundle = fromBinary(RuleBundleSchema, raw);

    expect(bundle.programs[0]?.$unknown).toHaveLength(1);
  });

  it("carries an unrecognised enum value through as its number", () => {
    const raw = bytes([
      fieldVarint(1, 1),
      fieldMessage(7, [fieldVarint(1, 1), fieldVarint(2, 999)]),
    ]);

    const bundle = fromBinary(RuleBundleSchema, raw);

    expect(bundle.programs[0]?.kind).toBe(999);
  });

  it("throws on a truncated message", () => {
    const raw = bytes([[...tag(7, WIRE_LENGTH), 20, 1, 2]]);

    expect(() => fromBinary(RuleBundleSchema, raw)).toThrow();
  });

  it("decodes an empty payload to a bundle announcing format version zero", () => {
    const bundle = fromBinary(RuleBundleSchema, new Uint8Array([]));

    expect(bundle.formatVersion).toBe(0);
    expect(bundle.rulesVersion).toBe("");
  });
});
