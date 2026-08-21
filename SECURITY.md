# Security

## Reporting

Report a vulnerability privately through the repository's security advisory
form. Please do not open a public issue for anything that lets a crafted bundle
or a crafted input reach behaviour this document says is impossible.

## The threat model

Two inputs are untrusted, and both are treated that way.

**A rule bundle** may be hostile. `BusinessIdEngine.fromRules` applies all
twenty four load time checks of the specification before a single node runs: the
size bound, complete decoding, the version and capability gates, the unknown
field scan, the structural and arithmetic bounds, and the proof that the call
graph is acyclic and shallower than 32. A bundle that fails any of them raises a
`BundleError`; the engine never executes a partially validated graph.

**A user value** may be hostile. It is bounded to 1024 UTF-8 bytes and refused
past that without being processed. Every position and length is counted in code
points. Evaluation is bounded by a budget of 100 000 steps, which also bounds
the memory a bundle can make the engine allocate, and exhausting it raises an
engine error rather than running unbounded.

## What the engine never does

- No network access. There is no `fetch` in this package, and validation
  performs no I/O of any kind.
- No filesystem access, no Node built-in, and no DOM API in the runtime.
- No regular expression interprets a rule.
- No locale is consulted: `uppercase_ascii` maps `a..z` and nothing else, and
  the whitespace class is a frozen table rather than the runtime's own Unicode
  tables.
- No country rule is hard coded outside the bundle.
- No internal error is turned into a verdict. An engine error surfaces as an
  `EngineError`, never as `invalid_checksum`.

## What this package does not claim

A valid format means the shape matches a documented variant. A valid checksum
means the documented internal check passes. Neither is evidence that a company
exists, is active, or belongs to anyone. Do not use this package as an identity
or anti-fraud control on its own.

## Supply chain

The rule bundle is inlined from the exact bytes of the artifact published by the
specification repository, and its SHA-256 is verified against `rules.lock` when
the module is generated and again by `check:generated` in CI. The engine never
re-serializes a decoded bundle to recompute that digest: Protobuf is not a
canonical serialization, so only the bytes as received can be verified.

Every GitHub Action is pinned to a commit SHA. The runtime has one dependency,
`@bufbuild/protobuf`.
