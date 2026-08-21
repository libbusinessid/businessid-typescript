# Contradictions found in `spec`, and how they were resolved

Found while implementing this engine. All of them have since been corrected
upstream in `github.com/libbusinessid/spec`; this file records what was found,
what the correction says, and what it changed here.

---

## 1. Whether an engine may interpret the bundle — resolved, architecture changed

Three documents disagreed on the single most structural question in the project.

- `PROVENANCE.md` said an engine "does not interpret the bundle at runtime" and
  described a generator.
- `spec.md` section 2.3 said an engine that interprets "reste conforme s'il
  produit les mêmes résultats observables".
- `engine.md` said nothing at all.
- `engine-typescript.md` required `static fromRules(bytes: Uint8Array)`, an API
  that hands every caller the full validator and the execution machinery — an
  interpreter by construction.

This engine was first built as an interpreter, following the tolerance in
`spec.md` and the API `engine-typescript.md` mandated.

**The correction.** `engine.md` gained section 1.1: a generator reads the bundle
at build time, applies the twenty four checks, and emits source; the engine is
what ships. `spec.md` section 2.3 now forbids interpretation and states the
reason — an interpreter carries the whole validator and sixty three opcodes into
every caller's runtime, a cost and an attack surface the generator pays once.
`fromRules` is gone from the TypeScript contract.

**What changed here.** The decoder, the twenty four checks, the IR types and the
opcode table moved to `tools/generator/`, which emits `src/rules.generated.ts`.
The package now carries the emitted rules, the primitives they call and the
public API. It has no bundle, no decoder, no interpreter, and no runtime
dependency at all: 62 kB packed rather than 171 kB, and validation about a third
faster for having no dispatch to do.

---

## 2. The order of the dispatch algorithm — resolved in `ir.md`'s favour

`ir.md` section 5 listed **10** steps and ran the pre-canonicalization program
at step 4, before any country decision, giving the reason: "so a result that
stops at step 5 still carries the pre-canonical value". `engine.md` section 8.0
and `spec.md` section 6.11 listed **9** and normalised the country first.

Observable: for an input whose country token is unusable and whose value needs
pre-canonicalization, the reported `canonicalValue` differs. No corpus case
distinguished the two.

**The correction.** Both documents now follow `ir.md` and say so explicitly.
Covered here by `test/unit/pipeline.test.ts`, "the pre-canonicalization phase".

---

## 3. `invalid_encoding` missing from two registries — resolved

`rules.proto` declared `REASON_CODE_INVALID_ENCODING = 21` and `ir.md` section 4
listed it. `engine.md` section 5.5 and `spec.md` section 8.4 listed twenty codes
and omitted it, although `spec.md` section 6.6 required it in prose. Both are
corrected.

---

## 4. The optionality of the profile — resolved

`engine.md` section 5.2 wrote `profile: ValidationProfile = compatible`. Applied
at the API boundary, that default would mean a definition's `default_profile`
could never apply, which `ir.md` section 5.2 and the comment on
`TesteeRequest.profile` both make meaningful. The profile is optional again.

---

## 5. The testee protocol carried no message key — resolved, and it bites

`engine.md` section 11.2 said the common tests compare the reason code _and_ the
message key. `ObservedStep` carried no such field, so no engine was ever checked
on it.

**The correction.** `ObservedStep` gained `optional string message_key = 3`.

**What it caught.** 149 expected steps across the corpus declare a key, over 83
distinct keys. Deliberately corrupting the key this engine reports fails exactly
those 149 cases and no others, which is how the comparison was verified to be
real rather than vacuous.

---

## 6. Stale counts — resolved

`PROVENANCE.md` described "seven current definitions … 185 IR nodes using 45 of
the 61 opcodes" and "the 14 frozen capability IDs". The bundle carries 94
definitions, 2375 nodes and 18 capabilities, and `ir.md` documents 63
operations — the two beyond 61 being `INTEGER_IS` and `COMPARE_CONSTANT`, from
capabilities 35 and 34. `PROVENANCE.md` is now generated.

`spec.md` section 7.4 still copies a capability registry that predates ids 34,
35, 41 and 42. `features.md` is the frozen source and governs; the copy would be
better as a pointer.

---

## Resolved on closer reading, recorded to save the next reader the trip

**`input_too_long` versus `invalid_encoding`.** Their relative order looked
unspecified. It is fixed by composition: `ir.md` section 6 step 1 is the byte
bound, step 2 is the dispatch of section 5, whose own step 1 is the UTF-8 check.
Length first, then encoding.

---

## One decision this engine made that the spec leaves open

**A bound on how much code one program may expand to.** The emitter inlines,
which keeps the short-circuit of `ALL`, `ANY` and the assertion sequence exactly
where the IR puts it. Across the shipped bundle that costs almost nothing — 2375
nodes expand to 3069 expression instances, the largest program reaching 118 —
but a bundle where each node reads the previous one twice expands exponentially
while passing every load time check.

The generator refuses such a bundle rather than emitting until it runs out of
memory. The bound chosen is the evaluation budget of `ir.md` section 8: a
generated program may not carry more expression instances than the steps an
interpreter would have been given to run it once. The specification does not
state a bound here, so this is a generator-side choice, reported for review.
