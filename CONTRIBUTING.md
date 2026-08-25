# Contributing

## Generator, not interpreter

`engine.md` section 1.2 is the shape of this repository. A generator reads the
bundle at build time, applies the twenty five load time checks, and emits
TypeScript. The engine is what ships: that emitted code, the primitives it
calls, and a hand written API.

```
spec/entid-rules.binpb                the attested bundle
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

A rules update arrives on its own, as a pull request from
`.github/workflows/rules-sync.yml`. `engine.md` section 11.4: when `spec`
publishes a release, **the engine goes and fetches it** — the release does not
push into the engine. On a clock and on demand, the workflow compares the latest
release of `spec` to `rules.lock` and does nothing when they agree. Otherwise it
downloads the artifacts, checks their SHA-256 and then their provenance
attestation — owner, repository, signing workflow and tag, read back out of the
signing certificate — writes `spec/`, `rules.lock` and `spec/PROVENANCE.md`,
regenerates the emitted code, runs `pnpm verify`, and opens a pull request with
the result. Nothing reaches the working tree before the attestation passes.

Two consequences are the point of doing it this way. Regeneration needs pnpm,
which `spec` does not have and never will, so a release that pushed a branch here
would deliver a new bundle beside the previous version's emitted code. And no
repository outside this one needs a write token here: the workflow uses the
`GITHUB_TOKEN` GitHub already hands it.

Your part is the review. Read the diff of `src/rules.generated.ts` — it is the
whole of what changed — and decide the version bump. A red pull request means the
release brought something this engine cannot do yet; it is fixed, or the release
is refused with the reason written down in `docs/spec-defects.md`. It is never
merged to unblock the chain. Rules are never updated at run time; they cannot be,
because they are code.

## Releasing

A release is one action: publish a GitHub release whose tag is `v` followed by
the version in `package.json`. `.github/workflows/release.yml` does the rest —
it refuses a tag that disagrees with the manifest, runs the whole CI suite at
that commit, and publishes.

```sh
# in a pull request
npm version minor --no-git-tag-version   # or patch, or major
# after it merges, from main
gh release create v0.2.0 --generate-notes
```

A version carrying a prerelease identifier — `0.2.0-rc.1` — goes out under the
`next` dist-tag, so `npm install` keeps returning the last stable release to
everyone who did not ask for it.

Nothing in this repository holds an npm credential. The registry trusts the
workflow's OIDC identity instead, which is also what lets it attest the
provenance of every tarball: the commit it was built from, and the run that
built it, are verifiable with `npm audit signatures`.

Two settings live outside the repository and are worth knowing about, because
nothing here can assert them:

- the trusted publisher on
  `npmjs.com/package/@entid/entid/access` — organisation `entid-org`,
  repository `entid-typescript`, workflow `release.yml`;
- the version bump itself, which is a decision. A rules update that changes a
  verdict is a minor version at least, never a patch.

## Repository settings `rules-sync` needs

Three more live outside the repository, and `GITHUB_TOKEN` can grant none of
them. Reaching for a wider secret instead would give back exactly the blast
radius section 11.4 removes, so they are written here rather than worked around:

- **Settings > Actions > General > Workflow permissions > Allow GitHub Actions to
  create and approve pull requests.** Without it `gh pr create` is refused and
  the workflow stops one step short of its purpose. The organisation carries the
  same switch, and the stricter of the two wins.
- **Settings > General > Pull Requests > Allow auto-merge.**
- **A branch protection rule or ruleset on `main` requiring the section 12.5
  entry point** — the `verify on node …` checks. Auto-merge without a required
  check merges as soon as nothing _blocks_, which is not the same as on green.
  Require the entry point and nothing beside it: a second required check that is
  not reachable through `pnpm verify` is a second definition of green, and
  auto-merge would follow the weaker one. This is why the dependency audit became
  a step of `pnpm verify` instead of a CI job of its own.

Publishing stays manual regardless. `release.yml` triggers on a published GitHub
release and on nothing else, so a merged rules pull request updates the engine and
publishes nothing.
