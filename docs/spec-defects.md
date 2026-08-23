# Contradictions found in `spec`, and how they were resolved

Found while implementing this engine, across four synchronisations. Everything
below has been corrected upstream in `github.com/libbusinessid/spec`. Nothing is
open as of rules `2026.08.25`.

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

---

## Open

Nothing.
