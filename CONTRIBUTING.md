# Contributing

## Generator, not interpreter

`engine.md` section 1.2 is the shape of this repository. A generator reads the
bundle at build time, applies the twenty five load time checks, and emits
TypeScript. The engine is what ships: that emitted code, the primitives it
calls, and a hand written API.

```
spec/businessid-rules.binpb          the attested bundle
        |
        v  tools/generator/           the decoder, the 24 checks, the emitter
src/rules.generated.ts                committed output
        |
        v  src/runtime/support.ts     the primitives it calls
src/api/engine.ts                     the public API
```

Nothing under `src/` decodes anything. There is no factory taking bundle bytes,
and adding one would mean carrying the validator and every opcode into each
consumer's runtime.

The generator may use Node freely. The package may not.

## What governs

The specification governs, not this repository. `spec/` holds the artifacts it
publishes, and `rules.lock` attests the SHA-256 of each one. In order of
authority:

1. `spec/ir.md` — the exhaustive semantics of every opcode, limit and load time
   check. Where it and another document disagree, this one wins.
2. `spec/features.md` — the frozen content of each capability id.
3. `spec/rules.proto`, `spec/conformance.proto`, `spec/testee.proto`.
4. `spec/engine.md` — the contract common to every engine, section 1.2 first.
5. `spec/spec.md` — the general specification.

If two of them contradict each other, **stop and get `spec` corrected**. Do not
choose an interpretation, and never infer a semantic from another engine's
source. Known contradictions and how this engine resolves them are recorded in
`docs/spec-defects.md`.

## Rules

- **Test first.** A defect gets a test that reproduces it, watched failing,
  before the fix. Every IR operation gets a nominal case, its bounds, its error,
  and its absent or indeterminate case.
- **No comparator is written here.** The runner comes from `spec`, pinned to the
  commit `rules.lock` records. An engine that judges its own results can declare
  itself conformant by comparing too weakly. What this repository writes is the
  testee, and the tests proving it does not cheat.
- **No expected result is read outside the runner.** The testee never sees one,
  and neither does any test: engine tests assert what the protocol cannot carry,
  such as which load check refused a bundle.
- **No conformance case is skipped**, filtered, or marked expected to fail. An
  incompatibility is a release blocker, not a test to disable.
- **No test, lint rule or coverage threshold is disabled** to make CI pass. A
  rule disabled locally carries a comment saying why.
- **No identifier is written from memory.** A real value comes from the issuer's
  registry, its documentation, or a reliable directory, and the source is cited
  in the test. When an algorithm and a number disagree, suspect the number.
- **No feature is replaced by a mock or a TODO.**
- Code, comments, commits and documentation in English.

## The core is platform agnostic

Nothing under `src/` may reach a Node built-in, a DOM API, `fetch`, or a top
level await. `tsconfig.build.json` sets `types: []` so the compiler agrees, and
ESLint restricts the imports and globals so a reader sees the intent where they
look for it. Scripts under `scripts/` and the testee under `tools/` may use
Node freely — they never ship.

## Working on it

```sh
pnpm install
pnpm generate          # after any change to spec/, rules.lock or the version
pnpm test
pnpm run lint
pnpm run typecheck
```

`src/rules.generated.ts` is committed and must never be edited by hand. Change
the generator and re-run `pnpm generate`; `check:generated` fails the build if
the two disagree.

Before opening a pull request, the whole of `ci` must be green locally:
`format:check`, `lint`, `typecheck`, `check:generated`, `test:node`,
`test:coverage`, `test:browser` and `test:pack`.

## Reviewing a change to the core

- Which common semantic does it affect?
- Can the other engines implement it without diverging?
- What false negative risk does it introduce?
- Which limits and hostile inputs are tested?
- Does the conformance corpus need to change? If so, that change belongs
  upstream in `spec`, not here.
- Does the public API stay compatible?

An optimisation must demonstrate by test that it changes no result.

## Updating the rules

A rules update arrives as a change to `spec/` and `rules.lock`. Verify the
digests, run `pnpm generate`, review the diff of `src/rules.generated.ts` — it
is the whole of what changed — run the full conformance suite, and publish a new
package version. Rules are never updated at run time; they cannot be, because
they are code.
