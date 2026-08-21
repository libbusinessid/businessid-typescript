/**
 * The registry abstraction.
 *
 * V1 ships no concrete provider and performs no network call. The interface
 * exists so that a later version can add one without changing the shape of the
 * engine, and so that an unavailable registry can never be mistaken for a
 * proven invalidity.
 *
 * There is deliberately no `AbortSignal` here: it is a DOM type, and the core
 * of this package is platform agnostic. A future network integration will
 * define its own cancellation strategy in a separate module.
 */
import type { IdentifierKind } from "../domain/kind.js";
import type { ReasonCode } from "../domain/reason-code.js";

/** What a registry can report about an identifier. */
export const REGISTRY_STATUSES = [
  "found",
  "not_found",
  "inactive",
  "unsupported",
  "temporarily_unavailable",
] as const;

/** What a registry reported about an identifier. */
export type RegistryStatus = (typeof REGISTRY_STATUSES)[number];

/** One identifier submitted to a registry. */
export type RegistryInput = Readonly<{
  kind: IdentifierKind;
  canonicalValue: string;
  countryCode?: string;
}>;

/** Caller options for a registry lookup. */
export type RegistryLookupOptions = Readonly<{
  /** Milliseconds after which the provider should give up, if it supports one. */
  timeoutMs?: number;
}>;

/** What a registry lookup produced. */
export type RegistryResult = Readonly<{
  status: RegistryStatus;
  providerId: string;
  /** When the provider observed this, as an ISO 8601 instant. */
  checkedAt: string;
  canonicalValue: string;
  reasonCode: ReasonCode;
  metadata?: Readonly<Record<string, string>>;
}>;

/**
 * A source of registry answers.
 *
 * A transport failure, a timeout or an authentication problem must reject
 * rather than resolve to `not_found`: an unavailable registry is not evidence
 * that an identifier does not exist.
 */
export interface RegistryProvider {
  /** True when this provider can answer for that kind and country. */
  supports(kind: IdentifierKind, countryCode?: string): boolean;
  /** Looks the identifier up. Rejects on a technical failure. */
  lookup(input: RegistryInput, options?: RegistryLookupOptions): Promise<RegistryResult>;
}

/** The result reported when no provider is configured. */
export function registryNotConfigured(canonicalValue: string, checkedAt: string): RegistryResult {
  return {
    status: "unsupported",
    providerId: "",
    checkedAt,
    canonicalValue,
    reasonCode: "registry_not_configured",
  };
}
