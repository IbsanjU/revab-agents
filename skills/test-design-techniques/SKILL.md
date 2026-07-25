---
name: test-design-techniques
description: Apply systematic test-design techniques (equivalence partitioning, boundary values, decision tables, state transitions, pairwise) to derive the smallest set of scenarios that still covers the risk. Use whenever writing or reviewing test scenarios from requirements — especially when a criterion has ranges, rules, combinations, or state. Skip for a single fixed-path smoke check with no variation.
---
# Test design techniques

Turns "write some tests" into a derivation you can defend. Without a technique, generated
scenarios drift toward one of two failure modes: **exhaustive permutations** nobody will
maintain, or **happy-path only**, which finds nothing. Each technique below picks the *few*
cases that carry the risk, and — just as importantly — tells you which cases you can safely
drop and why.

Pick the technique from the shape of the criterion, then record which one you used in the plan
so a reviewer can check the reasoning rather than re-deriving it.

## 1. Equivalence partitioning — "any value in this class behaves the same"
Use when an input accepts a range or set of values.
- Split the input into classes where behavior should be identical: valid classes and *each
  distinct* invalid class (empty, wrong type, too long, unauthorized, malformed).
- Take **one** representative per class. Three valid postcodes test the same code path once.
- Invalid classes are where the bugs live — never collapse them into a single "bad input" case.

## 2. Boundary value analysis — "bugs cluster at the edges"
Use with any ordered range (numbers, dates, lengths, quantities, currency).
- For a boundary `n`, test `n-1`, `n`, `n+1`. Add the extremes: minimum, maximum, zero,
  empty, and one past the maximum.
- Watch for the off-by-one pair the requirement leaves ambiguous ("up to 100" — is 100
  included?). If the requirement doesn't say, that's a **question for the author, not a guess**.

## 3. Decision tables — "several conditions combine into a rule"
Use when behavior depends on a combination of flags/states (role × status × feature toggle).
- List the conditions, enumerate the combinations, mark the expected action for each.
- Collapse rows that produce the same action for the same reason, and say why they collapse.
- Every distinct *action* needs at least one row; impossible combinations are documented, not tested.

## 4. State transition testing — "order matters"
Use for workflows: ticket status, checkout, onboarding, session lifecycle.
- Map states and legal transitions. Cover every legal transition at least once.
- Cover the **illegal** ones that matter: can a cancelled order still be paid? Can a submitted
  form be edited? These are the high-value defects.
- Include at least one multi-step path a real user takes end-to-end.

## 5. Pairwise (all-pairs) — "too many combinations"
Use when several independent parameters multiply out (browser × locale × plan × payment type).
- Most defects come from a single value or a *pair*, not a rare triple. Cover all pairs
  instead of the full cross-product — it collapses hundreds of cases into a handful.
- State the assumption explicitly in the plan so a reviewer can override it for a risky area.

## 6. Risk scoring — "what deserves depth"
Score each area **impact** (1–3: cosmetic → data loss/revenue/compliance) × **likelihood**
(1–3: stable & simple → recently changed, complex, or historically buggy — check
`git_log`/`git_search` and prior failures in `knowledge/`).
- **6–9 (high)**: full technique coverage — boundaries, negatives, state, combinations.
- **3–4 (medium)**: happy path + the most likely negative.
- **1–2 (low)**: a single smoke assertion, or deliberately none (say so).
Put the score and its two factors in the plan; a bare "high/medium/low" is unreviewable.

## Output additions to the plan
For each area: technique used · classes/boundaries/rows derived · scenarios kept ·
**cases deliberately excluded and why**. That last line is what separates a test plan from a
list of tests — it shows the coverage decision was made, not missed.

## Rules
- Name the technique per area; "we tested it thoroughly" is not a coverage argument.
- Ambiguity in a boundary or rule is a **question for the requirement's author**, never an
  assumption silently encoded into a scenario (hard rule #9).
- Prefer fewer, higher-value scenarios; every scenario you keep must justify its maintenance cost.
- Derived cases still need their source citation — the technique explains the *selection*, not
  the requirement.
