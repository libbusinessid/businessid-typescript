import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ValueType } from "../../generated/libbusinessid/ir/v1/rules_pb.js";
import { CAPABILITY_NAMES } from "../../tools/generator/capabilities.js";
import { LOAD_CHECK_COUNT } from "../../tools/generator/load.js";
import { OPCODE_TABLES, type OpcodeSpec } from "../../tools/generator/opcodes.js";

/**
 * Cross-checks the opcode table against `ir.md`.
 *
 * The table in `src/runtime/opcodes.ts` is transcribed from the document by
 * hand. This test re-parses the document and compares every field of every
 * operation, so a transcription slip fails here instead of silently accepting
 * a bundle no other engine would accept.
 */
interface DocumentedOpcode {
  name: string;
  output: string;
  fixed: string[];
  tail: { type: string; min: number; max: number } | undefined;
  required: string[];
  optional: string[];
  capabilities: number[];
}

function parseIrDocument(): Map<string, DocumentedOpcode> {
  const text = readFileSync(new URL("../../spec/ir.md", import.meta.url), "utf8");
  const out = new Map<string, DocumentedOpcode>();
  const sections = text.split(/^#### /m).slice(1);

  for (const section of sections) {
    const name = /^`([A-Z0-9_]+)`/.exec(section)?.[1];
    if (name === undefined) {
      continue;
    }
    const line = (label: string): string =>
      new RegExp(`^${label}: (.*)$`, "m").exec(section)?.[1] ?? "";

    const output = /`(VALUE_TYPE_[A-Z_]+)`/.exec(line("Output"))?.[1] ?? "";

    const operands = line("Operands").replace(/\.$/, "");
    const [fixedPart, tailPart] = operands.startsWith("then ")
      ? ["", operands]
      : operands.split(", then ");

    const fixed =
      fixedPart === undefined || fixedPart === "" || fixedPart === "none"
        ? []
        : [...fixedPart.matchAll(/of type `(VALUE_TYPE_[A-Z_]+)`/g)].map((match) => match[1] ?? "");

    let tail: DocumentedOpcode["tail"];
    if (tailPart !== undefined && tailPart !== "") {
      const bounds = /at least (\d+) and (?:at most (\d+)|unbounded) repeated/.exec(tailPart);
      const type = /of type `(VALUE_TYPE_[A-Z_]+)`/.exec(tailPart)?.[1] ?? "";
      tail = {
        type,
        min: Number(bounds?.[1] ?? 0),
        max: bounds?.[2] === undefined ? Number.POSITIVE_INFINITY : Number(bounds[2]),
      };
    }

    const parameters = line("Parameters").split(";")[0] ?? "";
    const required: string[] = [];
    const optional: string[] = [];
    for (const match of parameters.matchAll(/`([a-z_]+)` \((required|optional)\)/g)) {
      (match[2] === "required" ? required : optional).push(match[1] ?? "");
    }

    const capabilities = [...line("Capabilities").matchAll(/`([A-Z0-9_]+)` \((\d+)\)/g)].map(
      (match) => Number(match[2]),
    );

    out.set(name, { name, output, fixed, tail, required, optional, capabilities });
  }
  return out;
}

const documented = parseIrDocument();

const implemented = new Map<string, OpcodeSpec>(
  Object.values(OPCODE_TABLES).flatMap(({ table }) =>
    [...table.values()].map((spec) => [spec.name, spec] as const),
  ),
);

const valueTypeName = (type: ValueType): string =>
  `VALUE_TYPE_${ValueType[type] ?? `UNKNOWN(${String(type)})`}`;

describe("the load time checks", () => {
  it("counts what ir.md section 10 enumerates", () => {
    const text = readFileSync(new URL("../../spec/ir.md", import.meta.url), "utf8");
    const section = text.slice(text.indexOf("## 10. Load time validation"));
    const numbered = [...section.matchAll(/^(\d+)\. /gm)].map((match) => Number(match[1]));

    expect(Math.max(...numbered)).toBe(LOAD_CHECK_COUNT);
  });
});

describe("opcode table", () => {
  it("covers exactly the operations ir.md documents", () => {
    expect([...implemented.keys()].sort()).toEqual([...documented.keys()].sort());
  });

  it("documents 63 operations", () => {
    // `ir.md` documents 63. PROVENANCE.md still says 61, a figure predating
    // INTEGER_IS and COMPARE_CONSTANT, the two operations capabilities 35 and
    // 34 introduced. `ir.md` is the normative source and governs here.
    expect(documented.size).toBe(63);
  });

  it.each([...documented.values()])("matches ir.md for $name", (expected) => {
    const actual = implemented.get(expected.name);
    expect(actual, `${expected.name} is missing from the table`).toBeDefined();
    if (actual === undefined) {
      return;
    }

    expect(valueTypeName(actual.output), "output type").toBe(expected.output);
    expect(actual.operands.fixed.map(valueTypeName), "fixed operands").toEqual(expected.fixed);

    if (expected.tail === undefined) {
      expect(actual.operands.tail, "unexpected repeated tail").toBeUndefined();
    } else {
      expect(actual.operands.tail, "missing repeated tail").toBeDefined();
      expect(valueTypeName(actual.operands.tail?.type ?? ValueType.UNSPECIFIED)).toBe(
        expected.tail.type,
      );
      expect(actual.operands.tail?.min).toBe(expected.tail.min);
      expect(actual.operands.tail?.max).toBe(expected.tail.max);
    }

    expect([...actual.required].sort(), "required parameters").toEqual(
      [...expected.required].sort(),
    );
    expect([...actual.optional].sort(), "optional parameters").toEqual(
      [...expected.optional].sort(),
    );
    expect(
      [...actual.capabilities].sort((a, b) => a - b),
      "capabilities",
    ).toEqual([...expected.capabilities].sort((a, b) => a - b));
  });

  it("names every capability the operations require", () => {
    for (const spec of implemented.values()) {
      for (const capability of spec.capabilities) {
        expect(CAPABILITY_NAMES.has(capability), `capability ${String(capability)}`).toBe(true);
      }
    }
  });
});
