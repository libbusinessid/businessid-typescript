# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this package follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`engineVersion`, `rulesVersion` and `formatVersion` move independently. A rules
update that changes a verdict is published as a new package version.

## [Unreleased]

### Added

- First implementation of the TypeScript engine, against rules version
  `2026.08.14` and IR format version 1.
- A generator under `tools/generator`: it reads the attested bundle, applies the
  twenty four load time checks of `ir.md` section 10 over a decoder that stays
  at the wire level, and emits `src/rules.generated.ts`. All 63 operations, the
  ten step dispatch algorithm and the tri-state checksum are emitted as code.
- Public API: `BusinessIdEngine` with `canonicalize`, `validate`,
  `validateFormat`, `validateChecksum`, `rulesInfo`, `capabilities`, `kinds` and
  `registryLookup`.
- `RegistryProvider`, declared and deliberately unimplemented.
- All 663 shared conformance cases pass over the testee protocol, reason codes
  and message keys alike, with the 33 `load_ruleset` cases answered by the
  generator.

### Notes

- The published package carries no bundle, no decoder and no interpreter, and
  **has no runtime dependencies**. Nothing under `src/` reaches a Node built-in,
  a DOM API or the network.
- There is deliberately no factory taking bundle bytes. A custom rule set goes
  through the generator, at build time.
