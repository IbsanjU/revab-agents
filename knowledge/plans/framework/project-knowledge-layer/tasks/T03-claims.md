# T03: claims with a citation that must pass the existing validator

**Goal:** add claims safely. A claim without a real source is rejected. No new citation validator.

**Branch:** `knowledge/t03-claims`

**Read:** `utils/citation.ts` (`validateCitation`, `requireCitation`), `utils/knowledge/*` (T01, T02).

**Create:** `utils/knowledge/claims.ts`, `utils/knowledge/claims.test.ts`.

**Signatures:**
```ts
export interface ClaimInput { subject: string; predicate: string; object: string; text: string; source_id: string; citation: string; line_start: number; line_end: number; doc_date: string; confidence: number; asserted_by_role?: string }
export interface ClaimPlan { record: Claim; warnings: string[] }   // conflicts are added in T04, not here
export function planClaimAdd(project: string, input: ClaimInput): Promise<ClaimPlan>;   // writes nothing; throws on any violation
export function applyClaimAdd(project: string, plan: ClaimPlan): Promise<Claim>;
```
Rules (each throws with a clear message): `requireCitation(input.citation)` must pass; `source_id` must exist and its status must be `current`; `1 <= line_start <= line_end`; `confidence` in 0..1; `subject`, `predicate`, `object`, `text` non-empty. The claim's `authority` and `doc_date` default from its **source** (do not let the input override authority). Initial `status` is `"proposed"` (T04 decides `agreed`). id is `C-` + 8 hex chars of a sha256 of `project|subject|predicate|object|source_id|line_start`.

**Tests first:** an empty citation, `"TBD"` and `"from the requirements"` are each rejected; a valid `PROJ-123` and `src/x.ts:42` are accepted; unknown source rejected; superseded source rejected; bad line range rejected; plan writes nothing; apply appends; same input twice gives the same id (idempotent, not duplicated).

**Mutation check:** replace `requireCitation` with a check that only tests for non-empty text; the `"TBD"` test must fail.

**Done when:** tests pass under `npm test`; gate green. Also add `evals/behavior/knowledge-rejects-unsourced-claim.md` (copy the layout of `evals/behavior/researcher-does-not-invent.md`: Agent, Why this case exists, Task prompt, Rubric Must / Must not, Runs) and an entry `"knowledge-rejects-unsourced-claim": []` in `evals/behaviorChecks.ts`.
