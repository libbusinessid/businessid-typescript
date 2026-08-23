# @libbusinessid/businessid

Offline canonicalization, format validation and checksum validation of business
identifiers — VAT numbers, national company numbers, EUID, LEI and more — driven
by the shared LibBusinessID rule bundle.

**94 identifiers across 37 countries**, rules version `2026.08.25`. No network
access, no locale dependence, no regular expressions, and **no runtime
dependencies**.

The rules are code. A generator read the published rule bundle when this package
was built, applied every load time check, and emitted TypeScript. What ships is
that code plus a small set of primitives — no bundle, no decoder, no
interpreter.

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

The value is the conformance corpus case `vat-be-normalization-004`, verbatim.
It is **synthetic and belongs to no company**: the corpus classifies it that way
and records its basis as a value produced by the generator of `DATA_POLICY.md`
section 4, derived from no register, extract, submission or telemetry. Its
sources — `be-fps-finance-vat` and `eu-vies-number-structure` — document the
format, not the holder. Every example below comes from the same corpus on the
same terms.

`BusinessIdEngine.default` is the engine. Nothing is decoded, fetched or read
from a file, so it costs nothing at start-up and the same code runs unchanged in
a browser.

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

### A custom rule set

There is no factory taking bundle bytes. A custom rule set goes through the
generator, at build time:

```sh
pnpm generate    # reads spec/businessid-rules.binpb, writes src/rules.generated.ts
```

The generator applies all twenty five load time checks of the specification and
refuses to emit anything it does not fully understand — an unknown version,
field, opcode or capability stops it. That is why the published engine can never
meet one, and why it has no error type of its own: **no input, however hostile,
makes it throw.**

### Versions

```ts
BusinessIdEngine.default.rulesInfo();
// { rulesVersion: "2026.08.25", formatVersion: 1, engineVersion: "0.1.0" }
```

Three versions move independently. `engineVersion` follows SemVer for the
package. `rulesVersion` is the business version of the rules. `formatVersion`
is the structural version of the IR. A rules update that changes a verdict is
published as a new package version, never applied silently.

### Consulting a company register

Not in this version, and this package deliberately ships no type for it — a
public type is a commitment SemVer freezes. What is settled is the shape the
future takes, so that it can arrive without breaking anything:

- **validation stays synchronous, permanently.** `canonicalize`, `validate`,
  `validateFormat` and `validateChecksum` will never return a promise. A lookup
  is a separate asynchronous operation, never a mode of these.
- **`validate` will never call a register.** The answer will be a separate
  report from a separate operation, not a field these fill in.
- **a lookup will live in a separate, server-only entry point.** It carries an
  API token, which must never be reachable from a browser, so it cannot be a
  runtime flag on this package.

`registry_not_configured` is reserved in the reason code registry and reported
by nothing today.

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
surrogate, which JavaScript admits and UTF-8 cannot encode — is reported as
`unsupported`/`invalid_encoding`.

No conformance case can carry that reason: a proto3 `string` is valid UTF-8 by
definition, and there is no portable malformed value anyway. It is pinned by a
native test naming the form a JavaScript string admits —
`test/unit/invalid-encoding.test.ts`.

The bundle shaped limits are the generator's business and no longer apply once
the code exists. The step budget does not apply at run time either: the emitted
code terminates by construction, because the call graph is acyclic and its depth
is bounded, both proved before a line was emitted. It bounds the generator
instead — a program may not expand past it once repeated operands are inlined,
counted from the roots the generator emits from.

## Conformance

Every one of the **666 shared conformance cases passes**, run over the testee
protocol the specification defines: a separate process receives one request at a
time and never sees an expected result, so the absence of cheating is
verifiable. No case is skipped, filtered, or marked expected to fail.

That includes the reason code _and_ the message key of every step, and the 33
`load_ruleset` cases, which the testee answers by calling the generator — the
twenty five checks live there now.

## Development

```sh
pnpm install
pnpm generate        # run the generator: bundle -> src/rules.generated.ts
pnpm test            # unit, generator and property tests
pnpm test:conformance # the shared suite, judged by the runner from `spec`
pnpm test:coverage   # with the 95% line and 90% branch thresholds
pnpm test:browser    # the same engine in headless Chromium
pnpm test:pack       # pack, install into a blank project, run and type check
pnpm bench
```

|                          |                                                        |
| ------------------------ | ------------------------------------------------------ |
| `spec/`                  | artifacts published by the specification repository    |
| `rules.lock`             | the SHA-256 each of them is attested by                |
| `tools/generator/`       | the generator: the decoder, the 24 checks, the emitter |
| `src/rules.generated.ts` | its output, committed                                  |
| `src/runtime/support.ts` | the primitives the generated rules call                |
| `tools/testee/`          | the conformance testee                                 |

`pnpm check:generated` verifies the digests and that the committed rules are
exactly what the generator emits from them.

## Licence

Apache-2.0.
