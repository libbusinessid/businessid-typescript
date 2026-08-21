import { describe, expectTypeOf, it } from "vitest";
import type {
  BusinessIdEngine,
  CanonicalizationResult,
  IdentifierInput,
  IdentifierKind,
  ReasonCode,
  RegistryProvider,
  StepStatus,
  ValidationProfile,
  ValidationReport,
} from "../../src/index.js";

/**
 * The shape of the public API, checked by the compiler.
 *
 * These assertions are about what a consumer can and cannot write. They matter
 * as much as the runtime tests: a type that accidentally narrows breaks callers
 * at build time, and one that accidentally widens lets a mistake through.
 */
describe("IdentifierKind", () => {
  it("accepts any string, so an unknown token compiles and reports unsupported_kind", () => {
    expectTypeOf<"vat">().toExtend<IdentifierKind>();
    // A token this build has never heard of must still compile: the engine
    // answers `unsupported_kind` rather than failing to build.
    expectTypeOf<"a-kind-invented-tomorrow">().toExtend<IdentifierKind>();
    expectTypeOf<string>().toExtend<IdentifierKind>();
  });
});

describe("the closed unions", () => {
  it("keeps profiles, statuses and reason codes closed", () => {
    expectTypeOf<ValidationProfile>().toEqualTypeOf<"compatible" | "strict_current">();
    expectTypeOf<"lenient">().not.toExtend<ValidationProfile>();
    expectTypeOf<"valid">().toExtend<StepStatus>();
    expectTypeOf<"nearly">().not.toExtend<StepStatus>();
    expectTypeOf<"invalid_encoding">().toExtend<ReasonCode>();
    expectTypeOf<"made_up">().not.toExtend<ReasonCode>();
  });
});

describe("the operations", () => {
  it("returns a report from the three validations and a result from canonicalize", () => {
    // Reading the signatures off the type, never off an instance: these
    // assertions are about the declaration, and nothing is ever called.
    type Engine = BusinessIdEngine;

    expectTypeOf<ReturnType<Engine["validate"]>>().toEqualTypeOf<ValidationReport>();
    expectTypeOf<ReturnType<Engine["validateFormat"]>>().toEqualTypeOf<ValidationReport>();
    expectTypeOf<ReturnType<Engine["validateChecksum"]>>().toEqualTypeOf<ValidationReport>();
    expectTypeOf<ReturnType<Engine["canonicalize"]>>().toEqualTypeOf<CanonicalizationResult>();
  });

  it("makes options optional and the country context optional", () => {
    expectTypeOf<{ kind: string; value: string }>().toExtend<IdentifierInput>();
    expectTypeOf<{
      kind: string;
      value: string;
      countryCode: string;
    }>().toExtend<IdentifierInput>();
  });
});

describe("immutability", () => {
  it("exposes reports as read only", () => {
    expectTypeOf<ValidationReport>().toExtend<{ readonly canonicalValue: string }>();
    expectTypeOf<IdentifierInput>().toExtend<{ readonly value: string }>();
  });
});

describe("the registry interface", () => {
  it("is asynchronous and carries no DOM type", () => {
    expectTypeOf<RegistryProvider["lookup"]>().returns.toExtend<Promise<unknown>>();
    // No AbortSignal in V1: a DOM type would contradict a platform agnostic
    // core. A future network integration defines its own cancellation.
    expectTypeOf<Parameters<RegistryProvider["lookup"]>[1]>().not.toExtend<AbortSignal>();
  });
});

describe("the package surface", () => {
  it("exports no Protobuf type", async () => {
    const surface = await import("../../src/index.js");

    expectTypeOf(surface).not.toHaveProperty("RuleBundleSchema");
    expectTypeOf(surface).not.toHaveProperty("RuleBundle");
  });
});
