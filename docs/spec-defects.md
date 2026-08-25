# Contradictions found in `spec`, and how they were resolved

Found while implementing this engine, across nine synchronisations. Everything
under **Resolved** has been corrected upstream in
`github.com/entid-org/spec`. One entry is open as of rules `2026.08.38`, in the
release automation rather than in the rules.

---

## Resolved

### 1. Whether an engine may interpret the bundle — architecture changed

`PROVENANCE.md` described a generator, `spec.md` section 2.3 tolerated an
interpreter, `engine.md` was silent, and `engine-typescript.md` required
`static fromRules(bytes: Uint8Array)` — an API that hands every caller the full
validator and the execution machinery. This engine was first built as an
interpreter, following the tolerance and the mandated API.

**Corrected** by `engine.md` section 1.2 and a rewritten `spec.md` section 2.3:
a generator reads the bundle at build time and emits source; interpretation is
forbidden. `fromRules` is gone from the TypeScript contract.

**Here**: the decoder, the load checks, the IR types and the opcode table live
in `tools/generator/`, which emits `src/rules.generated.ts`. The package has no
bundle, no decoder, no interpreter and no runtime dependency.

### 2. The order of the dispatch algorithm

`ir.md` section 5 ran the pre-canonicalization program before the country
decision; `engine.md` section 8.0 and `spec.md` section 6.11 ran it after.
Observable on an unusable country, where the reported `canonicalValue` differs.
Both now follow `ir.md`.

### 3. `invalid_encoding` missing from two registries

`rules.proto` and `ir.md` carried it; `engine.md` section 5.5 and `spec.md`
section 8.4 listed twenty codes and omitted it. Both corrected.

### 4. The optionality of the profile

`engine.md` section 5.2 wrote `profile: ValidationProfile = compatible`, which
applied at the API boundary would mean a definition's `default_profile` could
never apply. The profile is optional again.

### 5. The testee protocol carried no message key

`engine.md` section 11.2 said the tests compare the reason code _and_ the key,
but `ObservedStep` had no such field. It gained `optional string message_key = 3`.

**What it caught**: 150 expected steps across 84 distinct keys declare one.
Deliberately corrupting the key this engine reports fails exactly those 150
cases and no others, which is how the comparison was verified to be real.

### 6. A bound on how much code one program may expand to

Reported from here as a generator-side choice the specification left open. The
emitter inlines, which keeps the short-circuit of `ALL`, `ANY` and the assertion
sequence where the IR puts it; a DAG whose every node reads the previous one
twice expands exponentially while passing every other check.

**Corrected** by `ir.md`, which states the bound in section 2 and places it as
**check 14**: a generated program may hold at most 100000 operation instances,
counted after inlining — the evaluation budget rather than a new number.

Three details were then added, each of which decides whether two generators
answer the same on the same bundle, and this engine had the first one wrong:

- **the count starts at the emission roots** — the program root and each
  capture — and follows operands. A node no root reaches is emitted by nobody.
  This engine counted every node, so it refused bundles any generator can emit;
  the defect is fixed and `test/generator/expansion.test.ts` proves a dead chain
  now costs nothing.
- **a `CALL` counts as one instance**, its callee being bounded on its own.
- **the arithmetic saturates** rather than wrapping, because an accumulator that
  overflows lands on a small number that passes.

The published fixture `program_expansion.binpb` and case
`loader-program-expansion-036` exercise it. This engine reports check 14 on it,
and only check 14 — see entry 10, because the fixture had to be repaired twice
before that sentence was true.

### 7. Stale counts, and the copied capability registry

`PROVENANCE.md` is generated now and carries the real figures.
`spec.md` section 7.4 no longer copies the capability registry: it points at
`features.md` and says why a hand kept table drifts.

---

### 8. `engine.md` section 15.1 contradicted sections 1.2 and 10

The minimal API list still carried:

```text
engineFromRules(bytes)
registryLookup(input, provider, options)   # interface, aucune implémentation
```

Section 1.2 forbids the first — "aucun moteur n'expose de fabrique acceptant un
bundle en octets à l'exécution" — and section 10 forbids the second — "Aucun
moteur ne doit livrer `RegistryProvider`, et un moteur qui ne le livre pas est
pleinement conforme". The same document contradicted itself, and which side won
was not in doubt: 1.2 and 10 are the reasoned rewrites, 15.1 was the list they
had not been applied to.

**Corrected.** `engine.md` section 15.1 now lists seven operations, none of them
those two, and records why the list changed. This engine ships neither, which
`test/unit/public-surface.test.ts` states as three properties of the exported
surface rather than as an intention.

### 9. The check count read twenty four in four places

`ir.md` section 10 enumerates **25** checks. Four passages said twenty-four,
including the sentence in `engine.md` that delegates authority over the order to
`ir.md` — so it named a count that document no longer had.

**Corrected.** `engine.md` lines 54, 72 and 361 and `spec.md` line 82 now read
`vingt-cinq`, and the delegating sentence was reworded rather than renumbered.

### 10. Hostile fixtures carrying a second defect

Five corpus fixtures have been found declaring one defect and carrying two.
Three of them are `load_ruleset` cases this engine covers, and all three are now
repaired upstream:

| Fixture                       | Named defect                               | Second defect                                                                                            | Repaired in  |
| ----------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------ |
| `program_expansion.binpb`     | check 14, the expansion budget             | its checksum program rooted at the string chain, which check 15 owns                                     | `2026.08.24` |
| `subject_node_circular.binpb` | check 15, a subject built from `subject()` | capability 11 undeclared, which check 25 owns                                                            | `2026.08.23` |
| `left_pad_length.binpb`       | check 13, `length: 4097`                   | the pad sat in the format program, where `ir.md` section 3 accepts no canonicalization at all — check 16 | `2026.08.25` |

The first two were reported from here; the third by the Swift engine.

**Why the shared harness cannot see this.** A `load_ruleset` case declares
`expected_engine_error` and nothing else: across the 35 such cases the corpus
holds exactly two values, `invalid_ruleset` (32) and `incompatible_ruleset` (3).
Never a check number. Every one of the twenty five checks therefore produces the
same observable answer, the runner cannot tell which one fired, and an engine
that does not implement the rule the case exists to test passes it anyway. That
is not a flaw in the runner — `ir.md` section 2 relies on the same property when
it lets an engine run check 15 before check 14 — but it does mean a fixture's
isolation is invisible to conformance and can only be established by decoding
the bytes. All five were found that way, by engines, and none by the runner.

`test/generator/fixture-isolation.test.ts` states isolation as a property: it
repairs the named defect and nothing else, then asserts the bundle loads. Any
future fixture that regains a second defect fails there. It also pins the repair
itself — the checksum root, the declared capability 11, the program kind holding
the `LEFT_PAD` — so a silent revert is caught with a message that names what
moved.

One detail worth keeping. On `left_pad_length.binpb` this engine reported the
named check 13 even before the repair, because `ir.md` section 10 orders 13
ahead of 16 and this engine follows that order; the Swift engine reported 16.
Two engines disagreeing about which defect they saw is the clearest possible
signal that the fixture carried two, and neither engine was wrong about the
answer — both said `invalid_ruleset`.

### 11. Check 16 named the accepted root but not the accepted categories

`ir.md` section 2 states, per program kind, both an accepted root and a set of
accepted operation categories. Section 10's check 16 named only the root, so the
categories belonged to no numbered check. Two engines assigned them by
inference, and to different places: this one to the shape pass after check 13,
the Swift engine to the per-node pass before it.

The consequence was visible on `left_pad_length.binpb`, whose `LEFT_PAD` sat in
a format program with `length: 4097` — a category fault and a bounds fault on
one node. This engine answered 13, the Swift engine answered 16, both refused
the bundle, and neither could say which fault the case was proving. That is what
made the fixture's second defect invisible: two conformant engines disagreeing
about the reason while agreeing on the answer.

**Corrected** in `2026.08.26`. Check 16 now reads "the accepted root and the
accepted operation categories of the kind, both as section 2 states them", and
the rule moved into the shape pass where that number puts it. Nothing observable
changes — the corpus carries `expected_engine_error` alone — but two engines
reading the same document now reach the same conclusion about which check
refused a bundle, which is the precondition for arguing about isolation at all.

**Measured here** after the correction, in
`test/generator/loader.test.ts`: a foreign category alone answers 16, an
out-of-range length alone answers 13, and a node carrying both answers **13** —
as does a bundle carrying the two faults in different programs. That is the
documented order, and the tests fail if it drifts.

### 12. `spec.md` still permitted an interpreter

Entry 1 records the architecture change: `engine.md` section 1.2 forbids an
engine to embed the bundle and interpret it. `spec.md`, in the section
documenting `rules.lock`, still said the opposite — an engine MAY embed the
bundle if it chooses to interpret it. That is the sentence this engine was built
on the first time.

It survived four audits because every guard here read `engine.md` and the
per-language contract and stopped there. **Corrected** in `2026.08.26`: the
sentence now states the prohibition and records why it lasted.

Nothing changed in this engine, which has shipped no bundle and no decoder since
entry 1; `test/unit/public-surface.test.ts` and the three tarball assertions in
`scripts/pack-and-install.mjs` are what keep it that way.

### 13. The readable corpus shipped unverified

`rules.lock` attested seven files. `spec/entid-conformance.jsonl` was not
among them, although it is the form a human reviews and the form whose case ids
engine tests cite as provenance — this repository's README note names
`vat-be-normalization-004`, and nothing verified the file that defines it.

Found by the Swift engine. **Corrected** in `2026.08.26` by an eighth digest,
`conformance_jsonl_sha256`, taken on the decompressed bytes that land in
`spec/`. The generator here verifies all eight and refuses to emit when one
moved; appending a newline to the JSONL is refused with both digests named.

### 14. Two questions the document did not answer, now answered

Neither was a contradiction: both were places where two engines reached the same
conclusion independently, which is what says the document was silent.

- **Coverage.** `engine.md` section 12.2 now separates the thresholds, which
  cover hand-written code, from the emitted code, whose coverage measures the
  corpus rather than the engine — measure it, publish it, never gate on it. This
  engine already gated on hand-written code only; it now also publishes the
  emitted figure, through `pnpm run coverage:generated`, which asserts nothing.
- **README identifiers.** Section 12.2.1 settles that a synthetic value is
  correct in a README, because the example demonstrates an API rather than a
  register, and requires it to say what it is — synthetic, from the documented
  generator, preferably naming its conformance case. The note added in entry 10
  already says all three.

---

### 15. The `GOTOOLCHAIN` requirement was stated more broadly than it held

Reported from here last round. `spec.md` and `engine.md` both required the runner
step to set `GOTOOLCHAIN: auto` and justified it with "Mesuré : sans cela, la
première exécution échoue sur la résolution de la toolchain". Measured against
`53fb506a`, the module declared `go 1.25.0` with `toolchain go1.26.5`, and it was
the first line that bound: the runner built under `GOTOOLCHAIN=local` and under
`go1.25.0`, failing only at `go1.24.0`. An engine resolving `stable` never met
the case.

**Corrected** in `2026.08.31`. Both documents now name the `go` line as the exact
condition, record that the Go engine hit it because it pins lower and that the
TypeScript engine measured the other side, and keep the requirement as insurance
rather than as a repair. This repository already sets it.

### 16. `engine.md` section 9.1 contradicted itself in two sentences

The section said an out-of-bounds view produces an absent value and never an
exception, then added that an out-of-bounds access inside a checksum after a
valid format must produce an engine error. `ir.md` section 1.1 is unreserved —
"Absence is never an error and never an exception" — so the same bytes could be
answered with an absence by one engine and an error by another.

Found by the Kotlin engine, which followed `ir.md`. **Corrected** in
`2026.08.31`: the clause is gone, and the document records that the intuition
behind it — a format rule is expected to establish the bounds before the checksum
runs — is a property of a rule set that nothing proves at load time, not a
run-time behaviour.

This engine has always read it the surviving way. It contains no `throw` in
anything it ships, which is the strongest form of the guarantee, and
`test/unit/ir-checksum.test.ts` now pins the exact case the two engines
disagreed on.

### 17. A dead `WHEN` passed the reference loader

Check 16 takes `WHEN` only as a direct operand of a `CHOOSE`. Read as written
that is a statement about the node; the reference loader answered it by looking
at each node's parents, and a node with no parent has none to look at. `ir.md`
section 2 permits unreachable nodes, so a dead `WHEN` survived. Found by the
Kotlin engine.

**Corrected** in `2026.08.31`, with the program root left excluded: `root_node`
is a reference, so a program rooted in a `WHEN` keeps its own rule and message.

**Checked here, and this engine did not have the hole.** Its check tests the
node's own membership in the set of `CHOOSE` operands rather than asking whether
it has a parent, so a `WHEN` nothing references was already refused. Measured on
four shapes, now pinned in `test/generator/loader.test.ts`:

| Shape                        | Answer                                               |
| ---------------------------- | ---------------------------------------------------- |
| `WHEN` a `CHOOSE` reads      | loads                                                |
| `WHEN` nothing references    | check 16, `node 5 is a WHEN branch outside a CHOOSE` |
| `WHEN` as the program root   | check 16, `roots at a WHEN branch`                   |
| `WHEN` an `ALL_CHECKS` reads | check 16, `node 3 is a WHEN branch outside a CHOOSE` |

Re-introducing the parent-based reading in the loader fails the second of those
and nothing else, which is what says the test is aimed at the right thing.

None of the thirty-five published fixtures moved: the answering check is
identical under `2026.08.26` and `2026.08.31` for all of them, so the pinned
table added last round caught nothing here. `loader-stray-when-branch-022` uses a
`WHEN` as a root, which was already refused.

### 18. The input bound and ill-formed text, now a stated choice

Step 1 counts the bound in UTF-8 bytes and runs before the step that refuses
ill-formed text, so an input that is both has no byte count of its own.
`ir.md` now states the freedom and bounds it: an engine whose string type admits
ill-formed text chooses, and MUST state which.

**Stated here** in the README's Limits section: this engine counts what its own
encoder produces, so a lone surrogate is measured as the three bytes
`TextEncoder` emits for the replacement character.

Worth recording that in JavaScript the choice is not observable. The alternative
`ir.md` names — the encoding the surrogate would have had — is also three bytes
(`ED A0 80`), where a platform whose encoder emits a single replacement byte
would answer differently. `test/unit/invalid-encoding.test.ts` brackets the
boundary at 1021 and 1022 ASCII characters so the README and the behaviour
cannot drift apart.

### 19. The clause forbidding an unreferenced `WHEN` now has a case

Reported from here last round, as a negative result: the thirty five
`load_ruleset` answers were identical between `2026.08.26` and `2026.08.31`, so
the pinned-check table added that round caught nothing, and no published fixture
exercised the rule at all. `loader-stray-when-branch-022` uses a `WHEN` as a
program root, which a different clause already refused.

**Answered** in `2026.09.0` by `when_unreferenced.binpb` and
`loader-when-unreferenced-038`. Decoded here: its checksum program keeps its
original root at the `LUHN` outcome, and node 3 is a `WHEN` reading `[2, 1]` that
nothing references — one defect and no other. This engine answers check 16, and
giving the branch a `CHOOSE` that reads it, without moving the root, makes the
bundle load. The pinned table has thirty six entries now, and one of them is
finally pinning this.

### 20. No check owned the normative order of a parameter list

`ir.md` section 9 put `PredicateOperation.values` and `lengths` under the
normative serialization order — "ascending, deduplicated" — and stated that an
engine refuses a bundle that does not respect it. Section 10 assigned a numbered
check to every other ordering it makes normative and none to these two.

This engine was not enforcing it at all. That went unnoticed while the lookup
was a linear scan and became load bearing the moment it stopped being one:
`prefix_in` is documented as sorted precisely so an engine can search it, and a
binary search over an unsorted list does not answer slowly, it answers wrongly.
Fixed here at check 13 — where the other per-node parameter list rules live, it
already refuses a custom alphabet that repeats a code point — and reported as a
question rather than presented as settled, because two engines inferring a
number independently is how entry 11 happened.

**Corrected** in `2026.09.2`. Check 13 now reads "and the declared order of a
parameter list as section 9 states it", which is where this engine had put it.
The reference loader had the same hole — descending, duplicated and equal keys
out of order all passed it — and fixture `prefix_in_unsorted.binpb`, case
`loader-prefix-in-unsorted-039`, exists now. This engine answers check 13 on it.

### 21. A `prefix_in` may not mix element lengths, and no case can prove it

Reported from here as the reason the search asks the list once per distinct
element length rather than once for the value: an element is a prefix of the
subject exactly when it equals the subject's opening of its own length, and a
search for the greatest element not after the subject gets `["AB", "ABA"]`
against `"ABCD"` wrong — it finds `ABA`, which is not a prefix, while `AB` is.

The Swift engine measured the part neither of us had said out loud: **the corpus
cannot catch an engine that gets this wrong.** All four published `prefix_in`
nodes hold a single element length — 1748 of five, 818 of six, 148 of four, 41
of two — so a whole-table search passes every published case while being wrong
on a shape no rule carries.

**Corrected** in `2026.09.2` by removing the shape: every element has the same
length, mixed lengths are written as one `prefix_in` per length under an `any`,
and fixture `prefix_in_mixed_lengths.binpb`, case
`loader-prefix-in-mixed-lengths-040`, refuses it. This engine accepted that
fixture before this round — its per-length search reads such a list correctly,
so nothing forced the refusal — and now answers check 13.

**What the refusal costs, and where the coverage went.** The rule is right, and
it takes with it the only shapes that tell a correct search from an incorrect
one. Two tests here were written as bundles and can no longer be: a mixed-length
`prefix_in` is refused at load. They moved below the loader, to
`test/unit/support.test.ts`, where the function can still be handed the shape,
and `test/unit/properties.test.ts` gained a property comparing the search
against the definition transcribed — some element is a prefix of the subject —
over four hundred random tables, mixed lengths included.

Installing the whole-table search fails both, and the property shrinks the
counterexample to `["A", "AA"]` against `"AB"` in thirteen runs. Nothing in the
shared suite fails. That is the measurement worth keeping: for this rule the
conformance corpus is not the guard, and after `2026.09.2` it cannot become one.

### 22. The `prefix_in` element length is bytes, and this engine was counting code points

Entry 21 added the uniform-length rule; `2026.08.32` states the unit. It is
**UTF-8 bytes**, because the search the rule protects is over bytes, and an
engine working in another unit may group more finely without contradicting it.

This engine had implemented the check in **code points**, which is wrong in both
directions and was measured to be:

| List           | UTF-8 bytes | code points | correct  | this engine, before |
| -------------- | ----------- | ----------- | -------- | ------------------- |
| `["PZ", "é"]`  | 2, 2        | 2, 1        | accepted | **refused**         |
| `["AB", "éé"]` | 2, 4        | 2, 2        | refused  | **accepted**        |

No conformance case separates the readings — every element of the published
bundle is ASCII, where they agree — so nothing in the shared suite would ever
have said so. Both cases are tests here now, and both failed before the unit was
changed.

The search still groups by code point length, because a `StringValue` is code
points. `ir.md` permits the finer grouping explicitly, and `["PZ", "é"]` is the
list that shows what it means: it loads as one byte-length class and is searched
as two code-point classes. That is also a test.

### 23. The rules version went backwards, and nothing here noticed

`rules_version` is `YYYY.MM.PATCH` where `PATCH` counts within the month with no
upper bound, so `2026.08.31` is followed by `2026.08.32`. Four versions announced
September in August by treating the third field as a day, and `2026.09.2` rolls
back to `2026.08.32`.

**Checked here, because a rollback only costs something if something compares
versions for order.** Nothing in this repository does. The version is emitted as
a string constant, reported through `rulesInfo()`, compared for equality against
`rules.lock` by the generator, and validated for character set and byte length by
check 6. The single `>` anywhere near it is a length bound. Integrity comes from
the digests, which is why the correction costs a visible discontinuity and
nothing else.

**And nothing published ever announced September.** `0.1.0` on npm carries rules
`2026.08.26`; the `2026.09.x` versions existed only on `main`, never in a
released artifact, and `CHANGELOG.md` is not among the files the package ships.
A consumer reading version strings sees `2026.08.26` followed by `2026.08.32`,
which is in order.

### 25. Both published releases predate the script that assembles `PROVENANCE.md`

`tools/write_provenance.sh` is the single writer of an engine's
`spec/PROVENANCE.md`, introduced to end a drift where two writers named different
commits. Section 11.4 step 3 has the engine write that file, and the reproducible
place to take the writer from is the source commit the attested manifest names —
the same tree the bundle was compiled from.

That script does not exist at either of them:

| release  | source commit | carries `tools/write_provenance.sh` |
| -------- | ------------- | ----------------------------------- |
| `v0.1.0` | `4bf7699`     | no                                  |
| `v0.1.1` | `b264614`     | no                                  |

It was added at `51aad4c`, after both tags. `spec`'s own `downstream.yml` calls
it from the release checkout, so the same gap sat in the mechanism this workflow
replaces: the step could not have run for either release.

**Here**: the workflow fetches the spec sources at the attested source commit and
refuses to continue when the writer is not there, naming the commit. A
`workflow_dispatch` input, `spec_sources_ref`, names a newer ref for the sources
this workflow reads; it existed for these two releases, it warns when it is used,
and it is empty in normal operation.

**And one thing the writer read was not release-pinned.** It took the operation
counts from `docs/generated/coverage.md` in whatever checkout it ran from, while
every other figure it quoted came from the release bundle. The release publishes
`coverage.md` as an asset covered by the attested `SHA256SUMS`, so this workflow
copies that over the checkout's before invoking it.

**Resolved by `2026.08.38`.** Its source commit `70c408b` carries the writer, and
the writer no longer assembles anything: the compiler puts `provenance-<engine>.md`
in the release, so the script copies one attested file and the last unpinned input
is gone with it. The synchronization onto `2026.08.38` ran it from the release's
own source commit, with no `spec_sources_ref`.

---

## Open

Found while implementing `engine.md` section 11.4 — the synchronization workflow
— and in the release automation of `spec` rather than in the rules. It does not
block this engine: the workflow resolves the latest release the way the section
means rather than the way it reads.

### 24. "The latest release" of `spec` cannot be resolved as the latest release

Section 11.4 says the engine compares **the latest release** of `spec` to its own
`rules.lock`. `spec` marks every release below `stable` as a prerelease, on
purpose, so that "a consumer or a downstream script never picks it up by
accident" — and rules are `alpha`.

A prerelease is excluded from the endpoint that answers _the_ latest release, so
with both published releases marked that way:

```
$ gh api repos/entid-org/spec/releases/latest
gh: Not Found (HTTP 404)
$ gh release view --repo entid-org/spec
release not found
```

Measured on `v0.1.0` and `v0.1.1` on 2026-08-24, and again on `v2026.08.38` on
2026-08-25. The workflow here therefore lists releases and takes the most
recently published non-draft one, which is what the section means and not what it
says. Filed upstream as `entid-org/spec#93`, because the obvious implementation
of that sentence resolves nothing and an engine writing it would find out only on
the day of a release.
