# @libbusinessid/businessid

Offline canonicalization, format validation and checksum validation of business
identifiers — VAT numbers, national company numbers, EUID, LEI and more — driven
by the shared LibBusinessID rule bundle.

**94 identifiers across 37 countries**, rules version `2026.08.14`. No network
access, no locale dependence, no regular expressions.

## What this does and does not say

This is the part worth reading before anything else.

| The engine reports | It means                                                   |
| ------------------ | ---------------------------------------------------------- |
| `format: valid`    | The shape matches a documented variant of that identifier. |
| `checksum: valid`  | The documented internal check passes.                      |
| `unsupported`      | No applicable rule can decide. This is a normal answer.    |
| `invalid`          | A documented rule proves the value wrong.                  |

None of these say a company **exists**, is **active**, or belongs to anyone.
That needs a registry, and this version queries none. The interface for one is
declared but ships without a provider.

The engine never turns absence of knowledge into an invalidity. Where no
published algorithm covers a value, the answer is `unsupported`, never
`invalid` — refusing a valid identifier is the most serious defect this project
recognises.

## Install

```sh
npm install @libbusinessid/businessid
```

ESM only. Node 20.11 or later, and any modern browser or bundler.

## Use

```ts
import { BusinessIdEngine, isFullyValidated } from "@libbusinessid/businessid";

const report = BusinessIdEngine.default.validate({
  kind: "vat",
  value: "BE 0123.456.749",
});

report.canonicalValue; // "BE0123456749"
report.countryCode; // "BE"
report.format.status; // "valid"
report.checksum.status; // "valid"
isFullyValidated(report); // true
```

The default engine builds itself on first use from a bundle inlined at build
time. There is no fetch, no filesystem read and no top level await, so the same
code runs unchanged in a browser.

### The four operations

```ts
const engine = BusinessIdEngine.default;

engine.canonicalize(input, options?);      // CanonicalizationResult
engine.validate(input, options?);          // format, then checksum
engine.validateFormat(input, options?);    // format only
engine.validateChecksum(input, options?);  // same report as validate
```

`validateFormat` still returns a complete report: on a valid format the
checksum step is `not_run` with `not_requested`, never omitted.
`validateChecksum` returns exactly what `validate` returns — the separate name
exists for readability, never to bypass the format step, which always guards
the checksum.

### Reading a report

There is deliberately no `isValid`. A valid format with an unsupported checksum
is neither fully validated nor invalid, so one boolean would have to lie about
one of them. Name the condition you mean:

```ts
import {
  isFormatValid,
  isChecksumValid,
  isFullyValidated,
  isInvalid,
} from "@libbusinessid/businessid";
```

### Country context and profiles

```ts
engine.validate({ kind: "vat", value: "0123456749", countryCode: "BE" });
engine.validate({ kind: "vat", value: "BE0123456749" }, { profile: "strict_current" });
```

A proven conflict between an explicit country and a recognised prefix reports
`country_mismatch`, which is an invalidity. A country the rules do not cover
reports `unsupported_country`, which is not.

Leaving `profile` out is not the same request as passing `compatible`: absence
is what lets the selected definition's own default apply. `compatible` accepts
current and documented historical variants; `strict_current` is opt-in and
accepts only variants currently issued.

### Kinds

`kind` accepts any string. A token this build has never heard of compiles and
reports `unsupported_kind` rather than failing to build. The kinds the shipped
bundle routes are listed by `engine.kinds()` and typed by
`KNOWN_IDENTIFIER_KINDS`.

### A custom bundle

```ts
const engine = BusinessIdEngine.fromRules(bytes);
```

The bytes are treated as untrusted whatever their source: every load time check
and every limit applies. A bundle that is malformed throws a `BundleError` with
`reason: "invalid_ruleset"`; one that announces a format version or a capability
this build does not implement throws with `"incompatible_ruleset"`, which tells
an operator to upgrade rather than to suspect the file.

Ordinary user input never throws. Only a bundle does, and only when the engine
is built.

### Versions

```ts
BusinessIdEngine.default.rulesInfo();
// { rulesVersion: "2026.08.14", formatVersion: 1, engineVersion: "0.1.0" }
```

Three versions move independently. `engineVersion` follows SemVer for the
package. `rulesVersion` is the business version of the rules. `formatVersion`
is the structural version of the IR. A rules update that changes a verdict is
published as a new package version, never applied silently.

### The registry interface

`RegistryProvider` is declared and unimplemented. Without a provider,
`registryLookup` answers `registry_not_configured`, which is an absence of
knowledge and never an invalidity. No `fetch` exists anywhere in this package,
and V1 deliberately references no `AbortSignal`: a DOM type would contradict a
platform agnostic core.

## Limits

Normative, from the specification. An engine may raise one internally, never
lower it.

| Bound                     | Value            |
| ------------------------- | ---------------- |
| User input                | 1024 UTF-8 bytes |
| Bundle                    | 16 MiB           |
| Identifiers per bundle    | 10 000           |
| Nodes per program / total | 4 096 / 500 000  |
| Call depth                | 32               |
| Steps per validation      | 100 000          |

A longer input is refused without being processed, reported as
`unsupported`/`input_too_long`. A value that is not well formed text — a lone
surrogate, which has no UTF-8 encoding — is reported as
`unsupported`/`invalid_encoding`.

## Conformance

Every one of the **663 shared conformance cases passes**, run over the testee
protocol the specification defines: a separate process receives one request at a
time and never sees an expected result, so the absence of cheating is
verifiable. No case is skipped, filtered, or marked expected to fail.

## Development

```sh
pnpm install
pnpm generate        # regenerate the inlined bundle and Protobuf types
pnpm test            # unit, conformance, property and security tests
pnpm test:coverage   # with the 95% line and 90% branch thresholds
pnpm test:browser    # the same engine in headless Chromium
pnpm test:pack       # pack, install into a blank project, run and type check
pnpm bench
```

`spec/` holds the artifacts published by the specification repository, and
`rules.lock` attests the SHA-256 of each. `pnpm check:generated` verifies both
the digests and that the generated modules match what the generator would emit.

## Licence

Apache-2.0.
