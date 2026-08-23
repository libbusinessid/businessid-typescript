import { describe, expect, it } from "vitest";
import { fromBinary } from "@bufbuild/protobuf";
import { RuleBundleSchema } from "../../generated/libbusinessid/ir/v1/rules_pb.js";
import { expansionOf } from "../../tools/generator/load/expansion.js";
import { RULES_BUNDLE_BYTES } from "./bundle-bytes.js";
import { loadBundle } from "../../tools/generator/load.js";

describe("the official bundle", () => {
  const bundle = loadBundle(RULES_BUNDLE_BYTES);

  it("announces the attested rules version", () => {
    expect(bundle.rulesVersion).toBe("2026.08.25");
    expect(bundle.formatVersion).toBe(1);
  });

  it("declares the eighteen capabilities of the frozen registry", () => {
    expect([...bundle.capabilities].sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 10, 11, 20, 21, 30, 31, 32, 33, 34, 35, 40, 41, 42,
    ]);
  });

  it("carries 94 definitions over 37 countries", () => {
    expect(bundle.definitions.size).toBe(94);
    const countries = new Set(
      [...bundle.definitions.values()]
        .map((definition) => definition.countryCode)
        .filter((country): country is string => country !== undefined),
    );
    expect(countries.size).toBe(37);
  });

  it("carries 250 programs holding 2375 nodes", () => {
    expect(bundle.programs.size).toBe(250);
    const nodes = [...bundle.programs.values()].reduce(
      (total, program) => total + program.nodes.length,
      0,
    );
    expect(nodes).toBe(2376);
  });

  it("routes 37 dispatchers", () => {
    expect(bundle.dispatchers.size).toBe(37);
  });
});

describe("what the shipped bundle costs to emit", () => {
  const bundle = fromBinary(RuleBundleSchema, RULES_BUNDLE_BYTES);

  /**
   * The emission profile, pinned.
   *
   * `ir.md` section 2 publishes it, and it is what makes check 14 falsifiable: a change to how instances are counted moves these
   * numbers, and two generators that disagree on the rule disagree here first.
   * Summing every capture rather than only the ones no other root reaches gives
   * 3204 instead of 3069, because all 54 captures are reached from their roots.
   */
  it("matches the published profile for 2026.08.25", () => {
    let instances = 0;
    let worst = 0;
    let worstProgram = 0;
    for (const program of bundle.programs) {
      const counted = expansionOf(program);
      instances += counted;
      if (counted > worst) {
        worst = counted;
        worstProgram = program.id;
      }
    }

    expect({ programs: bundle.programs.length, instances, worstProgram, worst }).toEqual({
      programs: 250,
      instances: 3069,
      worstProgram: 152,
      worst: 118,
    });
  });

  it("declares 54 captures, every one of them reached from its own root", () => {
    let captures = 0;
    let outsideEveryRoot = 0;
    for (const program of bundle.programs) {
      captures += program.captures.length;
      const reached = new Set<number>();
      const visit = (index: number): void => {
        if (reached.has(index)) {
          return;
        }
        reached.add(index);
        for (const input of program.nodes[index]?.inputNodes ?? []) {
          visit(input);
        }
      };
      visit(program.rootNode);
      for (const capture of program.captures) {
        if (!reached.has(capture.node)) {
          outsideEveryRoot += 1;
        }
      }
    }

    expect({ captures, outsideEveryRoot }).toEqual({ captures: 54, outsideEveryRoot: 0 });
  });
});
