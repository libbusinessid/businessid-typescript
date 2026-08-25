import { describe, expect, it } from "vitest";
import { engineFor } from "../helpers/rules.js";
import {
  CanonicalizationOpKind,
  PredicateOpKind,
  ValueType,
} from "../../generated/entid/ir/v1/rules_pb.js";
import {
  alwaysValidFormat,
  canonicalizationSequence,
  node,
  type NodeSpec,
  singleKindBundle,
  valueNode,
} from "../helpers/bundle.js";

/**
 * The canonicalization steps of `ir.md` section 3.4.
 *
 * A canonicalization program never fails and never truncates: a step that
 * cannot apply leaves the value as it found it. Every case here therefore
 * asserts a produced value, never an error.
 */
async function canonical(steps: NodeSpec[], value: string, countryCode?: string): Promise<string> {
  const nodes = [...steps, canonicalizationSequence(steps.map((_, index) => index))];
  const engine = await engineFor(
    singleKindBundle({ canonicalization: nodes, format: alwaysValidFormat() }),
  );
  return engine.canonicalize({
    kind: "test",
    value,
    ...(countryCode === undefined ? {} : { countryCode }),
  }).canonicalValue;
}

const step = (kind: CanonicalizationOpKind, value: Record<string, unknown> = {}): NodeSpec =>
  node(ValueType.CANONICALIZATION_STEP, {
    case: "canonicalizationOperation",
    value: { kind, ...value },
  });

describe("TRIM_WHITESPACE", () => {
  it("removes the frozen table at both ends only", async () => {
    const trim = [step(CanonicalizationOpKind.TRIM_WHITESPACE)];

    // U+00A0, U+3000 and U+FEFF are in whitespace_v1; U+200B is not.
    expect(await canonical(trim, "  AB CD　﻿")).toBe("AB CD");
    expect(await canonical(trim, "​AB​")).toBe("​AB​");
  });
});

describe("REMOVE_WHITESPACE", () => {
  it("removes every occurrence of the frozen table", async () => {
    expect(await canonical([step(CanonicalizationOpKind.REMOVE_WHITESPACE)], "A B C　D")).toBe(
      "ABCD",
    );
  });
});

describe("UPPERCASE_ASCII", () => {
  it("maps only a..z and never consults a locale", async () => {
    // A Turkish locale would map i to İ, and a German one ß to SS. Neither
    // happens here: only a..z moves, and every other code point is preserved.
    expect(await canonical([step(CanonicalizationOpKind.UPPERCASE_ASCII)], "ißé9z")).toBe("Ißé9Z");
  });
});

describe("REMOVE_CHARS", () => {
  it("removes every code point of the set", async () => {
    expect(
      await canonical([step(CanonicalizationOpKind.REMOVE_CHARS, { text: ".-" })], "1.2-3"),
    ).toBe("123");
  });
});

describe("REPLACE_PREFIX", () => {
  const replace = [step(CanonicalizationOpKind.REPLACE_PREFIX, { text: "GR", replacement: "EL" })];

  it("replaces the exact leading text", async () => {
    expect(await canonical(replace, "GR123")).toBe("EL123");
  });

  it("leaves a value that does not start with it alone", async () => {
    expect(await canonical(replace, "FRGR1")).toBe("FRGR1");
  });
});

describe("PREPEND and APPEND", () => {
  it("adds constant text at either end", async () => {
    expect(await canonical([step(CanonicalizationOpKind.PREPEND, { text: "FR" })], "123")).toBe(
      "FR123",
    );
    expect(await canonical([step(CanonicalizationOpKind.APPEND, { text: "Z" })], "123")).toBe(
      "123Z",
    );
  });
});

describe("INSERT", () => {
  it("inserts at a code point position", async () => {
    expect(
      await canonical([step(CanonicalizationOpKind.INSERT, { index: 2, text: "-" })], "1234"),
    ).toBe("12-34");
  });

  it("leaves the value unchanged when the position is past the end", async () => {
    // Appending instead would silently move the inserted text.
    expect(
      await canonical([step(CanonicalizationOpKind.INSERT, { index: 9, text: "-" })], "1234"),
    ).toBe("1234");
  });
});

describe("LEFT_PAD", () => {
  it("pads to the requested length", async () => {
    expect(
      await canonical([step(CanonicalizationOpKind.LEFT_PAD, { length: 5, text: "0" })], "12"),
    ).toBe("00012");
  });

  it("never truncates a longer value", async () => {
    expect(
      await canonical([step(CanonicalizationOpKind.LEFT_PAD, { length: 2, text: "0" })], "12345"),
    ).toBe("12345");
  });
});

describe("PREPEND_COUNTRY_IF_MISSING", () => {
  async function withTarget(options: {
    acceptedPrefixes: string[];
    canonicalPrefix?: string;
    value: string;
  }): Promise<string> {
    const steps = [step(CanonicalizationOpKind.PREPEND_COUNTRY_IF_MISSING)];
    const nodes = [...steps, canonicalizationSequence([0])];
    const engine = await engineFor(
      singleKindBundle({
        countryCode: "GR",
        acceptedPrefixes: options.acceptedPrefixes,
        ...(options.canonicalPrefix === undefined
          ? {}
          : { canonicalPrefix: options.canonicalPrefix }),
        canonicalization: nodes,
        format: alwaysValidFormat(),
      }),
    );
    return engine.canonicalize({ kind: "test", value: options.value }).canonicalValue;
  }

  it("leaves a value that already carries an accepted prefix", async () => {
    expect(
      await withTarget({ acceptedPrefixes: ["EL", "GR"], canonicalPrefix: "EL", value: "EL123" }),
    ).toBe("EL123");
  });

  it("prepends the canonical prefix, which may differ from the country", async () => {
    // Country GR, business prefix EL: the prefix is what goes on the value.
    expect(
      await withTarget({ acceptedPrefixes: ["EL", "GR"], canonicalPrefix: "EL", value: "123" }),
    ).toBe("EL123");
  });

  it("falls back to the country code when no canonical prefix is declared", async () => {
    expect(await withTarget({ acceptedPrefixes: [], value: "123" })).toBe("GR123");
  });
});

describe("WHEN", () => {
  it("evaluates its predicate against the value current at that point", async () => {
    // The first step removes dots; the guard then sees the shortened value, so
    // a rule that reasons about length must observe the value as of that step.
    const steps: NodeSpec[] = [
      step(CanonicalizationOpKind.REMOVE_CHARS, { text: "." }),
      valueNode(),
      node(
        ValueType.BOOLEAN,
        { case: "predicateOperation", value: { kind: PredicateOpKind.LENGTH_EQ, length: 3 } },
        [1],
      ),
      step(CanonicalizationOpKind.PREPEND, { text: "X" }),
      node(
        ValueType.CANONICALIZATION_STEP,
        { case: "canonicalizationOperation", value: { kind: CanonicalizationOpKind.WHEN } },
        [2, 3],
      ),
    ];
    const nodes = [...steps, canonicalizationSequence([0, 4])];
    const engine = await engineFor(
      singleKindBundle({ canonicalization: nodes, format: alwaysValidFormat() }),
    );

    // "1.23" becomes "123", which is three code points, so the guard applies.
    expect(engine.canonicalize({ kind: "test", value: "1.23" }).canonicalValue).toBe("X123");
    // "1234" stays four, so it does not.
    expect(engine.canonicalize({ kind: "test", value: "1234" }).canonicalValue).toBe("1234");
  });
});

describe("idempotence", () => {
  it("re-canonicalizing a canonical value changes nothing", async () => {
    const steps = [
      step(CanonicalizationOpKind.TRIM_WHITESPACE),
      step(CanonicalizationOpKind.REMOVE_WHITESPACE),
      step(CanonicalizationOpKind.UPPERCASE_ASCII),
      step(CanonicalizationOpKind.REMOVE_CHARS, { text: ".-" }),
    ];
    const once = await canonical(steps, " be 0123.456-749 ");

    expect(once).toBe("BE0123456749");
    expect(await canonical(steps, once)).toBe(once);
  });
});
