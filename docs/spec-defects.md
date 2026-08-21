# Contradictions found in `spec`, and how they were resolved

Found while implementing this engine, across three synchronisations. Everything
below has been corrected upstream in `github.com/libbusinessid/spec` except the
last two entries, which are open.

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
and only check 14.

### 7. Stale counts, and the copied capability registry

`PROVENANCE.md` is generated now and carries the real figures.
`spec.md` section 7.4 no longer copies the capability registry: it points at
`features.md` and says why a hand kept table drifts.

---

## Open

### 8. `engine.md` section 15.1 contradicts sections 1.2 and 10

The minimal API list still reads:

```text
engineFromRules(bytes)
registryLookup(input, provider, options)   # interface, aucune implémentation
```

Section 1.2 forbids the first — "aucun moteur n'expose de fabrique acceptant un
bundle en octets à l'exécution" — and section 10 forbids the second — "Aucun
moteur ne doit livrer `RegistryProvider`, et un moteur qui ne le livre pas est
pleinement conforme".

Both are the same document contradicting itself, and which side wins is not in
doubt: sections 1.2 and 10 are the reasoned rewrites, section 15.1 is the list
they were not applied to. This engine follows 1.2 and 10 and ships neither.

### 9. The check count reads twenty four in four places

`ir.md` section 10 now enumerates **25** checks. Four passages still say
twenty four:

| Where                | Text                                                                         |
| -------------------- | ---------------------------------------------------------------------------- |
| `engine.md` line 54  | "applique les vingt-quatre contrôles de chargement"                          |
| `engine.md` line 72  | "Les vingt-quatre contrôles de chargement restent intégralement exigés"      |
| `engine.md` line 399 | "`ir.md` section 10 fait foi sur l'ordre complet des vingt-quatre contrôles" |
| `spec.md` line 82    | "le validateur complet des vingt-quatre contrôles"                           |

Cosmetic, and no behaviour depends on it, but the third is the sentence that
delegates authority to `ir.md` — so it names a count that document no longer
has.

The two occurrences inside `ir.md` section 2 ("passing all twenty four load
checks", "the twenty four checks would not see it") read correctly as _the other
twenty four_, and are not counted here.
