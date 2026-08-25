import { describe, expect, it } from "vitest";
import { EntIdEngine } from "../../src/index.js";

describe("the default engine", () => {
  const engine = EntIdEngine.default;

  it("reports the bundle it carries", () => {
    expect(engine.rulesInfo()).toEqual({
      rulesVersion: "2026.08.33",
      formatVersion: 1,
      engineVersion: "0.1.0",
    });
  });

  it("validates an official Belgian VAT example", () => {
    const report = engine.validate({ kind: "vat", value: "BE 0123.456.749" });

    expect(report.canonicalValue).toBe("BE0123456749");
    expect(report.countryCode).toBe("BE");
    expect(report.format.status).toBe("valid");
  });
});
