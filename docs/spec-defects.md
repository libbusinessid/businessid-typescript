# Contradictions and stale statements found in `spec`

Found while implementing this engine, listed for correction upstream in
`github.com/libbusinessid/spec`. Each entry records what the documents say, what
this engine does, and why.

`engine.md` section 1.1 makes the published artifacts jointly normative and
requires an implementer to stop rather than pick an interpretation. None of the
items below required inventing a semantic: in every case one document is the
exhaustive or generated source and the other is a summary that has fallen
behind. Where they disagree, `ir.md` and `rules.proto` govern, because they are
generated from the same registry as the bundle and `rules.lock` attests them.

---

## 1. The order of the load time checks — material

- `engine.md` section 7.3 lists **18** checks, in the order: size, decoding,
  **unknown field scan**, `format_version`, capabilities.
- `ir.md` section 10 lists **24** checks, in the order: size, decoding,
  **`format_version`, capabilities**, unknown field scan.

`ir.md` states the reasoning explicitly: a bundle built against a later version
carries fields this runtime has never heard of, so reporting those as unknown
fields would call a legitimate version gap a forged bundle.

**Observable.** A bundle carrying both an unknown field and an unsupported
`format_version` reports `invalid_ruleset` under `engine.md` and
`incompatible_ruleset` under `ir.md`. The two answers send an operator in
opposite directions: upgrade, or suspect an attack.

Not discriminated by the corpus — each of the 33 `load_ruleset` cases isolates a
single defect.

**Resolution.** `ir.md` section 10. `engine.md` section 7.3 appears to be an
earlier revision left in place.

---

## 2. The order of the dispatch algorithm — material

- `ir.md` section 5 lists **10** steps and runs the pre-canonicalization program
  at step 4, **as soon as the dispatcher is resolved and before any country
  decision**. It gives the reason: "so a result that stops at step 5 still
  carries the pre-canonical value".
- `engine.md` section 8.0 and `spec.md` section 6.11 list **9** steps and
  normalize the country _before_ running the pre-canonicalizer.

**Observable.** For an input whose country token is unusable and whose value
needs pre-canonicalization, the two orders report different `canonicalValue`:
the pre-canonical value under `ir.md`, the raw value under the other two.
`ir.md` section 5.1 confirms the first — "Dispatcher resolved, definition not
selected → pre-canonical value".

`ir.md` section 5 also adds a step the other two lack entirely: step 1 refuses
input that is not valid UTF-8 with `invalid_encoding`.

**Resolution.** `ir.md` section 5. Covered by
`test/unit/pipeline.test.ts`, "the pre-canonicalization phase".

---

## 3. `invalid_encoding` missing from two of the four registries

- `rules.proto` declares `REASON_CODE_INVALID_ENCODING = 21`.
- `ir.md` section 4 lists **21** reason codes, including it.
- `engine.md` section 5.5 and `spec.md` section 8.4 list **20** and omit it —
  although `spec.md` section 6.6 requires it in prose for malformed UTF-8.
- `engine.md` section 8.4 also omits it from the statuses `canonicalize` may
  report, which `ir.md` section 6 includes.

**Resolution.** The full registry of 21, from `rules.proto` and `ir.md`.

---

## 4. The optionality of `ValidationOptions.profile`

`engine.md` section 5.2 writes `profile: ValidationProfile = compatible`. If the
default were applied at the API boundary, a definition's `default_profile` could
never apply, because the caller would always be supplying a profile.

`ir.md` section 5.2 and the comment on `TesteeRequest.profile` are explicit that
absence is meaningful and must never be conflated with a profile named
`compatible`.

Not observable today — every definition in the bundle declares `compatible` —
but normative.

**Resolution.** `profile` is optional in this API. `compatible` is the dispatch
phase fallback only, and never fills in for the caller.

---

## 5. Stale counts in `PROVENANCE.md`

`PROVENANCE.md` describes the bundle as "seven current definitions … 185 IR
nodes using 45 of the 61 opcodes" and calls `features.md` "the 14 frozen
capability IDs". The published bundle carries **94 definitions**, **2 375
nodes**, **18 capabilities**, and `ir.md` documents **63 operations**.

The two operations beyond 61 are exactly `PREDICATE_OP_KIND_INTEGER_IS` and
`CHECKSUM_OP_KIND_COMPARE_CONSTANT`, introduced by capabilities 35 and 34.

Verified by `test/unit/load-official.test.ts` and `test/unit/opcodes.test.ts`.

---

## 6. Stale capability registry in `spec.md` section 7.4

`spec.md` section 7.4 lists 14 capability ids. `features.md` and the bundle
carry 18: it predates 34, 35, 41 and 42. `spec.md` section 7.4 calls itself the
"initial" registry, so it would be better as a pointer to `features.md` than as
a copy that has to be kept in step.

---

## 7. The testee protocol carries no message key

`engine.md` section 11.2 lists the message key among the fields conformance
compares "when it is specified". `ObservedValidationReport` and
`ObservedCanonicalization` in `testee.proto` carry no such field, so a message
key cannot be compared through the protocol at all.

Not a contradiction in behaviour — the protocol is the authority on what is
observable — but section 11.2 promises a comparison the protocol cannot make.
This engine reports message keys on its public API and covers them by its own
tests.

---

## Resolved on closer reading, recorded to save the next reader the trip

**`input_too_long` versus `invalid_encoding`.** Their relative order looked
unspecified. It is fixed by composition: `ir.md` section 6 step 1 is the byte
bound, step 2 is the dispatch of section 5, whose own step 1 is the UTF-8 check.
Length first, then encoding.
