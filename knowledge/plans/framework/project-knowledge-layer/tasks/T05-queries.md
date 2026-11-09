# T05: list, ask and "as of"

**Goal:** read the knowledge back: current by default, with history on request.

**Branch:** `knowledge/t05-queries`

**Read:** `utils/knowledge/store.ts`, `claims.ts`, `sources.ts`.

**Create:** `utils/knowledge/query.ts`, `utils/knowledge/query.test.ts`.

**Signatures:**
```ts
export interface ListOptions { includeSuperseded?: boolean; asOf?: string /* YYYY-MM-DD */; status?: Claim["status"][] }
export function listClaims(project: string, opts?: ListOptions): Promise<Claim[]>;
export interface AskHit { claim: Claim; score: number }
export function askClaims(project: string, query: string, opts?: ListOptions & { limit?: number }): Promise<AskHit[]>;
export function changesSince(project: string, since: string): Promise<{ added: Claim[]; superseded: Claim[]; disputed: Claim[] }>;
```
Rules: default excludes `superseded` and `withdrawn`; `asOf` replays history and returns what was current on that date by `recorded_at`; `askClaims` scores by token overlap on subject, predicate, object and text (subject and predicate weigh double), ignores case, returns at most `limit` (default 10), highest first, ties by newest `doc_date`; results are **primary-source first** when scores tie. No stemming, no new dependency.

**Tests first:** default hides superseded; `includeSuperseded` shows them; `asOf` before a supersession shows the old claim; `ask` ranks a subject match above a text match; ties favour a primary source; `changesSince` lists a claim added after the date and one superseded after it; an empty query returns `[]`.

**Mutation check:** drop the `superseded` filter; the default-hides test must fail.

**Done when:** tests pass; gate green. Add `evals/behavior/knowledge-superseded-never-in-output.md` and its entry in `evals/behaviorChecks.ts`.

**After this card:** phase 1 and the core of phase 2 are done. Stop. The next cards (gateway server, CLI, lexicon) are written from this merged code, not before.
