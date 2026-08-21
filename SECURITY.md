# Security

## Reporting

Report a vulnerability privately through the repository's security advisory
form. Please do not open a public issue for anything that lets a crafted bundle
or a crafted input reach behaviour this document says is impossible.

## The threat model

**The published package has no untrusted input but the value being validated.**
It carries no bundle and no decoder: the rules are code, emitted at build time.
A user value is bounded to 1024 UTF-8 bytes and refused past that without being
processed, every position and length is counted in code points, and the emitted
code terminates by construction — the call graph was proved acyclic and bounded
in depth before a line of it existed. No input makes the engine throw, so it has
no error type of its own.

**A rule bundle may be hostile, and it only ever reaches the generator.** That
runs at build time, under the engine author's control, and applies all twenty
five load time checks of the specification before emitting anything: the size
bound, complete decoding at the wire level, the version and capability gates,
the unknown field scan, the structural and arithmetic bounds, and the proof that
the call graph is acyclic and shallower than 32. Check 14 refuses a
bundle whose programs would expand past the evaluation budget once repeated
operands are inlined: a DAG whose every node reads the previous one twice
explodes exponentially while passing every other check, and would be a denial of
service against the generator. A bundle failing
any of them raises a `BundleError` and nothing is emitted.

Moving the decoder out of the package is the point, not a side effect: an
interpreter would carry the whole validator and sixty three opcodes into every
consumer's runtime.

## What the engine never does

- No network access. There is no `fetch` in this package, and validation
  performs no I/O of any kind.
- No filesystem access, no Node built-in, and no DOM API in the runtime.
- No regular expression interprets a rule.
- No locale is consulted: `uppercase_ascii` maps `a..z` and nothing else, and
  the whitespace class is a frozen table rather than the runtime's own Unicode
  tables.
- No country rule is hard coded outside the bundle.
- No internal error is turned into a verdict. There is no path from an internal
  inconsistency to `invalid_checksum`, because the generator refused anything it
  did not understand and the emitted code is total.

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

Every GitHub Action is pinned to a commit SHA. **The published package has no
runtime dependencies at all** — Protobuf-ES is a build-time dependency of the
generator, and never ships.
