# T04: authority, supersession and conflict marking (pure logic)

**Goal:** the rule that decides what happens when two current claims disagree. This is the heart of the layer, and it is a pure function with a table test.

**Branch:** `knowledge/t04-conflicts`

**Read:** `utils/knowledge/types.ts` (`authorityRank`), `utils/knowledge/claims.ts`.

**Create:** `utils/knowledge/conflicts.ts`, `utils/knowledge/conflicts.test.ts`. **Edit:** `claims.ts` so `ClaimPlan` gains `conflicts: ConflictOutcome[]` and `planClaimAdd` fills it.

**Signatures:**
```ts
export type Outcome = "incoming_wins" | "existing_wins" | "both_disputed" | "no_conflict";
export interface ConflictOutcome { existing_id: string; outcome: Outcome; reason: string }
export function resolveConflict(existing: Claim, incoming: Claim): { outcome: Outcome; reason: string };
```
Conflict exists only when `subject` and `predicate` are equal (case-insensitive, trimmed) and `object` differs and both are in `agreed|proposed|disputed`. Otherwise `no_conflict`. Then, in order: lower `authorityRank` number wins; equal rank: the later `doc_date` wins; equal rank and equal date: `both_disputed`. A `withdrawn` or `superseded` claim is never a participant. Applying an outcome: the loser becomes `superseded` with `superseded_by` pointing at the winner; `both_disputed` makes both `disputed`. Apply always appends new revs; nothing is deleted.

**Table tests first (one row each):**
1. higher authority beats lower even if the lower is newer.
2. equal authority, newer `doc_date` wins.
3. equal authority and date: both disputed.
4. `correction` beats `primary_requirement`.
5. a withdrawn existing claim is `no_conflict`.
6. different predicate: `no_conflict`.
7. same object: `no_conflict` (agreement, not conflict).
8. case and whitespace in subject/predicate are ignored.
9. a lower-authority incoming claim never makes a primary claim `superseded`.

**Mutation check:** swap the authority comparison direction; tests 1 and 4 must fail.

**Done when:** all nine pass; `planClaimAdd` returns the conflicts; gate green. Add `evals/behavior/knowledge-marks-conflict-not-resolves.md` and its entry in `evals/behaviorChecks.ts`.
