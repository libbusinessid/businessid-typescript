/**
 * Shared vocabulary of the load time checks.
 *
 * Every refusal names the check of `ir.md` section 10 that produced it, which
 * is what makes a rejected bundle diagnosable instead of merely rejected.
 */
import type { Node as ProtoNode } from "../../../generated/entid/ir/v1/rules_pb.js";
import { ReasonCode as ProtoReasonCode } from "../../../generated/entid/ir/v1/rules_pb.js";
import { BundleError, type BundleErrorReason } from "../errors.js";
import type { ReasonCode } from "../../../src/domain/reason-code.js";
import type { OpcodeSpec, OperationCase } from "../opcodes.js";
import { codePointsOf } from "../../../src/runtime/text.js";

/** Refuses the bundle, naming the check and why. */
export function fail(check: number, reason: BundleErrorReason, message: string): never {
  throw new BundleError(reason, check, message);
}

/** Refuses the bundle as malformed. */
export function invalid(check: number, message: string): never {
  return fail(check, "invalid_ruleset", message);
}

/** One node with its operation resolved, as checks 11 onwards need it. */
export interface ResolvedNode {
  readonly node: ProtoNode;
  readonly spec: OpcodeSpec;
  readonly operationCase: OperationCase;
  readonly message: Record<string, unknown>;
}

/** Compares two strings by their UTF-8 bytes, which is the normative order. */
export function compareUtf8(left: string, right: string): number {
  const a = codePointsOf(left);
  const b = codePointsOf(right);
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return a.length - b.length;
}

export const KIND_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
export const COUNTRY_PATTERN = /^[A-Z]{2}$/;
export const RULES_VERSION_PATTERN = /^[A-Za-z0-9._-]+$/;
export const PREFIX_PATTERN = /^[A-Za-z0-9]{1,8}$/;

/**
 * Turns a decoded `ReasonCode` into the lower case name the contract uses.
 *
 * Returns `undefined` for `UNSPECIFIED` and for any value outside the
 * enumeration, which the check owning the field then refuses. Resolving it here
 * rather than while decoding is what keeps an unrecognised value a problem of
 * its own field instead of a malformed bundle.
 */
export function reasonCodeName(value: number | undefined): ReasonCode | undefined {
  if (value === undefined) {
    return undefined;
  }
  const name = ProtoReasonCode[value];
  if (name === undefined || name === "UNSPECIFIED") {
    return undefined;
  }
  return name.toLowerCase() as ReasonCode;
}

/** True when a field of a decoded message is present. */
export function isPresent(
  message: Record<string, unknown>,
  key: string,
  repeated: boolean,
): boolean {
  const value = message[key];
  if (repeated) {
    return Array.isArray(value) && value.length > 0;
  }
  return value !== undefined;
}

/**
 * Walks the decoded graph looking for a field this schema does not declare.
 *
 * Generic rather than hand written per message: every Protobuf-ES message
 * carries `$typeName`, so a schema that grows a message cannot grow a blind
 * spot here.
 */
export function findUnknownField(value: unknown, path: string): string | undefined {
  if (value === null || typeof value !== "object" || value instanceof Uint8Array) {
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findUnknownField(item, `${path}[${String(index)}]`);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const unknown = record["$unknown"];
  if (Array.isArray(unknown) && unknown.length > 0) {
    const first = unknown[0] as { no?: number } | undefined;
    return `${path} carries unknown field ${String(first?.no ?? "?")}`;
  }
  for (const [key, child] of Object.entries(record)) {
    if (key.startsWith("$")) {
      continue;
    }
    const found = findUnknownField(child, path === "" ? key : `${path}.${key}`);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/**
 * True when a decoded value names a member of its enumeration.
 *
 * Decoding keeps an unrecognised enum value as its number, so membership is
 * asked over numbers here rather than over the enum type the schema declares.
 * That is what carries an unknown value to the check owning its field instead
 * of failing the decode.
 */
export function isKnownEnumValue(
  members: Record<number, string | undefined>,
  value: number,
): boolean {
  return members[value] !== undefined;
}
