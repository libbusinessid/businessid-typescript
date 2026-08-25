# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this package follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`engineVersion`, `rulesVersion` and `formatVersion` move independently. A rules
update that changes a verdict is published as a new package version.

## [Unreleased]

### Added

- First implementation of the TypeScript engine, against rules version
  `2026.08.38` and IR format version 1.
- A generator under `tools/generator`: it reads the attested bundle, applies the
  twenty five load time checks of `ir.md` section 10 over a decoder that stays
  at the wire level, and emits `src/rules.generated.ts`. All 63 operations, the
  ten step dispatch algorithm and the tri-state checksum are emitted as code.
- Public API: `EntIdEngine` with `canonicalize`, `validate`, `validateFormat`,
  `validateChecksum`, `rulesInfo`, `capabilities` and `kinds`. Every operation is
  synchronous and always will be.
- All 676 shared conformance cases pass, judged by the runner from the
  specification repository and pinned to the commit `rules.lock` records. This
  repository writes no comparator; it writes the testee and the tests proving it
  does not cheat.

### Changed

- The project is EntID. The package is `@entid/entid`, the public class is
  `EntIdEngine`, and the organisation is `entid-org`. Nothing had been published
  under the former name, so no consumer has to migrate.
- Rules `2026.08.38`, from the attested release `v2026.08.38` of
  `entid-org/spec`. 94 identifiers across 37 countries, 18 capabilities, and the
  proto package of the schemas moved with the project, from `libbusinessid.ir.v1`
  to `entid.ir.v1`.

### Fixed

- `pnpm verify` compared `generated/` with git's index rather than with what
  `buf` emits, so it failed on a correctly regenerated tree that had not been
  staged — which is the state `rules-sync` runs it in. It now generates beside
  the tree and compares the two listings, which also names a stale module that a
  comparison against git never reported.

### Notes

- The published package carries no bundle, no decoder and no interpreter, and
  **has no runtime dependencies**. Nothing under `src/` reaches a Node built-in,
  a DOM API or the network.
- There is deliberately no factory taking bundle bytes. A custom rule set goes
  through the generator, at build time.
- No register type ships, not even an experimental one. `engine.md` section 10
  defers the lookup and reserves its place through three properties this package
  already has: synchronous validation, no register level in the report, and no
  HTTP dependency.
