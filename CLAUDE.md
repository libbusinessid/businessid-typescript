# Working in this repository

## Verify with one command

```sh
pnpm verify
```

That runs the whole verification: the eight digests `rules.lock` attests, the
emitted code matching the bundle, the Protobuf types matching the schemas,
format, lint, types, build, the node and browser suites, conformance against the
runner from `spec`, coverage and its thresholds, the coverage of the emitted
rules, and packaging.

It is quiet when everything passes — **one line**, carrying the conformance
count, the test counts, coverage and the shipped size. When a step fails it
prints **that step's name and that step's output, and nothing else**, and exits
non-zero.

Do not run the individual `pnpm` scripts to check your work. They exist because
`verify` calls them, and running them one by one puts thirty full outputs through
the context of whoever is driving, twenty-nine of which say only "this passes".
`engine.md` section 12.5 is where this comes from, and the reason it is written
here rather than only there is that it addresses whoever runs, not whoever reads.

`pnpm verify <substring>` runs the matching steps alone. That is for iterating on
one thing, never for concluding that the repository is green.

CI calls `pnpm verify`, so "green" has exactly one definition.

### A step must never pass by doing nothing

Every step declares what its own output has to contain, and a step that exits
zero without producing it fails. This is not defensive decoration: a `test:fuzz`
script here once pointed at a path that did not exist, and the scheduled workflow
failed on the path for weeks while reporting nothing about the engine. A single
entry point makes that class of mistake invisible unless each step proves it ran.

When you add a step, give it a `require` pattern that only its real output can
match — the data, not a banner printed before the work starts.

## The rules bundle is not edited here

`spec/` is a copy, and `rules.lock` attests it. Never edit anything under `spec/`
to make a test pass: it is the specification, and a disagreement with it is
either a defect to report upstream or a defect here. `docs/spec-defects.md` is
the log of those, with what was measured.

`rules_version` is `YYYY.MM.PATCH` where `PATCH` counts within the month and has
no upper bound, so `2026.08.31` is followed by `2026.08.32`. It is never compared
for order — nothing in this repository does, and nothing should. Integrity comes
from the digests.

## What ships

The published package is generated code plus a small runtime: no bundle, no
Protobuf runtime, no dependencies, nothing that reads a file or the network.
`pnpm verify` asserts all of that on the tarball itself. Validation is
synchronous and there is no registry type, not even an experimental one.
