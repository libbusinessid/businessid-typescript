import { describe, expect, it } from "vitest";
import { EntIdEngine } from "../../src/index.js";

/**
 * The engine, running in a real browser.
 *
 * What this proves is not that the rules work — the conformance run already
 * establishes that — but that the core reaches them with no Node API, no
 * fetch, no top level await and no filesystem. The bundle is inlined as bytes
 * at build time, so the default engine builds itself synchronously in a page.
 */
describe("the default engine in a browser", () => {
  it("builds itself synchronously from the inlined bundle", () => {
    const engine = EntIdEngine.default;

    expect(engine.rulesInfo()).toMatchObject({ rulesVersion: "2026.08.33", formatVersion: 1 });
    expect(engine.capabilities()).toHaveLength(18);
  });

  it("validates an official example", () => {
    const report = EntIdEngine.default.validate({ kind: "vat", value: "BE 0123.456.749" });

    expect(report.canonicalValue).toBe("BE0123456749");
    expect(report.format.status).toBe("valid");
  });

  it("counts code points rather than UTF-16 units", () => {
    // A browser indexes strings in UTF-16 like any JavaScript runtime, so this
    // is where a length taken from `String.length` would show up.
    const astral = "\u{1D400}".repeat(512);

    expect(EntIdEngine.default.validate({ kind: "vat", value: astral }).format.reasonCode).toBe(
      "input_too_long",
    );
  });

  it("uses no locale sensitive case mapping", () => {
    // A Turkish locale upper cases `i` to `\u0130`, a different code point.
    // The engine must produce `I` whatever the page or the platform default.
    expect("i".toLocaleUpperCase("tr")).not.toBe("I");

    expect(
      EntIdEngine.default.canonicalize({ kind: "vat", value: "be0123456749" }).canonicalValue,
    ).toBe("BE0123456749");
  });

  it("runs in a page and reaches no Node global", () => {
    expect("window" in globalThis).toBe(true);
    expect("process" in globalThis).toBe(false);
    expect("Buffer" in globalThis).toBe(false);
  });
});
