# T01: record types and the append-only store

**Goal:** the shapes of a source and a claim, and a store that can only append.

**Branch:** `knowledge/t01-store`

**Read (only these):** `utils/manifest.ts` (lines 150–180: `resolveProjectArtifactsDir`), `utils/fsSafety.ts`, `utils/recordingTool.test.ts` (copy its pattern for a throwaway manifest: set `MANIFEST_PATH_OVERRIDE` and `PROJECTS_DIR_OVERRIDE` **before** the first import of the code under test), `package.json` (the `test` script).

**Create:** `utils/knowledge/types.ts`, `utils/knowledge/store.ts`, `utils/knowledge/store.test.ts`. **Edit:** `package.json`: add `"utils/knowledge/*.test.ts"` to the `test` script (it is **not** matched today, so without this your tests silently do not run).

**`.gitignore`:** the plan wants `projects/*/knowledge/` ignored, but `.gitignore` is outside the allowed folders. Edit it **only if** STATE.md says `gitignore_approved: yes`. Otherwise do not touch it and say so in the report.

**types.ts (zod):**
```ts
export const AUTHORITY = ["correction","primary_requirement","approved_plan","tracker_item","wiki_page","accountable_decision","meeting_discussion","chat"] as const; // highest first
export const SourceRecord: z.ZodObject<...>   // id, project, title, type, origin, captured_at, doc_date, version, hash, authority, is_primary ("no"|"proposed"|"confirmed"), status ("current"|"superseded"|"withdrawn"), supersedes?, superseded_by?, rev
export const ClaimRecord: z.ZodObject<...>    // id, project, subject, predicate, object, text, source_id, citation, line_start, line_end, doc_date, recorded_at, authority, confidence (0..1), status ("agreed"|"proposed"|"disputed"|"superseded"|"withdrawn"), superseded_by?, asserted_by_role?, rev
export type Source = z.infer<typeof SourceRecord>; export type Claim = z.infer<typeof ClaimRecord>;
export function authorityRank(a: Authority): number;   // 0 = highest
```
Dates are `YYYY-MM-DD` strings. `rev` is a positive integer. Do not add fields.

**store.ts:**
```ts
export type Kind = "sources" | "claims";
export function knowledgeDir(project: string): Promise<string>;   // resolveProjectArtifactsDir(project) + "knowledge", created; rejects unknown projects
export function appendRecord(kind: Kind, project: string, record: Record<string, unknown>): Promise<{ rev: number }>; // validates with the zod schema for `kind` WITHOUT its `rev`, assigns rev = latest rev for that id + 1 (or 1), appends one JSON line
export function readLatest<T>(kind: Kind, project: string): Promise<Map<string, T>>;   // id -> record with the highest rev
export function readHistory<T>(kind: Kind, project: string, id: string): Promise<T[]>; // all revs, oldest first
```
Writes go through `resolveWithinRoot(knowledgeDir, "sources.jsonl" | "claims.jsonl")`. The module must export **no** delete, overwrite or truncate function. A torn last line (partial JSON) is skipped when reading.

**Tests to write first (`store.test.ts`):**
1. append then `readLatest` returns the record with `rev: 1`.
2. appending the same id again gives `rev: 2`, `readLatest` returns the new one, `readHistory` returns both in order.
3. an invalid record (bad date, confidence 1.5, unknown authority) throws and **writes nothing** (file absent or unchanged).
4. an unknown project throws and writes nothing.
5. a project name like `../x` is rejected.
6. a torn last line is ignored.
7. the module's exports contain no name matching `/delete|remove|truncate|overwrite/i`.

**Mutation check:** make `appendRecord` write before validating; test 3 must fail. Restore.

**Done when:** the seven tests pass **and run under `npm test`** (check the test count rose); gate green.

**Stop and report if:** the manifest override pattern does not work as described; zod is not importable.
