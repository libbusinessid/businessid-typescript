import { describe, expect, it } from "vitest";
import { RULES_BUNDLE_BYTES } from "./bundle-bytes.js";
import { loadBundle } from "../../tools/generator/load.js";

describe("the official bundle", () => {
  const bundle = loadBundle(RULES_BUNDLE_BYTES);

  it("announces the attested rules version", () => {
    expect(bundle.rulesVersion).toBe("2026.08.14");
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
    expect(nodes).toBe(2375);
  });

  it("routes 37 dispatchers", () => {
    expect(bundle.dispatchers.size).toBe(37);
  });
});
