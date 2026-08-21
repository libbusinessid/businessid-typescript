# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this package follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`engineVersion`, `rulesVersion` and `formatVersion` move independently. A rules
update that changes a verdict is published as a new package version.

## [Unreleased]

### Added

- First implementation of the TypeScript engine, against rules version
  `2026.08.14` and IR format version 1.
- Public API: `BusinessIdEngine` with `canonicalize`, `validate`,
  `validateFormat`, `validateChecksum`, `rulesInfo`, `capabilities`, `kinds` and
  `registryLookup`.
- The complete IR interpreter: 63 operations, the ten step dispatch algorithm,
  and the validation pipeline.
- Load time validation: the twenty four checks of `ir.md` section 10, in order,
  over a decoder that stays at the wire level.
- `RegistryProvider`, declared and deliberately unimplemented.
- The rule bundle inlined from the exact bytes of the published artifact, with
  its digest verified against `rules.lock` at generation and in CI.
- All 663 shared conformance cases pass over the testee protocol.
